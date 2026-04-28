const { getSql } = require("../db/neon");

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS vendor_default_contacts (
          vendor_id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL DEFAULT '',
          contact_email TEXT NOT NULL DEFAULT '',
          contact_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })();
  }

  return schemaReady;
}

function formatDefaultContact(row) {
  if (!row) {
    return null;
  }

  return {
    vendorId: normalizeText(row.vendor_id),
    contactId: normalizeText(row.contact_id),
    contactEmail: normalizeEmail(row.contact_email),
    contactName: normalizeText(row.contact_name)
  };
}

async function getDefaultContact(vendorId) {
  const safeVendorId = normalizeText(vendorId);

  if (!safeVendorId) {
    return null;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT vendor_id, contact_id, contact_email, contact_name
    FROM vendor_default_contacts
    WHERE vendor_id = ${safeVendorId}
    LIMIT 1
  `;

  return formatDefaultContact(rows[0]);
}

async function setDefaultContact({ vendorId, contactId, contactEmail, contactName }) {
  const safeVendorId = normalizeText(vendorId);
  const safeContactId = normalizeText(contactId);
  const safeContactEmail = normalizeEmail(contactEmail);
  const safeContactName = normalizeText(contactName);

  if (!safeVendorId) {
    const error = new Error("Vendor ID is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!safeContactId || !safeContactEmail) {
    const error = new Error("Vendor contact is required.");
    error.statusCode = 400;
    throw error;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO vendor_default_contacts (
      vendor_id,
      contact_id,
      contact_email,
      contact_name
    )
    VALUES (
      ${safeVendorId},
      ${safeContactId},
      ${safeContactEmail},
      ${safeContactName}
    )
    ON CONFLICT (vendor_id) DO UPDATE
    SET contact_id = EXCLUDED.contact_id,
        contact_email = EXCLUDED.contact_email,
        contact_name = EXCLUDED.contact_name,
        updated_at = now()
    RETURNING vendor_id, contact_id, contact_email, contact_name
  `;

  return formatDefaultContact(rows[0]);
}

module.exports = {
  getDefaultContact,
  setDefaultContact
};
