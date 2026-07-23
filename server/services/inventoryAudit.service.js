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

function stripQuotedReply(value) {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\[cid:[^\]]+\]/gi, "")
    .trim();

  if (!normalized) {
    return "";
  }

  const quoteMarkers = [
    /^On .+wrote:\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^From:\s.+\nSent:\s.+\nTo:\s.+(?:\nCc:\s.+)?\nSubject:\s.+$/im,
    /^_{5,}\s*$/im
  ];
  let cutoff = normalized.length;

  for (const marker of quoteMarkers) {
    const match = marker.exec(normalized);

    if (match?.index !== undefined) {
      cutoff = Math.min(cutoff, match.index);
    }
  }

  return normalized
    .slice(0, cutoff)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
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
  return {
    id: String(row?.id || ""),
    sku: String(row?.sku || ""),
    vendorId: String(row?.vendor_id || ""),
    vendorName: String(row?.vendor_name || row?.vendor_id || ""),
    senderEmail: String(row?.sender_email || ""),
    senderName: String(row?.sender_name || ""),
    subject: String(row?.subject || ""),
    responseText: String(row?.response_text || ""),
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
  const responseText = stripQuotedReply(parsed.text);
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
