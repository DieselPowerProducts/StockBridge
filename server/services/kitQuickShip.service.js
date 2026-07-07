const { getSql } = require("../db/neon");
const shopifyService = require("./shopify.service");

let schemaReady;

function normalizeQuickShip(value) {
  return Number(value || 0) > 0 ? 1 : 0;
}

function normalizeSyncRecord(record) {
  return {
    parentProductId: String(record?.parentProductId || record?.parent_product_id || "").trim(),
    productName: String(record?.productName || record?.product_name || "").trim(),
    quickShip: normalizeQuickShip(record?.quickShip ?? record?.quick_ship),
    sku: String(record?.sku || "").trim()
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    const sql = getSql();

    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS kit_quick_ship_state (
          parent_product_id TEXT PRIMARY KEY,
          sku TEXT NOT NULL,
          last_calculated_quick_ship INTEGER NOT NULL DEFAULT 0,
          last_pushed_quick_ship INTEGER,
          last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_pushed_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kit_quick_ship_state_sku_idx
        ON kit_quick_ship_state (sku)
      `;
    })();
  }

  return schemaReady;
}

async function getKitQuickShipChanges() {
  await initializeSchema();

  const sql = getSql();
  return sql`
    WITH kit_requirements AS (
      SELECT
        parent.product_id AS parent_product_id,
        parent.sku AS parent_sku,
        parent.name AS parent_name,
        component.child_sku,
        SUM(GREATEST(COALESCE(component.qty_required, 1), 1)) AS required_qty
      FROM catalog_products parent
      JOIN catalog_product_components component
        ON component.parent_product_id = parent.product_id
      WHERE parent.is_kit = TRUE
        AND parent.sku <> ''
        AND lower(COALESCE(parent.state, 'Active')) = 'active'
      GROUP BY
        parent.product_id,
        parent.sku,
        parent.name,
        component.child_sku
    ),
    child_products AS (
      SELECT
        lower(sku) AS sku_key,
        product_id
      FROM catalog_products
      WHERE sku <> ''
        AND lower(COALESCE(state, 'Active')) = 'active'
    ),
    warehouse_stock AS (
      SELECT
        product_id,
        COALESCE(SUM(qty_available), 0) AS qty_available
      FROM catalog_warehouse_stock
      GROUP BY product_id
    ),
    evaluated_components AS (
      SELECT
        requirement.parent_product_id,
        requirement.parent_sku,
        requirement.parent_name,
        requirement.child_sku,
        requirement.required_qty,
        child.product_id AS child_product_id,
        COALESCE(stock.qty_available, 0) AS qty_available
      FROM kit_requirements requirement
      LEFT JOIN child_products child
        ON child.sku_key = lower(requirement.child_sku)
      LEFT JOIN warehouse_stock stock
        ON stock.product_id = child.product_id
    ),
    calculated AS (
      SELECT
        parent_product_id,
        parent_sku AS sku,
        parent_name AS product_name,
        CASE
          WHEN COUNT(*) > 0
            AND BOOL_AND(child_product_id IS NOT NULL AND qty_available >= required_qty)
          THEN 1
          ELSE 0
        END AS quick_ship
      FROM evaluated_components
      GROUP BY parent_product_id, parent_sku, parent_name
    )
    SELECT
      calculated.parent_product_id AS "parentProductId",
      calculated.sku,
      calculated.product_name AS "productName",
      calculated.quick_ship AS "quickShip"
    FROM calculated
    LEFT JOIN kit_quick_ship_state state
      ON state.parent_product_id = calculated.parent_product_id
    WHERE state.last_pushed_quick_ship IS DISTINCT FROM calculated.quick_ship
    ORDER BY calculated.sku ASC
  `;
}

async function recordSuccessfulSyncs(records, syncedAt) {
  const safeRecords = (records || []).map(normalizeSyncRecord).filter(
    (record) => record.parentProductId && record.sku
  );

  if (safeRecords.length === 0) {
    return;
  }

  await initializeSchema();

  const sql = getSql();
  await sql.query(
    `
      INSERT INTO kit_quick_ship_state (
        parent_product_id,
        sku,
        last_calculated_quick_ship,
        last_pushed_quick_ship,
        last_calculated_at,
        last_pushed_at,
        last_error,
        updated_at
      )
      SELECT
        row.parent_product_id,
        row.sku,
        row.quick_ship,
        row.quick_ship,
        $2::timestamptz,
        $2::timestamptz,
        '',
        $2::timestamptz
      FROM jsonb_to_recordset($1::jsonb) AS row(
        parent_product_id text,
        sku text,
        quick_ship integer
      )
      ON CONFLICT (parent_product_id) DO UPDATE
      SET sku = EXCLUDED.sku,
          last_calculated_quick_ship = EXCLUDED.last_calculated_quick_ship,
          last_pushed_quick_ship = EXCLUDED.last_pushed_quick_ship,
          last_calculated_at = EXCLUDED.last_calculated_at,
          last_pushed_at = EXCLUDED.last_pushed_at,
          last_error = '',
          updated_at = EXCLUDED.updated_at
    `,
    [
      JSON.stringify(
        safeRecords.map((record) => ({
          parent_product_id: record.parentProductId,
          quick_ship: record.quickShip,
          sku: record.sku
        }))
      ),
      syncedAt
    ]
  );
}

async function recordFailedSyncs(records, syncedAt) {
  const safeRecords = (records || [])
    .map((record) => ({
      ...normalizeSyncRecord(record),
      error: String(record?.error || "Unable to update Shopify quick ship.").slice(
        0,
        1000
      )
    }))
    .filter((record) => record.parentProductId && record.sku);

  if (safeRecords.length === 0) {
    return;
  }

  await initializeSchema();

  const sql = getSql();
  await sql.query(
    `
      INSERT INTO kit_quick_ship_state (
        parent_product_id,
        sku,
        last_calculated_quick_ship,
        last_calculated_at,
        last_error,
        updated_at
      )
      SELECT
        row.parent_product_id,
        row.sku,
        row.quick_ship,
        $2::timestamptz,
        row.error,
        $2::timestamptz
      FROM jsonb_to_recordset($1::jsonb) AS row(
        parent_product_id text,
        sku text,
        quick_ship integer,
        error text
      )
      ON CONFLICT (parent_product_id) DO UPDATE
      SET sku = EXCLUDED.sku,
          last_calculated_quick_ship = EXCLUDED.last_calculated_quick_ship,
          last_calculated_at = EXCLUDED.last_calculated_at,
          last_error = EXCLUDED.last_error,
          updated_at = EXCLUDED.updated_at
    `,
    [
      JSON.stringify(
        safeRecords.map((record) => ({
          error: record.error,
          parent_product_id: record.parentProductId,
          quick_ship: record.quickShip,
          sku: record.sku
        }))
      ),
      syncedAt
    ]
  );
}

async function syncKitQuickShipMetafields() {
  const changes = (await getKitQuickShipChanges()).map(normalizeSyncRecord);

  if (changes.length === 0) {
    return {
      failed: 0,
      requested: 0,
      updated: 0
    };
  }

  const syncedAt = new Date().toISOString();
  const result = await shopifyService.updateQuickShipMetafields(changes);
  const successfulRecords = result.results.filter((item) => item.ok);
  const failedRecords = result.results.filter((item) => !item.ok);

  await recordSuccessfulSyncs(successfulRecords, syncedAt);
  await recordFailedSyncs(failedRecords, syncedAt);

  return {
    failed: result.failed,
    requested: result.requested,
    updated: result.updated
  };
}

module.exports = {
  getKitQuickShipChanges,
  syncKitQuickShipMetafields
};
