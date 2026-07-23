const { simpleParser } = require("mailparser");
const { getSql } = require("../db/neon");
const stockCheckEmailsService = require("./stockCheckEmails.service");

const defaultPageSize = 50;
const maxPageSize = 100;
const maxResponseLength = 20000;

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeMessageId(value) {
  return normalizeText(value)
    .replace(/^mailto:/i, "")
    .replace(/[<>\s]/g, "")
    .toLowerCase();
}

function collectMessageIds(parsed) {
  const values = [
    parsed?.inReplyTo,
    parsed?.references,
    parsed?.headers?.get?.("in-reply-to"),
    parsed?.headers?.get?.("references")
  ].flatMap((value) => (Array.isArray(value) ? value : [value]));
  const messageIds = new Set();

  for (const value of values) {
    const text = normalizeText(value);

    if (!text) {
      continue;
    }

    const bracketedIds = Array.from(text.matchAll(/<([^>]+)>/g)).map(
      (match) => match[1]
    );
    const candidates = bracketedIds.length > 0 ? bracketedIds : text.split(/\s+/);

    for (const candidate of candidates) {
      const messageId = normalizeMessageId(candidate);

      if (messageId) {
        messageIds.add(messageId);
      }
    }
  }

  return Array.from(messageIds);
}

function normalizeReplyText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\[(?:cid|signature)[:_][^\]]+\](?:\s*<[^>]+>)?/gi, "")
    .replace(/\[image:[^\]]+\](?:\s*<[^>]+>)?/gi, "")
    .replace(
      /-{3,}\s*[^ \n]*\s*warning:\s*this email is from an external sender\.[^\n]*-{3,}/gi,
      ""
    )
    .replace(/[ \t]{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findFirstMarker(text, markers) {
  let cutoff = text.length;

  for (const marker of markers) {
    const match = marker.exec(text);

    if (match?.index !== undefined) {
      cutoff = Math.min(cutoff, match.index);
    }
  }

  return cutoff;
}

function stripQuotedContent(value) {
  const quoteMarkers = [
    /^\s*On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\S]{0,320}?\bwrote:\s*$/im,
    /^\s*On\s+.{0,320}\bwrote:\s*$/im,
    /^\s*-{2,}\s*on\s+[\s\S]{0,320}?\bwrote\s*-{2,}\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^Begin forwarded message:\s*$/im,
    /^From:\s.+$/im,
    /^_{5,}\s*$/im
  ];
  const cutoff = findFirstMarker(value, quoteMarkers);

  return value
    .slice(0, cutoff)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
}

function stripTurn14Template(value, senderEmail) {
  if (normalizeEmail(senderEmail) !== "support@turn14.com") {
    return value;
  }

  let text = value.replace(/^\s*\d{5,}:\d{5,}\s*/i, "");
  const signatureMarkers = [
    /\b(?:Thank you|Best),?\s+(?:\d{5,}:\d{5,}\s+)?[A-Z][A-Za-z' -]{1,60}\s+Customer Support Representative\b/i,
    /\b(?:Thank you|Best),?\s+\d{5,}:\d{5,}\b/i,
    /\b\d{5,}:\d{5,}\s+[A-Z][A-Za-z' -]{1,60}\s+Customer Support Representative\b/i,
    /\b[A-Z][A-Za-z' -]{1,60}\s+Customer Support Representative\b/i
  ];
  const cutoff = findFirstMarker(text, signatureMarkers);

  text = text
    .slice(0, cutoff)
    .replace(/^Thank you for reaching out!\s*/i, "")
    .replace(
      /\s+If you have any questions(?: or concerns)?(?: in the meantime| during this time)?,?\s+please let me know[!.]?\s*$/i,
      ""
    )
    .replace(
      /\s+Please let me know if you have any questions[!.]?\s*$/i,
      ""
    );

  return text.trim();
}

function stripAutomatedAcknowledgement(value) {
  const updatedRequest = value.match(
    /Your request \((\d+)\) has been updated\.[^\n]*\n-{5,}\n+([\s\S]+)$/i
  );

  if (updatedRequest) {
    const blocks = updatedRequest[2]
      .split(/\n{2,}/)
      .map(normalizeText)
      .filter(Boolean);

    if (
      blocks.length > 1 &&
      /,\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(
        blocks[0]
      )
    ) {
      blocks.shift();
    }

    return blocks
      .join("\n\n")
      .replace(
        /\n*We appreciate doing business with you!?[\s\S]*$/i,
        ""
      )
      .trim();
  }

  const acknowledgement = value.match(
    /Your request \((\d+)\) has been received and is being reviewed by our support staff\./i
  );

  if (!acknowledgement) {
    return value;
  }

  return `Request ${acknowledgement[1]} has been received and is being reviewed.`;
}

function looksLikePersonName(value) {
  const text = normalizeText(value);

  return (
    /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(text) &&
    !/[.!?]$/.test(text)
  );
}

function stripSignature(value) {
  const lines = value.split("\n");
  const closingMarker =
    /^(?:thank(?:s| you)|respectfully|regards|best|sincerely|thanx)[\s,!.…-]*$/i;
  const signatureSeparator = /^--\s*$/;
  const signatureMarker =
    /^(?:wholesale sales rep|customer support representative|territory account manager|data entry specialist|technical sales representative|customer service\/sales manager|inside sales|warehouse lead|dealer sales|sales department|wholesale orders|toll free:|office:|direct:|phone\s*:|phone#|fax\s*:|business hours:|mahle internal restricted|get outlook for)/i;
  let cutoff = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeText(lines[index]);

    if (!line) {
      continue;
    }

    if (closingMarker.test(line) || signatureSeparator.test(line)) {
      cutoff = index;
      break;
    }

    if (signatureMarker.test(line)) {
      cutoff = index;
      let previousIndex = index - 1;

      while (previousIndex >= 0 && !normalizeText(lines[previousIndex])) {
        previousIndex -= 1;
      }

      if (
        previousIndex >= 0 &&
        looksLikePersonName(lines[previousIndex])
      ) {
        cutoff = previousIndex;
      }
      break;
    }
  }

  const withoutSignature = lines.slice(0, cutoff).join("\n");
  const disclaimerMarkers = [
    /This e-mail message is being sent solely for use by the intended recipient/i,
    /This email and any files transmitted with it are confidential/i,
    /The content of this email is confidential/i,
    /Confidentiality Warning:/i,
    /WARNING: Documents that can be viewed, printed or retrieved from this E-Mail/i,
    /NOTE: The information contained in this message may contain/i,
    /\*{3}This e-mail message is intended only for individual/i,
    /We value your opinion! Please take a moment to rate your experience/i,
    /REMARK: Please send your purchase order/i
  ];
  const disclaimerCutoff = findFirstMarker(
    withoutSignature,
    disclaimerMarkers
  );

  return withoutSignature.slice(0, disclaimerCutoff).trim();
}

function stripOpeningGreeting(value) {
  return value
    .replace(
      /^(?:hello(?: diesel power products)?|hi|hey team|good (?:morning|afternoon|day)(?: team)?)[\s,!.:-]+/i,
      ""
    )
    .replace(/^Thank you for reaching out!\s*/i, "")
    .replace(/(\S[.!?])\s+(?:Thank you|Thanks)[!.]?\s*$/i, "$1")
    .trim();
}

function stripQuotedReply(value, { senderEmail = "" } = {}) {
  const normalized = normalizeReplyText(value);

  if (!normalized) {
    return "";
  }

  return stripOpeningGreeting(
    stripSignature(
      stripAutomatedAcknowledgement(
        stripTurn14Template(stripQuotedContent(normalized), senderEmail)
      )
    )
  )
    .replace(/^\s*##-\s*Please type your reply above this line\s*-##\s*/i, "")
    .replace(/^\s*\d{5,}:\d{5,}\s*/i, "")
    .replace(/^\s*\[[A-Z0-9-]{6,}\]\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxResponseLength);
}

function getFirstAddress(addressObject) {
  const address = addressObject?.value?.find((entry) => entry?.address);

  return {
    email: normalizeEmail(address?.address),
    name: normalizeText(address?.name)
  };
}

function mapAuditRow(row) {
  const responseText = stripQuotedReply(row?.response_text, {
    senderEmail: row?.sender_email
  });

  return {
    id: String(row?.id || ""),
    sku: String(row?.sku || ""),
    vendorId: String(row?.vendor_id || ""),
    vendorName: String(row?.vendor_name || row?.vendor_id || ""),
    senderEmail: String(row?.sender_email || ""),
    senderName: String(row?.sender_name || ""),
    subject: String(row?.subject || ""),
    responseText:
      responseText || "No relevant stock information was included.",
    receivedAt: row?.received_at
      ? new Date(row.received_at).toISOString()
      : ""
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS inventory_audits (
          id BIGSERIAL PRIMARY KEY,
          gmail_message_id TEXT NOT NULL UNIQUE,
          stock_check_email_id BIGINT NOT NULL,
          sku TEXT NOT NULL,
          vendor_id TEXT NOT NULL DEFAULT '',
          vendor_name TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          sender_name TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          response_text TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS inventory_audits_sku_idx
        ON inventory_audits (upper(sku))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS inventory_audits_received_at_idx
        ON inventory_audits (received_at DESC)
      `;
      await sql`
        DELETE FROM inventory_audits AS older
        USING inventory_audits AS newer
        WHERE older.stock_check_email_id = newer.stock_check_email_id
          AND (
            older.received_at < newer.received_at
            OR (
              older.received_at = newer.received_at
              AND older.id < newer.id
            )
          )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS inventory_audits_stock_check_email_idx
        ON inventory_audits (stock_check_email_id)
      `;
    })();
  }

  return schemaReady;
}

async function processStockCheckReplySource({ messageUid, source }) {
  const safeMessageUid = normalizeText(messageUid);

  if (!safeMessageUid || !source) {
    return { imported: 0, matched: false };
  }

  const parsed = await simpleParser(source);
  const sender = getFirstAddress(parsed.from);
  const subject = normalizeText(parsed.subject);
  const responseText = stripQuotedReply(parsed.text, {
    senderEmail: sender.email
  });
  const messageIds = collectMessageIds(parsed);
  const looksLikeReply =
    messageIds.length > 0 || /^(?:re|fw|fwd)\s*:/i.test(subject);

  if (!looksLikeReply || !sender.email || !responseText) {
    return { imported: 0, matched: false };
  }

  const sentEmail = await stockCheckEmailsService.findMatchingVendorEmail({
    messageIds,
    senderEmail: sender.email,
    subject
  });

  if (!sentEmail) {
    return { imported: 0, matched: false };
  }

  await initializeSchema();

  const sql = getSql();
  const receivedAt =
    parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())
      ? parsed.date
      : new Date();
  const existingRows = await sql`
    SELECT id::text, gmail_message_id, stock_check_email_id::text
    FROM inventory_audits
    WHERE gmail_message_id = ${safeMessageUid}
       OR stock_check_email_id = ${sentEmail.id}
    ORDER BY received_at DESC, id DESC
    LIMIT 1
  `;
  const existing = existingRows[0] || null;

  if (existing?.gmail_message_id === safeMessageUid) {
    return {
      imported: 0,
      matched: true,
      sku: normalizeSku(sentEmail.sku),
      updated: 0
    };
  }

  const rows = await sql`
    INSERT INTO inventory_audits (
      gmail_message_id,
      stock_check_email_id,
      sku,
      vendor_id,
      vendor_name,
      recipient_email,
      sender_email,
      sender_name,
      subject,
      response_text,
      received_at
    )
    VALUES (
      ${safeMessageUid},
      ${sentEmail.id},
      ${normalizeSku(sentEmail.sku)},
      ${normalizeText(sentEmail.vendorId)},
      ${normalizeText(sentEmail.vendorName)},
      ${normalizeEmail(sentEmail.recipientEmail)},
      ${sender.email},
      ${sender.name},
      ${subject},
      ${responseText},
      ${receivedAt}
    )
    ON CONFLICT (stock_check_email_id) DO UPDATE
    SET gmail_message_id = EXCLUDED.gmail_message_id,
        sku = EXCLUDED.sku,
        vendor_id = EXCLUDED.vendor_id,
        vendor_name = EXCLUDED.vendor_name,
        recipient_email = EXCLUDED.recipient_email,
        sender_email = EXCLUDED.sender_email,
        sender_name = EXCLUDED.sender_name,
        subject = EXCLUDED.subject,
        response_text = EXCLUDED.response_text,
        received_at = EXCLUDED.received_at
    WHERE EXCLUDED.received_at >= inventory_audits.received_at
    RETURNING id::text
  `;
  const updated = Boolean(existing) && rows.length > 0;

  return {
    imported: existing ? 0 : rows.length,
    matched: true,
    sku: normalizeSku(sentEmail.sku),
    updated: updated ? 1 : 0
  };
}

async function listInventoryAudits({ page, limit, search } = {}) {
  await initializeSchema();

  const sql = getSql();
  const safePage = normalizePositiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
  const safeLimit = normalizePositiveInteger(limit, defaultPageSize, maxPageSize);
  const safeSearch = normalizeText(search);
  const searchPattern = `%${safeSearch}%`;
  const offset = (safePage - 1) * safeLimit;
  const [rows, countRows] = await Promise.all([
    sql`
      SELECT
        id::text,
        sku,
        vendor_id,
        vendor_name,
        sender_email,
        sender_name,
        subject,
        response_text,
        received_at
      FROM inventory_audits
      WHERE
        ${safeSearch} = ''
        OR sku ILIKE ${searchPattern}
        OR vendor_name ILIKE ${searchPattern}
        OR sender_email ILIKE ${searchPattern}
        OR response_text ILIKE ${searchPattern}
      ORDER BY received_at DESC, id DESC
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM inventory_audits
      WHERE
        ${safeSearch} = ''
        OR sku ILIKE ${searchPattern}
        OR vendor_name ILIKE ${searchPattern}
        OR sender_email ILIKE ${searchPattern}
        OR response_text ILIKE ${searchPattern}
    `
  ]);
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    data: rows.map(mapAuditRow),
    total,
    totalPages,
    isLastPage: safePage >= totalPages
  };
}

async function clearInventoryAuditsForSku(sku) {
  const safeSku = normalizeSku(sku);

  if (!safeSku) {
    return { deleted: 0 };
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    DELETE FROM inventory_audits
    WHERE upper(sku) = ${safeSku}
    RETURNING id::text
  `;

  return {
    deleted: rows.length
  };
}

module.exports = {
  clearInventoryAuditsForSku,
  listInventoryAudits,
  processStockCheckReplySource,
  _test: {
    collectMessageIds,
    stripQuotedReply
  }
};
