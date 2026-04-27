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
          sent_by_email TEXT,
          sent_by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS stock_check_vendor_emails_sku_idx
        ON stock_check_vendor_emails (upper(sku))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS stock_check_vendor_emails_vendor_idx
        ON stock_check_vendor_emails (vendor_id)
      `;
    })();
  }

  return schemaReady;
}

async function recordVendorEmail(
  { sku, vendorId = "", vendorName = "", recipientEmail = "", subject = "" },
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
      sent_by_email,
      sent_by_name
    )
    VALUES (
      ${safeSku},
      ${normalizeText(vendorId)},
      ${normalizeText(vendorName)},
      ${safeRecipientEmail},
      ${safeSubject},
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
  getEmailedSkuSetForSkus,
  recordVendorEmail
};
