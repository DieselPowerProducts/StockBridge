const { getSql } = require("../db/neon");

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeMessageId(value) {
  return normalizeText(value)
    .replace(/^mailto:/i, "")
    .replace(/[<>\s]/g, "")
    .toLowerCase();
}

function normalizeSubject(value) {
  let subject = normalizeText(value);

  while (/^(?:re|fw|fwd)\s*:\s*/i.test(subject)) {
    subject = subject.replace(/^(?:re|fw|fwd)\s*:\s*/i, "");
  }

  return subject.replace(/\s+/g, " ").trim().toLowerCase();
}

function assertRequiredText(value, message) {
  const normalized = normalizeText(value);

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS stock_check_vendor_emails (
          id BIGSERIAL PRIMARY KEY,
          sku TEXT NOT NULL,
          vendor_id TEXT NOT NULL DEFAULT '',
          vendor_name TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          sent_by_email TEXT,
          sent_by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE stock_check_vendor_emails
        ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT ''
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS stock_check_vendor_emails_sku_idx
        ON stock_check_vendor_emails (upper(sku))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS stock_check_vendor_emails_vendor_idx
        ON stock_check_vendor_emails (vendor_id)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS stock_check_vendor_emails_message_id_idx
        ON stock_check_vendor_emails (
          lower(regexp_replace(message_id, '[<>\\s]', '', 'g'))
        )
        WHERE message_id <> ''
      `;
    })();
  }

  return schemaReady;
}

async function recordVendorEmail(
  {
    sku,
    vendorId = "",
    vendorName = "",
    recipientEmail = "",
    subject = "",
    messageId = ""
  },
  sender = {}
) {
  const safeSku = normalizeSku(assertRequiredText(sku, "Product SKU is required."));
  const safeRecipientEmail = normalizeEmail(
    assertRequiredText(recipientEmail, "Recipient email is required.")
  );
  const safeSubject = normalizeText(subject);

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO stock_check_vendor_emails (
      sku,
      vendor_id,
      vendor_name,
      recipient_email,
      subject,
      message_id,
      sent_by_email,
      sent_by_name
    )
    VALUES (
      ${safeSku},
      ${normalizeText(vendorId)},
      ${normalizeText(vendorName)},
      ${safeRecipientEmail},
      ${safeSubject},
      ${normalizeText(messageId)},
      ${normalizeEmail(sender?.email) || null},
      ${normalizeText(sender?.name || sender?.email) || null}
    )
    RETURNING id::text, sku, created_at
  `;

  return {
    id: String(rows[0]?.id || ""),
    sku: String(rows[0]?.sku || safeSku),
    createdAt: rows[0]?.created_at
      ? new Date(rows[0].created_at).toISOString()
      : ""
  };
}

function mapVendorEmailRow(row) {
  return {
    id: String(row?.id || ""),
    sku: String(row?.sku || ""),
    vendorId: String(row?.vendor_id || ""),
    vendorName: String(row?.vendor_name || ""),
    recipientEmail: normalizeEmail(row?.recipient_email),
    subject: String(row?.subject || ""),
    messageId: String(row?.message_id || ""),
    createdAt: row?.created_at
      ? new Date(row.created_at).toISOString()
      : ""
  };
}

function scoreVendorEmailCandidate(candidate, { senderEmail, subject }) {
  const normalizedIncomingSubject = normalizeSubject(subject);
  const normalizedCandidateSubject = normalizeSubject(candidate.subject);
  const normalizedSku = normalizeSku(candidate.sku);
  const senderMatches =
    normalizeEmail(candidate.recipientEmail) === normalizeEmail(senderEmail);
  const subjectMatches =
    Boolean(normalizedIncomingSubject) &&
    normalizedIncomingSubject === normalizedCandidateSubject;
  const subjectContainsSku =
    Boolean(normalizedIncomingSubject) &&
    Boolean(normalizedSku) &&
    normalizedIncomingSubject.toUpperCase().includes(normalizedSku);

  if (!subjectMatches && !subjectContainsSku) {
    return 0;
  }

  return (
    (senderMatches ? 100 : 0) +
    (subjectMatches ? 50 : 0) +
    (subjectContainsSku ? 25 : 0)
  );
}

async function findMatchingVendorEmail({
  messageIds = [],
  senderEmail = "",
  subject = ""
} = {}) {
  await initializeSchema();

  const sql = getSql();
  const safeMessageIds = Array.from(
    new Set((messageIds || []).map(normalizeMessageId).filter(Boolean))
  );

  if (safeMessageIds.length > 0) {
    const exactRows = await sql.query(
      `
        SELECT
          id::text,
          sku,
          vendor_id,
          vendor_name,
          recipient_email,
          subject,
          message_id,
          created_at
        FROM stock_check_vendor_emails
        WHERE lower(regexp_replace(message_id, '[<>\\s]', '', 'g')) IN (
          SELECT jsonb_array_elements_text($1::jsonb)
        )
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [JSON.stringify(safeMessageIds)]
    );

    if (exactRows[0]) {
      return mapVendorEmailRow(exactRows[0]);
    }
  }

  const candidateRows = await sql`
    SELECT
      id::text,
      sku,
      vendor_id,
      vendor_name,
      recipient_email,
      subject,
      message_id,
      created_at
    FROM stock_check_vendor_emails
    WHERE created_at >= now() - INTERVAL '1 year'
    ORDER BY created_at DESC, id DESC
    LIMIT 1000
  `;
  const candidates = candidateRows
    .map(mapVendorEmailRow)
    .map((candidate) => ({
      candidate,
      score: scoreVendorEmailCandidate(candidate, {
        senderEmail,
        subject
      })
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        new Date(right.candidate.createdAt).getTime() -
          new Date(left.candidate.createdAt).getTime()
    );

  if (candidates.length === 0) {
    return null;
  }

  const topScore = candidates[0].score;
  const topCandidates = candidates.filter((entry) => entry.score === topScore);
  const topKeys = new Set(
    topCandidates.map(
      ({ candidate }) =>
        `${normalizeSku(candidate.sku)}|${normalizeText(candidate.vendorId)}`
    )
  );

  return topKeys.size === 1 ? topCandidates[0].candidate : null;
}

async function getEmailedSkuSetForSkus(skus) {
  const safeSkus = Array.from(
    new Set((skus || []).map(normalizeSku).filter(Boolean))
  );

  if (safeSkus.length === 0) {
    return new Set();
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql.query(
    `
      SELECT DISTINCT upper(sku) AS sku
      FROM stock_check_vendor_emails
      WHERE upper(sku) IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
    `,
    [JSON.stringify(safeSkus)]
  );

  return new Set(rows.map((row) => normalizeSku(row?.sku)).filter(Boolean));
}

async function clearVendorEmailsForSku(sku) {
  const safeSku = normalizeSku(assertRequiredText(sku, "Product SKU is required."));

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    DELETE FROM stock_check_vendor_emails
    WHERE upper(sku) = ${safeSku}
    RETURNING id::text
  `;

  return {
    deleted: rows.length
  };
}

module.exports = {
  clearVendorEmailsForSku,
  findMatchingVendorEmail,
  getEmailedSkuSetForSkus,
  recordVendorEmail,
  _test: {
    normalizeMessageId,
    normalizeSubject,
    scoreVendorEmailCandidate
  }
};
