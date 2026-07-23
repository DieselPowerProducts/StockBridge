const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { getSql } = require("../db/neon");
const { loadLocalEnv } = require("../config/env");
const autoInventoryService = require("./autoInventory.service");

loadLocalEnv();

const gmailScope = "https://www.googleapis.com/auth/gmail.modify";
const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1";
const oauthStateLifetimeSeconds = 10 * 60;
const defaultLookbackDays = 14;

let schemaReady;
let inventoryLabelId = "";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireConfig(name) {
  const value = normalizeText(process.env[name]);

  if (!value) {
    throw createHttpError(500, `${name} is not configured.`);
  }

  return value;
}

function getMailboxEmail() {
  return normalizeEmail(requireConfig("GMAIL_API_USER"));
}

function getOAuthClient() {
  return new OAuth2Client(
    requireConfig("GMAIL_OAUTH_CLIENT_ID"),
    requireConfig("GMAIL_OAUTH_CLIENT_SECRET"),
    requireConfig("GMAIL_OAUTH_REDIRECT_URI")
  );
}

function getEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(requireConfig("GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY"))
    .digest();
}

function encryptRefreshToken(refreshToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptRefreshToken(row) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(row.refresh_token_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(row.refresh_token_auth_tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(row.refresh_token_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS gmail_oauth_credentials (
          mailbox_email TEXT PRIMARY KEY,
          refresh_token_ciphertext TEXT NOT NULL,
          refresh_token_iv TEXT NOT NULL,
          refresh_token_auth_tag TEXT NOT NULL,
          connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS gmail_push_state (
          mailbox_email TEXT PRIMARY KEY,
          history_id TEXT NOT NULL DEFAULT '',
          watch_expiration TIMESTAMPTZ,
          last_notification_at TIMESTAMPTZ,
          processing_token TEXT NOT NULL DEFAULT '',
          processing_until TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE gmail_push_state
        ADD COLUMN IF NOT EXISTS processing_token TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        ALTER TABLE gmail_push_state
        ADD COLUMN IF NOT EXISTS processing_until TIMESTAMPTZ
      `;
    })();
  }

  return schemaReady;
}

async function getStoredRefreshToken(mailboxEmail = getMailboxEmail()) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT
      refresh_token_ciphertext,
      refresh_token_iv,
      refresh_token_auth_tag
    FROM gmail_oauth_credentials
    WHERE mailbox_email = ${normalizeEmail(mailboxEmail)}
    LIMIT 1
  `;

  return rows[0] ? decryptRefreshToken(rows[0]) : "";
}

async function storeRefreshToken(mailboxEmail, refreshToken) {
  const encrypted = encryptRefreshToken(refreshToken);

  await initializeSchema();

  const sql = getSql();
  await sql`
    INSERT INTO gmail_oauth_credentials (
      mailbox_email,
      refresh_token_ciphertext,
      refresh_token_iv,
      refresh_token_auth_tag
    )
    VALUES (
      ${normalizeEmail(mailboxEmail)},
      ${encrypted.ciphertext},
      ${encrypted.iv},
      ${encrypted.authTag}
    )
    ON CONFLICT (mailbox_email) DO UPDATE
    SET
      refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
      refresh_token_iv = EXCLUDED.refresh_token_iv,
      refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
      updated_at = now()
  `;
}

function getOAuthStateSecret() {
  return requireConfig("SESSION_SECRET");
}

function signOAuthState(payload) {
  return crypto
    .createHmac("sha256", getOAuthStateSecret())
    .update(`gmail-oauth.${payload}`)
    .digest("base64url");
}

function createOAuthState(user) {
  const payload = Buffer.from(
    JSON.stringify({
      email: normalizeEmail(user?.email),
      nonce: crypto.randomBytes(16).toString("hex"),
      exp: Math.floor(Date.now() / 1000) + oauthStateLifetimeSeconds
    })
  ).toString("base64url");

  return `${payload}.${signOAuthState(payload)}`;
}

function verifyOAuthState(state) {
  const [payload, signature] = normalizeText(state).split(".");

  if (!payload || !signature) {
    throw createHttpError(400, "Invalid Gmail authorization state.");
  }

  const expected = signOAuthState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw createHttpError(400, "Invalid Gmail authorization state.");
  }

  let parsed;

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw createHttpError(400, "Invalid Gmail authorization state.");
  }

  if (!parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) {
    throw createHttpError(400, "Gmail authorization state expired.");
  }

  return parsed;
}

function getAuthorizationUrl(user) {
  return getOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    login_hint: getMailboxEmail(),
    scope: [gmailScope],
    state: createOAuthState(user)
  });
}

async function getAccessToken(oauthClient) {
  const result = await oauthClient.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;

  if (!token) {
    throw createHttpError(502, "Unable to obtain Gmail access token.");
  }

  return token;
}

async function gmailRequest(oauthClient, path, options = {}) {
  const token = await getAccessToken(oauthClient);
  const response = await fetch(`${gmailApiBaseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let payload = null;

  if (response.status !== 204) {
    const text = await response.text();

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
  }

  if (!response.ok) {
    const detail =
      normalizeText(payload?.error?.message) ||
      normalizeText(payload) ||
      `HTTP ${response.status}`;
    const error = createHttpError(502, `Gmail API request failed: ${detail}`);
    error.gmailStatus = response.status;
    throw error;
  }

  return payload;
}

async function getAuthorizedClient() {
  const refreshToken = await getStoredRefreshToken();

  if (!refreshToken) {
    throw createHttpError(503, "The Gmail mailbox has not been connected.");
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({ refresh_token: refreshToken });
  return oauthClient;
}

async function getProfile(oauthClient) {
  return gmailRequest(oauthClient, "/users/me/profile");
}

function parseWatchExpiration(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds)
    : null;
}

async function saveWatchState({ mailboxEmail, historyId, expiration }) {
  await initializeSchema();

  const sql = getSql();
  const expirationDate = parseWatchExpiration(expiration);
  await sql`
    INSERT INTO gmail_push_state (
      mailbox_email,
      history_id,
      watch_expiration
    )
    VALUES (
      ${normalizeEmail(mailboxEmail)},
      ${normalizeText(historyId)},
      ${expirationDate}
    )
    ON CONFLICT (mailbox_email) DO UPDATE
    SET
      history_id = CASE
        WHEN gmail_push_state.history_id = '' THEN EXCLUDED.history_id
        ELSE gmail_push_state.history_id
      END,
      watch_expiration = EXCLUDED.watch_expiration,
      updated_at = now()
  `;
}

async function advanceHistoryId(mailboxEmail, historyId) {
  const safeHistoryId = normalizeText(historyId);

  if (!safeHistoryId || !/^\d+$/.test(safeHistoryId)) {
    return;
  }

  await initializeSchema();

  const sql = getSql();
  await sql`
    INSERT INTO gmail_push_state (
      mailbox_email,
      history_id,
      last_notification_at
    )
    VALUES (
      ${normalizeEmail(mailboxEmail)},
      ${safeHistoryId},
      now()
    )
    ON CONFLICT (mailbox_email) DO UPDATE
    SET
      history_id = CASE
        WHEN gmail_push_state.history_id = ''
          OR gmail_push_state.history_id !~ '^\d+$'
          OR gmail_push_state.history_id::numeric < EXCLUDED.history_id::numeric
        THEN EXCLUDED.history_id
        ELSE gmail_push_state.history_id
      END,
      last_notification_at = now(),
      updated_at = now()
  `;
}

async function getPushState(mailboxEmail = getMailboxEmail()) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT
      history_id,
      watch_expiration,
      last_notification_at
    FROM gmail_push_state
    WHERE mailbox_email = ${normalizeEmail(mailboxEmail)}
    LIMIT 1
  `;

  return rows[0] || null;
}

async function acquireProcessingLock(mailboxEmail) {
  await initializeSchema();

  const token = crypto.randomUUID();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO gmail_push_state (
      mailbox_email,
      processing_token,
      processing_until
    )
    VALUES (
      ${normalizeEmail(mailboxEmail)},
      ${token},
      now() + interval '4 minutes'
    )
    ON CONFLICT (mailbox_email) DO UPDATE
    SET
      processing_token = EXCLUDED.processing_token,
      processing_until = EXCLUDED.processing_until,
      updated_at = now()
    WHERE gmail_push_state.processing_until IS NULL
      OR gmail_push_state.processing_until < now()
    RETURNING processing_token
  `;

  return rows[0]?.processing_token === token ? token : "";
}

async function releaseProcessingLock(mailboxEmail, token) {
  if (!token) {
    return;
  }

  const sql = getSql();
  await sql`
    UPDATE gmail_push_state
    SET
      processing_token = '',
      processing_until = NULL,
      updated_at = now()
    WHERE mailbox_email = ${normalizeEmail(mailboxEmail)}
    AND processing_token = ${token}
  `;
}

async function renewWatchWithClient(oauthClient) {
  const mailboxEmail = getMailboxEmail();
  const result = await gmailRequest(oauthClient, "/users/me/watch", {
    method: "POST",
    body: {
      topicName: requireConfig("GMAIL_PUBSUB_TOPIC"),
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE"
    }
  });

  await saveWatchState({
    mailboxEmail,
    historyId: result?.historyId,
    expiration: result?.expiration
  });

  return {
    connected: true,
    email: mailboxEmail,
    expiration: parseWatchExpiration(result?.expiration)?.toISOString() || "",
    historyId: normalizeText(result?.historyId)
  };
}

async function renewWatch() {
  const refreshToken = await getStoredRefreshToken();

  if (!refreshToken) {
    return {
      connected: false,
      email: getMailboxEmail()
    };
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({ refresh_token: refreshToken });
  return renewWatchWithClient(oauthClient);
}

async function completeOAuth({ code, state }) {
  verifyOAuthState(state);

  if (!normalizeText(code)) {
    throw createHttpError(400, "Missing Gmail authorization code.");
  }

  const oauthClient = getOAuthClient();
  const tokenResult = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokenResult.tokens);

  const profile = await getProfile(oauthClient);
  const profileEmail = normalizeEmail(profile?.emailAddress);
  const expectedEmail = getMailboxEmail();

  if (profileEmail !== expectedEmail) {
    throw createHttpError(
      403,
      `Connect the configured Gmail mailbox (${expectedEmail}).`
    );
  }

  const refreshToken =
    normalizeText(tokenResult.tokens?.refresh_token) ||
    (await getStoredRefreshToken(expectedEmail));

  if (!refreshToken) {
    throw createHttpError(
      400,
      "Google did not return a refresh token. Revoke StockBridge Gmail access and reconnect."
    );
  }

  await storeRefreshToken(expectedEmail, refreshToken);
  oauthClient.setCredentials({ refresh_token: refreshToken });

  return renewWatchWithClient(oauthClient);
}

async function verifyPushRequest(authorizationHeader) {
  const match = normalizeText(authorizationHeader).match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw createHttpError(401, "Missing Pub/Sub authorization token.");
  }

  let payload;

  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: match[1],
      audience: requireConfig("GMAIL_PUBSUB_PUSH_AUDIENCE")
    });
    payload = ticket.getPayload();
  } catch {
    throw createHttpError(401, "Invalid Pub/Sub authorization token.");
  }

  if (
    !payload?.email_verified ||
    normalizeEmail(payload.email) !==
      normalizeEmail(requireConfig("GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT"))
  ) {
    throw createHttpError(403, "Unexpected Pub/Sub service account.");
  }

  return payload;
}

function decodePushMessage(body) {
  const encodedData = normalizeText(body?.message?.data);

  if (!encodedData) {
    throw createHttpError(400, "Missing Pub/Sub message data.");
  }

  let data;

  try {
    data = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
  } catch {
    throw createHttpError(400, "Invalid Pub/Sub message data.");
  }

  const emailAddress = normalizeEmail(data?.emailAddress);
  const historyId = normalizeText(data?.historyId);

  if (!emailAddress || !/^\d+$/.test(historyId)) {
    throw createHttpError(400, "Invalid Gmail push notification.");
  }

  return {
    emailAddress,
    historyId,
    messageId: normalizeText(body?.message?.messageId)
  };
}

async function getRawMessage(oauthClient, messageId) {
  return gmailRequest(
    oauthClient,
    `/users/me/messages/${encodeURIComponent(messageId)}?format=raw`
  );
}

async function getInventoryLabelId(oauthClient) {
  if (inventoryLabelId) {
    return inventoryLabelId;
  }

  const labelName =
    normalizeText(process.env.AUTO_INVENTORY_GMAIL_LABEL) || "Vendor Inventory";
  const labels = await gmailRequest(oauthClient, "/users/me/labels");
  const existing = (labels?.labels || []).find(
    (label) => normalizeText(label?.name).toLowerCase() === labelName.toLowerCase()
  );

  if (existing?.id) {
    inventoryLabelId = existing.id;
    return inventoryLabelId;
  }

  const created = await gmailRequest(oauthClient, "/users/me/labels", {
    method: "POST",
    body: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    }
  });
  inventoryLabelId = normalizeText(created?.id);
  return inventoryLabelId;
}

async function labelAndArchiveMessage(oauthClient, messageId) {
  const labelId = await getInventoryLabelId(oauthClient);

  await gmailRequest(
    oauthClient,
    `/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: "POST",
      body: {
        addLabelIds: labelId ? [labelId] : [],
        removeLabelIds: ["INBOX"]
      }
    }
  );
}

