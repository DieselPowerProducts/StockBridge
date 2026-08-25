const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { getSql } = require("../db/neon");
const { loadLocalEnv } = require("../config/env");
const autoInventoryService = require("./autoInventory.service");
const autoInventoryAuditsService = require("./vendorAutoInventoryAudits.service");
const gmailInventoryEventsService = require("./gmailInventoryEvents.service");
const inventoryAuditService = require("./inventoryAudit.service");

loadLocalEnv();

const gmailScope = "https://www.googleapis.com/auth/gmail.modify";
const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1";
const oauthStateLifetimeSeconds = 10 * 60;
const defaultLookbackDays = 14;
const gmailHistoryPageSize = 100;
const gmailInboxPageSize = 100;
const queuePublishBatchSize = 10;
const gmailHistoryIdSqlPattern = "^[0-9]+$";

let schemaReady;
let gmailLabelIds;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getMessageLabelNames({
  inventoryAuditMatched = false,
  shouldLabelInventory = false
} = {}) {
  const labelNames = [];

  if (inventoryAuditMatched) {
    labelNames.push(
      normalizeText(process.env.STOCK_CHECK_GMAIL_LABEL) || "Stock Check"
    );
  }

  if (shouldLabelInventory) {
    labelNames.push(
      normalizeText(process.env.AUTO_INVENTORY_GMAIL_LABEL) ||
        "Vendor Inventory"
    );
  }

  return Array.from(new Set(labelNames));
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
      await sql`
        ALTER TABLE gmail_push_state
        ADD COLUMN IF NOT EXISTS pending_history_id TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS gmail_processing_jobs (
          job_key TEXT PRIMARY KEY,
          mailbox_email TEXT NOT NULL DEFAULT '',
          job_kind TEXT NOT NULL DEFAULT '',
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          queue_message_id TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          result JSONB NOT NULL DEFAULT '{}'::jsonb,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE gmail_processing_jobs
        ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS gmail_processing_jobs_status_idx
        ON gmail_processing_jobs (status, updated_at DESC)
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
          OR gmail_push_state.history_id !~ ${gmailHistoryIdSqlPattern}
          OR gmail_push_state.history_id::numeric < EXCLUDED.history_id::numeric
        THEN EXCLUDED.history_id
        ELSE gmail_push_state.history_id
      END,
      pending_history_id = CASE
        WHEN gmail_push_state.pending_history_id = ''
          OR gmail_push_state.pending_history_id !~ ${gmailHistoryIdSqlPattern}
          OR gmail_push_state.pending_history_id::numeric <= EXCLUDED.history_id::numeric
        THEN ''
        ELSE gmail_push_state.pending_history_id
      END,
      last_notification_at = now(),
      updated_at = now()
  `;
}

