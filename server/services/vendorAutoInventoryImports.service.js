const { getSql } = require("../db/neon");

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS vendor_auto_inventory_imports (
          id BIGSERIAL PRIMARY KEY,
          vendor_id TEXT NOT NULL DEFAULT '',
          message_uid TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          attachment_filename TEXT NOT NULL DEFAULT '',
          attachment_hash TEXT NOT NULL DEFAULT '',
          imported_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'completed',
          error_message TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_auto_inventory_imports_hash_idx
        ON vendor_auto_inventory_imports (vendor_id, attachment_hash)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_imports_vendor_idx
        ON vendor_auto_inventory_imports (vendor_id, created_at DESC)
      `;
    })();
  }

  return schemaReady;
}

async function hasProcessedAttachment(vendorId, attachmentHash) {
  const safeVendorId = normalizeText(vendorId);
  const safeHash = normalizeText(attachmentHash);

  if (!safeVendorId || !safeHash) {
    return false;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT id
    FROM vendor_auto_inventory_imports
    WHERE vendor_id = ${safeVendorId}
    AND attachment_hash = ${safeHash}
    LIMIT 1
  `;

  return rows.length > 0;
}

async function recordImport({
  vendorId,
  messageUid,
  messageId,
  senderEmail,
  attachmentFilename,
  attachmentHash,
  importedCount = 0,
  skippedCount = 0,
  errorCount = 0,
  status = "completed",
  errorMessage = ""
}) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO vendor_auto_inventory_imports (
      vendor_id,
      message_uid,
      message_id,
      sender_email,
      attachment_filename,
      attachment_hash,
      imported_count,
      skipped_count,
      error_count,
      status,
      error_message
    )
    VALUES (
      ${normalizeText(vendorId)},
      ${normalizeText(messageUid)},
      ${normalizeText(messageId)},
      ${normalizeText(senderEmail).toLowerCase()},
      ${normalizeText(attachmentFilename)},
      ${normalizeText(attachmentHash)},
      ${Math.max(Number(importedCount || 0), 0)},
      ${Math.max(Number(skippedCount || 0), 0)},
      ${Math.max(Number(errorCount || 0), 0)},
      ${normalizeText(status) || "completed"},
      ${normalizeText(errorMessage)}
    )
    ON CONFLICT (vendor_id, attachment_hash) DO NOTHING
    RETURNING id::text
  `;

  return {
    id: String(rows[0]?.id || "")
  };
}

module.exports = {
  hasProcessedAttachment,
  initializeSchema,
  recordImport
};
