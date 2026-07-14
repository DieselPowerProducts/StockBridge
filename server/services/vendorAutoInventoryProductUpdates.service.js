const { getSql } = require("../db/neon");

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeQuantity(value) {
  const quantity = Number(value || 0);

  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 0;
}

function formatUpdate(row) {
  return {
    vendorProductId: normalizeText(row?.vendor_product_id),
    vendorId: normalizeText(row?.vendor_id),
    productId: normalizeText(row?.product_id),
    sku: normalizeText(row?.sku),
    sheetSku: normalizeText(row?.sheet_sku),
    quantity: normalizeQuantity(row?.quantity),
    inventoryValue: normalizeText(row?.inventory_value),
    subtractiveValue: normalizeText(row?.subtractive_value),
    attachmentFilename: normalizeText(row?.attachment_filename),
    messageId: normalizeText(row?.message_id),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

function normalizeUpdate(input = {}) {
  return {
    vendorProductId: normalizeText(input.vendorProductId),
    vendorId: normalizeText(input.vendorId),
    productId: normalizeText(input.productId),
    sku: normalizeText(input.sku),
    sheetSku: normalizeText(input.sheetSku),
    quantity: normalizeQuantity(input.quantity),
    inventoryValue: normalizeText(input.inventoryValue),
    subtractiveValue: normalizeText(input.subtractiveValue),
    attachmentFilename: normalizeText(input.attachmentFilename),
    messageId: normalizeText(input.messageId)
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS vendor_auto_inventory_product_updates (
          vendor_product_id TEXT PRIMARY KEY,
          vendor_id TEXT NOT NULL DEFAULT '',
          product_id TEXT NOT NULL DEFAULT '',
          sku TEXT NOT NULL DEFAULT '',
          sheet_sku TEXT NOT NULL DEFAULT '',
          quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
          inventory_value TEXT NOT NULL DEFAULT '',
          subtractive_value TEXT NOT NULL DEFAULT '',
          attachment_filename TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_product_updates_vendor_idx
        ON vendor_auto_inventory_product_updates (vendor_id, updated_at DESC)
      `;
    })();
  }

  return schemaReady;
}

async function replaceVendorProductUpdatesForVendor({ vendorId, updates = [] }) {
  const safeVendorId = normalizeText(vendorId);

  if (!safeVendorId) {
    return [];
  }

  await initializeSchema();

  const sql = getSql();
  const normalizedUpdatesByVendorProductId = new Map();

  for (const update of updates) {
    const normalizedUpdate = normalizeUpdate({
      ...update,
      vendorId: safeVendorId
    });

    if (normalizedUpdate.vendorProductId) {
      normalizedUpdatesByVendorProductId.set(
        normalizedUpdate.vendorProductId,
        normalizedUpdate
      );
    }
  }

  const normalizedUpdates = Array.from(
    normalizedUpdatesByVendorProductId.values()
  );

  for (const update of normalizedUpdates) {
    await sql`
      INSERT INTO vendor_auto_inventory_product_updates (
        vendor_product_id,
        vendor_id,
        product_id,
        sku,
        sheet_sku,
        quantity,
        inventory_value,
        subtractive_value,
        attachment_filename,
        message_id,
        updated_at
      )
      VALUES (
        ${update.vendorProductId},
        ${update.vendorId},
        ${update.productId},
        ${update.sku},
        ${update.sheetSku},
        ${update.quantity},
        ${update.inventoryValue},
        ${update.subtractiveValue},
        ${update.attachmentFilename},
        ${update.messageId},
        now()
      )
      ON CONFLICT (vendor_product_id) DO UPDATE
      SET
        vendor_id = EXCLUDED.vendor_id,
        product_id = EXCLUDED.product_id,
        sku = EXCLUDED.sku,
        sheet_sku = EXCLUDED.sheet_sku,
        quantity = EXCLUDED.quantity,
        inventory_value = EXCLUDED.inventory_value,
        subtractive_value = EXCLUDED.subtractive_value,
        attachment_filename = EXCLUDED.attachment_filename,
        message_id = EXCLUDED.message_id,
        updated_at = now()
    `;
  }

  if (normalizedUpdates.length === 0) {
    await sql`
      DELETE FROM vendor_auto_inventory_product_updates
      WHERE vendor_id = ${safeVendorId}
    `;
  } else {
    const vendorProductIdJson = JSON.stringify(
      normalizedUpdates.map((update) => update.vendorProductId)
    );

    await sql`
      DELETE FROM vendor_auto_inventory_product_updates
      WHERE vendor_id = ${safeVendorId}
      AND vendor_product_id NOT IN (
        SELECT jsonb_array_elements_text(${vendorProductIdJson}::jsonb)
      )
    `;
  }

  return normalizedUpdates;
}

async function getUpdatesForVendorProductIds(vendorProductIds) {
  const safeVendorProductIds = Array.from(
    new Set((vendorProductIds || []).map(normalizeText).filter(Boolean))
  );

  if (safeVendorProductIds.length === 0) {
    return new Map();
  }

  await initializeSchema();

  const sql = getSql();
  const vendorProductIdJson = JSON.stringify(safeVendorProductIds);
  const rows = await sql`
    SELECT
      vendor_product_id,
      vendor_id,
      product_id,
      sku,
      sheet_sku,
      quantity,
      inventory_value,
      subtractive_value,
      attachment_filename,
      message_id,
      updated_at
    FROM vendor_auto_inventory_product_updates
    WHERE vendor_product_id IN (
      SELECT jsonb_array_elements_text(${vendorProductIdJson}::jsonb)
    )
  `;

  return new Map(
    rows.map((row) => {
      const update = formatUpdate(row);

      return [update.vendorProductId, update];
    })
  );
}

async function deleteUpdatesForVendorProductIds(vendorProductIds) {
  const safeVendorProductIds = Array.from(
    new Set((vendorProductIds || []).map(normalizeText).filter(Boolean))
  );

  if (safeVendorProductIds.length === 0) {
    return 0;
  }

  await initializeSchema();

  const sql = getSql();
  const vendorProductIdJson = JSON.stringify(safeVendorProductIds);
  const rows = await sql`
    WITH deleted AS (
      DELETE FROM vendor_auto_inventory_product_updates
      WHERE vendor_product_id IN (
        SELECT jsonb_array_elements_text(${vendorProductIdJson}::jsonb)
      )
      RETURNING vendor_product_id
    )
    SELECT COUNT(*)::integer AS deleted_count
    FROM deleted
  `;

  return Number(rows[0]?.deleted_count || 0);
}

module.exports = {
  deleteUpdatesForVendorProductIds,
  getUpdatesForVendorProductIds,
  initializeSchema,
  replaceVendorProductUpdatesForVendor
};
