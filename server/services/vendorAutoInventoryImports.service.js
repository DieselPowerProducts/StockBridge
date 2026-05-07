const { getSql } = require("../db/neon");

let schemaReady;
const currentImportVersion = 3;

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
          import_version INTEGER NOT NULL DEFAULT 3,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_imports
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_imports
        ADD COLUMN IF NOT EXISTS import_version INTEGER NOT NULL DEFAULT 1
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS vendor_auto_inventory_imports_hash_idx
        ON vendor_auto_inventory_imports (vendor_id, attachment_hash)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_imports_vendor_idx
        ON vendor_auto_inventory_imports (vendor_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_imports_vendor_seen_idx
        ON vendor_auto_inventory_imports (vendor_id, last_seen_at DESC)
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
    AND status = 'completed'
    AND error_count = 0
    AND import_version = ${currentImportVersion}
    LIMIT 1
  `;

  return rows.length > 0;
}

async function touchProcessedAttachment({
  vendorId,
  messageUid,
  messageId,
  senderEmail,
  attachmentFilename,
  attachmentHash
}) {
  const safeVendorId = normalizeText(vendorId);
  const safeHash = normalizeText(attachmentHash);

  if (!safeVendorId || !safeHash) {
    return {
      id: ""
    };
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    UPDATE vendor_auto_inventory_imports
    SET
      message_uid = ${normalizeText(messageUid)},
      message_id = ${normalizeText(messageId)},
      sender_email = ${normalizeText(senderEmail).toLowerCase()},
      attachment_filename = ${normalizeText(attachmentFilename)},
      import_version = ${currentImportVersion},
      last_seen_at = now()
    WHERE vendor_id = ${safeVendorId}
    AND attachment_hash = ${safeHash}
    RETURNING id::text
  `;

  return {
    id: String(rows[0]?.id || "")
  };
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
      error_message,
      import_version
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
      ${normalizeText(errorMessage)},
      ${currentImportVersion}
    )
    ON CONFLICT (vendor_id, attachment_hash) DO UPDATE
    SET
      message_uid = EXCLUDED.message_uid,
      message_id = EXCLUDED.message_id,
      sender_email = EXCLUDED.sender_email,
      attachment_filename = EXCLUDED.attachment_filename,
      imported_count = EXCLUDED.imported_count,
      skipped_count = EXCLUDED.skipped_count,
      error_count = EXCLUDED.error_count,
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      import_version = EXCLUDED.import_version,
      last_seen_at = now()
    RETURNING id::text
  `;

  return {
    id: String(rows[0]?.id || "")
  };
}

async function getLastSuccessfulImportForVendor(vendorId) {
  const safeVendorId = normalizeText(vendorId);

  if (!safeVendorId) {
    return "";
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT COALESCE(last_seen_at, created_at) AS imported_at
    FROM vendor_auto_inventory_imports
    WHERE vendor_id = ${safeVendorId}
    AND status IN ('completed', 'completed_with_errors')
    ORDER BY COALESCE(last_seen_at, created_at) DESC
    LIMIT 1
  `;

  return rows[0]?.imported_at ? new Date(rows[0].imported_at).toISOString() : "";
}

module.exports = {
  getLastSuccessfulImportForVendor,
  hasProcessedAttachment,
  initializeSchema,
  recordImport,
  touchProcessedAttachment
};