function decodeRawMessage(raw) {
  return Buffer.from(normalizeText(raw), "base64url");
}

async function processGmailMessage(oauthClient, messageId) {
  const message = await getRawMessage(oauthClient, messageId);
  const result = await autoInventoryService.processInventoryMessageSource({
    messageUid: messageId,
    source: decodeRawMessage(message?.raw)
  });

  if (result.shouldLabel) {
    await labelAndArchiveMessage(oauthClient, messageId);
  }

  return result;
}

async function listHistory(oauthClient, startHistoryId) {
  const messageIds = new Set();
  let pageToken = "";
  let latestHistoryId = startHistoryId;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: "500"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const result = await gmailRequest(
      oauthClient,
      `/users/me/history?${params.toString()}`
    );

    for (const history of result?.history || []) {
      for (const item of history?.messagesAdded || []) {
        if (item?.message?.id) {
          messageIds.add(item.message.id);
        }
      }
    }

    latestHistoryId =
      normalizeText(result?.historyId) || latestHistoryId;
    pageToken = normalizeText(result?.nextPageToken);
  } while (pageToken);

  return {
    historyId: latestHistoryId,
    messageIds: Array.from(messageIds)
  };
}

async function listCurrentInboxMessages(oauthClient) {
  const lookbackDays = Math.max(
    Number(process.env.AUTO_INVENTORY_LOOKBACK_DAYS || defaultLookbackDays),
    1
  );
  const messages = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      labelIds: "INBOX",
      q: `newer_than:${lookbackDays}d`,
      maxResults: "500"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const result = await gmailRequest(
      oauthClient,
      `/users/me/messages?${params.toString()}`
    );
    messages.push(...(result?.messages || []));
    pageToken = normalizeText(result?.nextPageToken);
  } while (pageToken);

  return messages;
}

