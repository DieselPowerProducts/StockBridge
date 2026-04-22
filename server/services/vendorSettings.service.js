const { getSql } = require("../db/neon");

let schemaReady;

function normalizeVendorId(vendorId) {
  return String(vendorId || "").trim();
}

function getDefaultSettings(vendorId = "") {
  return {
    vendorId,
    builtToOrder: false,
    buildTime: ""
  };
}

function assertVendorId(vendorId) {
  const safeVendorId = normalizeVendorId(vendorId);

  if (!safeVendorId) {
    const error = new Error("Vendor ID is required.");
    error.statusCode = 400;
    throw error;
  }

  return safeVendorId;
}

function normalizeBuildTime(buildTime) {
  const safeBuildTime = String(buildTime || "").trim();

  if (safeBuildTime.length > 120) {
    const error = new Error("Build time must be 120 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }

  return safeBuildTime;
}

function formatSettings(row) {
  return {
    vendorId: normalizeVendorId(row?.vendor_id),
    builtToOrder: Boolean(row?.built_to_order),
    buildTime: String(row?.build_time || "")
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS vendor_settings (
          vendor_id TEXT PRIMARY KEY,
          built_to_order BOOLEAN NOT NULL DEFAULT FALSE,
          build_time TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE vendor_settings
        ADD COLUMN IF NOT EXISTS built_to_order BOOLEAN NOT NULL DEFAULT FALSE
      `;
      await sql`
        ALTER TABLE vendor_settings
        ADD COLUMN IF NOT EXISTS build_time TEXT NOT NULL DEFAULT ''
      `;
    })();
  }

  return schemaReady;
}

async function getVendorSettingsByVendorIds(vendorIds) {
  const safeVendorIds = Array.from(
    new Set((vendorIds || []).map(normalizeVendorId).filter(Boolean))
  );

  if (safeVendorIds.length === 0) {
    return new Map();
  }

  await initializeSchema();

  const sql = getSql();
  const vendorIdJson = JSON.stringify(safeVendorIds);
  const rows = await sql`
    SELECT vendor_id, built_to_order, build_time
    FROM vendor_settings
    WHERE vendor_id IN (
      SELECT jsonb_array_elements_text(${vendorIdJson}::jsonb)
    )
  `;
  const settingsByVendorId = new Map(
    rows.map((row) => {
      const settings = formatSettings(row);

      return [settings.vendorId, settings];
    })
  );

  for (const vendorId of safeVendorIds) {
    if (!settingsByVendorId.has(vendorId)) {
      settingsByVendorId.set(vendorId, getDefaultSettings(vendorId));
    }
  }

  return settingsByVendorId;
}

async function getVendorSettings(vendorId) {
  const safeVendorId = assertVendorId(vendorId);
  const settingsByVendorId = await getVendorSettingsByVendorIds([safeVendorId]);

  return settingsByVendorId.get(safeVendorId) || getDefaultSettings(safeVendorId);
}

async function setVendorSettings({ vendorId, builtToOrder, buildTime }) {
  const safeVendorId = assertVendorId(vendorId);

  if (typeof builtToOrder !== "boolean") {
    const error = new Error("Built to Order must be true or false.");
    error.statusCode = 400;
    throw error;
  }

  const safeBuildTime = normalizeBuildTime(buildTime);

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO vendor_settings (vendor_id, built_to_order, build_time)
    VALUES (${safeVendorId}, ${builtToOrder}, ${safeBuildTime})
    ON CONFLICT (vendor_id) DO UPDATE
    SET built_to_order = EXCLUDED.built_to_order,
        build_time = EXCLUDED.build_time,
        updated_at = now()
    RETURNING vendor_id, built_to_order, build_time
  `;

  return formatSettings(rows[0] || {});
}

module.exports = {
  initializeSchema,
  getVendorSettings,
  getVendorSettingsByVendorIds,
  setVendorSettings
};