async function recordPendingNotification(mailboxEmail, historyId) {
  const safeMailboxEmail = normalizeEmail(mailboxEmail);
  const safeHistoryId = normalizeText(historyId);

  if (!safeMailboxEmail || !/^\d+$/.test(safeHistoryId)) {
    throw createHttpError(400, "Invalid Gmail notification state.");
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO gmail_push_state (
      mailbox_email,
      pending_history_id,
      last_notification_at
    )
    VALUES (
      ${safeMailboxEmail},
      ${safeHistoryId},
      now()
    )
    ON CONFLICT (mailbox_email) DO UPDATE
    SET
      pending_history_id = CASE
        WHEN gmail_push_state.pending_history_id = ''
          OR gmail_push_state.pending_history_id !~ ${gmailHistoryIdSqlPattern}
          OR gmail_push_state.pending_history_id::numeric < EXCLUDED.pending_history_id::numeric
        THEN EXCLUDED.pending_history_id
        ELSE gmail_push_state.pending_history_id
      END,
      last_notification_at = now(),
      updated_at = now()
    RETURNING history_id, pending_history_id
  `;

  return rows[0] || {
    history_id: "",
    pending_history_id: safeHistoryId
  };
}

async function getPushState(mailboxEmail = getMailboxEmail()) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT
      history_id,
      pending_history_id,
      watch_expiration,
      last_notification_at
    FROM gmail_push_state
    WHERE mailbox_email = ${normalizeEmail(mailboxEmail)}
    LIMIT 1
  `;

  return rows[0] || null;
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

async function getGmailLabelId(oauthClient, labelName) {
  const safeLabelName = normalizeText(labelName);

  if (!safeLabelName) {
    return "";
  }

  if (!gmailLabelIds) {
    const labels = await gmailRequest(oauthClient, "/users/me/labels");
    gmailLabelIds = new Map(
      (labels?.labels || [])
        .map((label) => [
          normalizeText(label?.name).toLowerCase(),
          normalizeText(label?.id)
        ])
        .filter(([name, id]) => name && id)
    );
  }

  const labelKey = safeLabelName.toLowerCase();
  const existingLabelId = gmailLabelIds.get(labelKey);

  if (existingLabelId) {
    return existingLabelId;
  }

  const created = await gmailRequest(oauthClient, "/users/me/labels", {
    method: "POST",
    body: {
      name: safeLabelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    }
  });
  const createdLabelId = normalizeText(created?.id);

  if (createdLabelId) {
    gmailLabelIds.set(labelKey, createdLabelId);
  }

  return createdLabelId;
}

async function labelAndArchiveMessage(oauthClient, messageId, labelNames) {
  const safeLabelNames = Array.from(
    new Set((labelNames || []).map(normalizeText).filter(Boolean))
  );

  if (safeLabelNames.length === 0) {
    return;
  }

  const labelIds = (
    await Promise.all(
      safeLabelNames.map((labelName) =>
        getGmailLabelId(oauthClient, labelName)
      )
    )
  ).filter(Boolean);

  await gmailRequest(
    oauthClient,
    `/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: "POST",
      body: {
        addLabelIds: labelIds,
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
  const source = decodeRawMessage(message?.raw);
  const inventoryAudit =
    await inventoryAuditService.processStockCheckReplySource({
      messageUid: messageId,
      source
    });
  const result = await autoInventoryService.processInventoryMessageSource({
    messageUid: messageId,
    source
  });
  const labelNames = getMessageLabelNames({
    inventoryAuditMatched: inventoryAudit.matched,
    shouldLabelInventory: result.shouldLabel
  });

  if (labelNames.length > 0) {
    await labelAndArchiveMessage(oauthClient, messageId, labelNames);
  }

  return {
    ...result,
    inventoryAudits:
      (inventoryAudit.imported || 0) + (inventoryAudit.updated || 0)
  };
}

async function listHistoryPage(oauthClient, startHistoryId, pageToken = "") {
  const messageIds = new Set();
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    labelId: "INBOX",
    maxResults: String(gmailHistoryPageSize)
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

  return {
    historyId: normalizeText(result?.historyId) || startHistoryId,
    messageIds: Array.from(messageIds),
    nextPageToken: normalizeText(result?.nextPageToken)
  };
}

async function listCurrentInboxMessagesPage(oauthClient, pageToken = "") {
  const lookbackDays = Math.max(
    Number(process.env.AUTO_INVENTORY_LOOKBACK_DAYS || defaultLookbackDays),
    1
  );
  const params = new URLSearchParams({
    labelIds: "INBOX",
    q: `newer_than:${lookbackDays}d`,
    maxResults: String(gmailInboxPageSize)
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const result = await gmailRequest(
    oauthClient,
    `/users/me/messages?${params.toString()}`
  );

  return {
    messageIds: (result?.messages || [])
      .map((message) => normalizeText(message?.id))
      .filter(Boolean),
    nextPageToken: normalizeText(result?.nextPageToken)
  };
}

function isHistoryAtOrBeyond(currentHistoryId, targetHistoryId) {
  const current = normalizeText(currentHistoryId);
  const target = normalizeText(targetHistoryId);

  return /^\d+$/.test(current) && /^\d+$/.test(target)
    ? BigInt(current) >= BigInt(target)
    : false;
}

function getLatestHistoryId(...historyIds) {
  return historyIds
    .map(normalizeText)
    .filter((historyId) => /^\d+$/.test(historyId))
    .reduce(
      (latest, historyId) =>
        !latest || BigInt(historyId) > BigInt(latest) ? historyId : latest,
      ""
    );
}

function normalizeQueueJob(message) {
  const job = {
    auditId: normalizeText(message?.auditId),
    gmailMessageId: normalizeText(message?.gmailMessageId),
    jobKey: normalizeText(message?.jobKey),
    kind: normalizeText(message?.kind),
    mailboxEmail: normalizeEmail(message?.mailboxEmail),
    pageToken: normalizeText(message?.pageToken),
    retryToken: normalizeText(message?.retryToken),
    rfcMessageId: normalizeText(message?.rfcMessageId),
    startHistoryId: normalizeText(message?.startHistoryId),
    targetHistoryId: normalizeText(message?.targetHistoryId)
  };

  if (!job.jobKey || !job.kind || !job.mailboxEmail) {
    throw createHttpError(400, "Invalid Gmail queue job.");
  }

  return job;
}

async function startQueueJob(message, metadata = {}) {
  const job = normalizeQueueJob(message);
  const deliveryCount = Math.max(
    Number.parseInt(metadata.deliveryCount, 10) || 1,
    1
  );

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO gmail_processing_jobs (
      job_key,
      mailbox_email,
      job_kind,
      payload,
      status,
      attempt_count,
      queue_message_id
    )
    VALUES (
      ${job.jobKey},
      ${job.mailboxEmail},
      ${job.kind},
      CAST(${JSON.stringify(job)} AS jsonb),
      'processing',
      ${deliveryCount},
      ${normalizeText(metadata.messageId)}
    )
    ON CONFLICT (job_key) DO UPDATE
    SET
      attempt_count = GREATEST(
        gmail_processing_jobs.attempt_count,
        EXCLUDED.attempt_count
      ),
      queue_message_id = EXCLUDED.queue_message_id,
      status = CASE
        WHEN gmail_processing_jobs.status IN ('completed', 'failed')
        THEN gmail_processing_jobs.status
        ELSE 'processing'
      END,
      updated_at = now()
    RETURNING status, attempt_count
  `;

  return {
    ...job,
    attemptCount: Number(rows[0]?.attempt_count || deliveryCount),
    status: normalizeText(rows[0]?.status) || "processing"
  };
}

async function completeQueueJob(jobKey, result = {}) {
  await initializeSchema();

  const sql = getSql();
  await sql`
    UPDATE gmail_processing_jobs
    SET
      status = 'completed',
      result = CAST(${JSON.stringify(result || {})} AS jsonb),
      last_error = '',
      completed_at = now(),
      updated_at = now()
    WHERE job_key = ${normalizeText(jobKey)}
  `;
}

async function failQueueJob(jobKey, error, { terminal = false } = {}) {
  await initializeSchema();

  const sql = getSql();
  const errorMessage = normalizeText(error?.message || error).slice(0, 10000);
  await sql`
    UPDATE gmail_processing_jobs
    SET
      status = ${terminal ? "failed" : "retrying"},
      last_error = ${errorMessage || "Unknown Gmail processing failure."},
      completed_at = ${terminal ? new Date() : null},
      updated_at = now()
    WHERE job_key = ${normalizeText(jobKey)}
  `;

  if (terminal) {
    await sql`
      UPDATE vendor_auto_inventory_audits AS audit
      SET
        status = 'failed',
        error_count = GREATEST(audit.error_count, 1),
        error_message = ${errorMessage || "Gmail queue processing failed."},
        updated_at = now()
      FROM gmail_processing_jobs AS job
      WHERE job.job_key = ${normalizeText(jobKey)}
        AND job.job_kind IN ('apply-inventory-audit', 'gmail-message')
        AND audit.id = job.payload->>'auditId'
        AND audit.status IN ('approved', 'applying')
    `;
  }
}

async function getQueueJobStats() {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'retrying'))::int
        AS pending,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM gmail_processing_jobs
  `;

  return {
    failed: Number(rows[0]?.failed || 0),
    pending: Number(rows[0]?.pending || 0)
  };
}

async function publishMessageJobs(mailboxEmail, messageIds) {
  const uniqueMessageIds = Array.from(
    new Set((messageIds || []).map(normalizeText).filter(Boolean))
  );

  for (let index = 0; index < uniqueMessageIds.length; index += queuePublishBatchSize) {
    const batch = uniqueMessageIds.slice(index, index + queuePublishBatchSize);
    await Promise.all(
      batch.map((gmailMessageId) =>
        gmailInventoryEventsService.publishMessage({
          gmailMessageId,
          mailboxEmail
        })
      )
    );
  }

  return uniqueMessageIds.length;
}

async function queuePendingHistoryIfNeeded(mailboxEmail) {
  const state = await getPushState(mailboxEmail);

  if (
    state?.pending_history_id &&
    !isHistoryAtOrBeyond(state.history_id, state.pending_history_id)
  ) {
    await gmailInventoryEventsService.publishNotificationScan({
      mailboxEmail,
      targetHistoryId: state.pending_history_id
    });
    return true;
  }

  return false;
}

async function processHistoryQueueJob(job) {
  const state = await getPushState(job.mailboxEmail);
  const targetHistoryId = getLatestHistoryId(
    job.targetHistoryId,
    state?.pending_history_id
  );

  if (!state?.history_id) {
    await advanceHistoryId(job.mailboxEmail, targetHistoryId);
    return {
      historyId: targetHistoryId,
      initialized: true,
      messagesQueued: 0
    };
  }

  if (
    targetHistoryId &&
    isHistoryAtOrBeyond(state.history_id, targetHistoryId)
  ) {
    return {
      duplicate: true,
      historyId: state.history_id,
      messagesQueued: 0
    };
  }

  const startHistoryId = job.startHistoryId || state.history_id;
  const oauthClient = await getAuthorizedClient();
  let page;

  try {
    page = await listHistoryPage(oauthClient, startHistoryId, job.pageToken);
  } catch (error) {
    if (error.gmailStatus !== 404) {
      throw error;
    }

    const recovery = await gmailInventoryEventsService.publishInboxRecovery({
      mailboxEmail: job.mailboxEmail,
      targetHistoryId: targetHistoryId || job.targetHistoryId
    });

    return {
      historyExpired: true,
      messagesQueued: 0,
      recoveryJobKey: recovery.jobKey
    };
  }

  const messagesQueued = await publishMessageJobs(
    job.mailboxEmail,
    page.messageIds
  );
  const latestHistoryId = getLatestHistoryId(
    page.historyId,
    targetHistoryId,
    job.targetHistoryId
  );

  if (page.nextPageToken) {
    const continuation =
      await gmailInventoryEventsService.publishHistoryPage({
        mailboxEmail: job.mailboxEmail,
        pageToken: page.nextPageToken,
        startHistoryId,
        targetHistoryId: latestHistoryId
      });

    return {
      continuationJobKey: continuation.jobKey,
      historyId: latestHistoryId,
      messagesQueued
    };
  }

  await advanceHistoryId(job.mailboxEmail, latestHistoryId);
  const followUpQueued = await queuePendingHistoryIfNeeded(job.mailboxEmail);

  return {
    followUpQueued,
    historyId: latestHistoryId,
    messagesQueued
  };
}

async function processInboxRecoveryQueueJob(job) {
  const oauthClient = await getAuthorizedClient();
  const page = await listCurrentInboxMessagesPage(oauthClient, job.pageToken);
  const messagesQueued = await publishMessageJobs(
    job.mailboxEmail,
    page.messageIds
  );

  if (page.nextPageToken) {
    const continuation =
      await gmailInventoryEventsService.publishInboxRecovery({
        mailboxEmail: job.mailboxEmail,
        pageToken: page.nextPageToken,
        targetHistoryId: job.targetHistoryId
      });

    return {
      continuationJobKey: continuation.jobKey,
      messagesQueued,
      recovering: true
    };
  }

  const profile = await getProfile(oauthClient);
  const historyId = getLatestHistoryId(
    profile?.historyId,
    job.targetHistoryId
  );
  await advanceHistoryId(job.mailboxEmail, historyId);
  const followUpQueued = await queuePendingHistoryIfNeeded(job.mailboxEmail);

  return {
    followUpQueued,
    historyId,
    messagesQueued,
    recovering: false
  };
}

async function processGmailMessageQueueJob(job) {
  const oauthClient = await getAuthorizedClient();

  try {
    return await processGmailMessage(oauthClient, job.gmailMessageId);
  } catch (error) {
    if (error.gmailStatus !== 404 || !job.rfcMessageId) {
      if (error.gmailStatus === 404) {
        return {
          gmailMessageId: job.gmailMessageId,
          missing: true
        };
      }

      throw error;
    }

    const searchableRfcMessageId = job.rfcMessageId.replace(/^<|>$/g, "");
    const params = new URLSearchParams({
      maxResults: "1",
      q: `rfc822msgid:${searchableRfcMessageId}`
    });
    const searchResult = await gmailRequest(
      oauthClient,
      `/users/me/messages?${params.toString()}`
    );
    const resolvedMessageId = normalizeText(searchResult?.messages?.[0]?.id);

    if (!resolvedMessageId) {
      if (job.auditId) {
        await autoInventoryAuditsService.setStatus(job.auditId, "failed", {
          errorCount: 1,
          errorMessage: "The original Gmail message could not be found for this retry."
        });
      }

      return {
        gmailMessageId: job.gmailMessageId,
        missing: true,
        rfcMessageId: job.rfcMessageId
      };
    }

    return processGmailMessage(oauthClient, resolvedMessageId);
  }
}

async function processQueuedJob(message) {
  const job = normalizeQueueJob(message);
  const expectedEmail = getMailboxEmail();

  if (job.mailboxEmail !== expectedEmail) {
    throw createHttpError(403, "Unexpected Gmail queue mailbox.");
  }

  if (job.kind === "history-scan" || job.kind === "history-page") {
    return processHistoryQueueJob(job);
  }

  if (job.kind === "inbox-recovery") {
    return processInboxRecoveryQueueJob(job);
  }

  if (job.kind === "gmail-message" && job.gmailMessageId) {
    return processGmailMessageQueueJob(job);
  }

  if (job.kind === "apply-inventory-audit" && job.auditId) {
    return autoInventoryService.applyStagedInventoryAudit(job.auditId);
  }

  throw createHttpError(400, "Unsupported Gmail queue job.");
}

async function queueInventoryAuditApply(auditId, retryToken = "") {
  return gmailInventoryEventsService.publishAuditApply({
    auditId,
    mailboxEmail: getMailboxEmail(),
    retryToken
  });
}

async function queueGmailMessageRetry(messageReference, retryToken) {
  const reference =
    messageReference && typeof messageReference === "object"
      ? messageReference
      : { gmailMessageId: messageReference };

  return gmailInventoryEventsService.publishMessage({
    auditId: reference.auditId,
    gmailMessageId: reference.gmailMessageId,
    mailboxEmail: getMailboxEmail(),
    retryToken,
    rfcMessageId: reference.rfcMessageId
  });
}

async function processPushNotification({ authorizationHeader, body }) {
  await verifyPushRequest(authorizationHeader);

  const notification = decodePushMessage(body);
  const expectedEmail = getMailboxEmail();

  if (notification.emailAddress !== expectedEmail) {
    throw createHttpError(403, "Unexpected Gmail mailbox notification.");
  }

  const state = await recordPendingNotification(
    expectedEmail,
    notification.historyId
  );
  let wake;
  try {
    wake = await gmailInventoryEventsService.publishNotificationScan({
      mailboxEmail: expectedEmail,
      targetHistoryId: state.pending_history_id || notification.historyId
    });
  } catch (error) {
    error.statusCode = 503;
    throw error;
  }

  return {
    historyId: notification.historyId,
    messageId: notification.messageId,
    queueJobKey: wake.jobKey,
    queueMessageId: wake.messageId,
    queued: !wake.skipped
  };
}

async function getConnectionStatus() {
  const mailboxEmail = getMailboxEmail();
  const [refreshToken, state, queueJobs] = await Promise.all([
    getStoredRefreshToken(mailboxEmail),
    getPushState(mailboxEmail),
    getQueueJobStats()
  ]);

  return {
    connected: Boolean(refreshToken),
    email: mailboxEmail,
    historyId: normalizeText(state?.history_id),
    pendingHistoryId: normalizeText(state?.pending_history_id),
    queueFailedJobs: queueJobs.failed,
    queuePendingJobs: queueJobs.pending,
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
  completeQueueJob,
  failQueueJob,
  processPushNotification,
  processQueuedJob,
  queueGmailMessageRetry,
  queueInventoryAuditApply,
  renewWatch,
  startQueueJob,
  _test: {
    decodePushMessage,
    decryptRefreshToken,
    encryptRefreshToken,
    getMessageLabelNames,
    getLatestHistoryId,
    gmailHistoryIdSqlPattern,
    isHistoryAtOrBeyond,
    normalizeQueueJob,
    verifyOAuthState
  }
};