function createImportTotals() {
  return {
    messages: 0,
    labeled: 0,
    attachments: 0,
    imported: 0,
    skipped: 0,
    followUpsSet: 0,
    errors: 0
  };
}

function addImportResult(totals, result) {
  totals.messages += 1;
  totals.labeled += result.shouldLabel ? 1 : 0;
  totals.attachments += result.attachments || 0;
  totals.imported += result.imported || 0;
  totals.skipped += result.skipped || 0;
  totals.followUpsSet += result.followUpsSet || 0;
  totals.errors += result.errors || 0;
}

async function processMessageIds(oauthClient, messageIds) {
  const totals = createImportTotals();

  for (const messageId of messageIds) {
    const result = await processGmailMessage(oauthClient, messageId);
    addImportResult(totals, result);
  }

  return totals;
}

async function runInboxRecovery(oauthClient) {
  const messageRefs = await listCurrentInboxMessages(oauthClient);
  const messages = [];

  for (const messageRef of messageRefs) {
    const message = await getRawMessage(oauthClient, messageRef.id);
    messages.push(message);
  }

  messages.sort(
    (left, right) =>
      Number(left?.internalDate || 0) - Number(right?.internalDate || 0)
  );

  const totals = createImportTotals();

  for (const message of messages) {
    const result = await autoInventoryService.processInventoryMessageSource({
      messageUid: message.id,
      source: decodeRawMessage(message.raw)
    });

    if (result.shouldLabel) {
      await labelAndArchiveMessage(oauthClient, message.id);
    }

    addImportResult(totals, result);
  }

  return totals;
}

async function processPushNotification({ authorizationHeader, body }) {
  await verifyPushRequest(authorizationHeader);

  const notification = decodePushMessage(body);
  const expectedEmail = getMailboxEmail();

  if (notification.emailAddress !== expectedEmail) {
    throw createHttpError(403, "Unexpected Gmail mailbox notification.");
  }

  const processingToken = await acquireProcessingLock(expectedEmail);

  if (!processingToken) {
    throw createHttpError(503, "Gmail notification processing is busy.");
  }

  try {
    const state = await getPushState(expectedEmail);

    if (!state?.history_id) {
      await advanceHistoryId(expectedEmail, notification.historyId);
      return {
        initialized: true,
        historyId: notification.historyId,
        messageId: notification.messageId
      };
    }

    if (
      /^\d+$/.test(state.history_id) &&
      BigInt(notification.historyId) <= BigInt(state.history_id)
    ) {
      return {
        duplicate: true,
        historyId: state.history_id,
        messageId: notification.messageId
      };
    }

    const oauthClient = await getAuthorizedClient();
    let history;
    let totals;

    try {
      history = await listHistory(oauthClient, state.history_id);
      totals = await processMessageIds(oauthClient, history.messageIds);
    } catch (error) {
      if (error.gmailStatus !== 404) {
        throw error;
      }

      totals = await runInboxRecovery(oauthClient);
      const profile = await getProfile(oauthClient);
      history = {
        historyId: normalizeText(profile?.historyId) || notification.historyId
      };
    }

    await advanceHistoryId(
      expectedEmail,
      history.historyId || notification.historyId
    );

    return {
      ...totals,
      historyId: history.historyId || notification.historyId,
      messageId: notification.messageId
    };
  } finally {
    await releaseProcessingLock(expectedEmail, processingToken);
  }
}

async function getConnectionStatus() {
  const mailboxEmail = getMailboxEmail();
  const refreshToken = await getStoredRefreshToken(mailboxEmail);
  const state = await getPushState(mailboxEmail);

  return {
    connected: Boolean(refreshToken),
    email: mailboxEmail,
    historyId: normalizeText(state?.history_id),
    watchExpiration: state?.watch_expiration
      ? new Date(state.watch_expiration).toISOString()
      : "",
    lastNotificationAt: state?.last_notification_at
      ? new Date(state.last_notification_at).toISOString()
      : ""
  };
}

module.exports = {
  completeOAuth,
  getAuthorizationUrl,
  getConnectionStatus,
  processPushNotification,
  renewWatch,
  _test: {
    decodePushMessage,
    decryptRefreshToken,
    encryptRefreshToken,
    verifyOAuthState
  }
};
