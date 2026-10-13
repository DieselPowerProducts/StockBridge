const { getSql } = require("../db/neon");

const pageSize = 30;
const maxPageSize = 100;
let schemaReady;

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeVendor(value) {
  return String(value || "").trim();
}

function normalizePaging(query = {}) {
  const page = Math.max(1, Number.parseInt(String(query.page || 1), 10) || 1);
  const limit = Math.max(1, Math.min(maxPageSize, Number.parseInt(String(query.limit || pageSize), 10) || pageSize));
  return { page, limit, offset: (page - 1) * limit };
}

function collapseVariantBrands(variants) {
  const bySku = new Map();
  for (const variant of variants || []) {
    const sku = normalizeSku(variant?.sku);
    if (!sku) continue;
    const vendor = normalizeVendor(variant?.product?.vendor);
    const productId = String(variant?.product?.id || "").trim();
    const current = bySku.get(sku);
    if (!current) {
      bySku.set(sku, { sku, vendor, productId, conflictingVendor: false });
    } else if (current.vendor.toLowerCase() !== vendor.toLowerCase()) {
      current.conflictingVendor = true;
    }
  }
  return Array.from(bySku.values());
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS shopify_brand_skus (
          sku TEXT NOT NULL,
          vendor TEXT NOT NULL DEFAULT '',
          shopify_product_id TEXT NOT NULL DEFAULT '',
          conflicting_vendor BOOLEAN NOT NULL DEFAULT FALSE,
          scan_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (scan_id, sku)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS shopify_brand_skus_scan_idx
        ON shopify_brand_skus (scan_id)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shopify_brand_sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          completed_scan_id TEXT NOT NULL,
          completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function saveScanPage(scanId, variants) {
  const records = collapseVariantBrands(variants);
  if (records.length === 0) return 0;
  await initializeSchema();
  const sql = getSql();
  await sql.query(`
    INSERT INTO shopify_brand_skus (
      sku, vendor, shopify_product_id, conflicting_vendor, scan_id, updated_at
    )
    SELECT sku, vendor, product_id, conflicting_vendor, $2, now()
    FROM jsonb_to_recordset($1::jsonb) AS incoming(
      sku TEXT, vendor TEXT, product_id TEXT, conflicting_vendor BOOLEAN
    )
    ON CONFLICT (scan_id, sku) DO UPDATE SET
      vendor = CASE
        WHEN shopify_brand_skus.conflicting_vendor OR EXCLUDED.conflicting_vendor
          OR lower(shopify_brand_skus.vendor) <> lower(EXCLUDED.vendor)
        THEN '' ELSE EXCLUDED.vendor END,
      shopify_product_id = EXCLUDED.shopify_product_id,
      conflicting_vendor = shopify_brand_skus.conflicting_vendor OR EXCLUDED.conflicting_vendor
        OR lower(shopify_brand_skus.vendor) <> lower(EXCLUDED.vendor),
      updated_at = now()
  `, [JSON.stringify(records.map((record) => ({
    sku: record.sku,
    vendor: record.vendor,
    product_id: record.productId,
    conflicting_vendor: record.conflictingVendor
  }))), scanId]);
  return records.length;
}

async function completeScan(scanId) {
  await initializeSchema();
  const sql = getSql();
  await sql`
    INSERT INTO shopify_brand_sync_state (id, completed_scan_id, completed_at)
    VALUES (1, ${scanId}, now())
    ON CONFLICT (id) DO UPDATE SET
      completed_scan_id = EXCLUDED.completed_scan_id,
      completed_at = EXCLUDED.completed_at
  `;
  await sql`DELETE FROM shopify_brand_skus WHERE scan_id <> ${scanId}`;
}

async function discardScan(scanId) {
  await initializeSchema();
  const sql = getSql();
  await sql`
    DELETE FROM shopify_brand_skus
    WHERE scan_id = ${scanId}
      AND scan_id <> COALESCE(
        (SELECT completed_scan_id FROM shopify_brand_sync_state WHERE id = 1), ''
      )
  `;
}

async function getSyncState() {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT completed_scan_id, completed_at
    FROM shopify_brand_sync_state
    WHERE id = 1
  `;
  return rows[0] || null;
}

const brandProductsSql = `
  WITH assigned AS (
    SELECT p.product_id, p.sku, p.name, p.is_kit,
      CASE
        WHEN b.sku IS NULL THEN 'unmatched'
        WHEN b.conflicting_vendor THEN 'conflict'
        WHEN b.vendor = '' THEN 'blank'
        ELSE 'vendor:' || lower(b.vendor)
      END AS brand_key,
      CASE
        WHEN b.sku IS NULL THEN 'Not in Shopify'
        WHEN b.conflicting_vendor THEN 'Conflicting Shopify vendors'
        WHEN b.vendor = '' THEN 'No Shopify vendor'
        ELSE b.vendor
      END AS brand_name
    FROM catalog_products p
    LEFT JOIN shopify_brand_skus b
      ON b.sku = upper(trim(p.sku)) AND b.scan_id = $1
    WHERE lower(COALESCE(p.state, 'Active')) = 'active'
  )
`;

async function listBrands(query = {}) {
  await Promise.all([initializeSchema(), require("./catalog.service").initializeCatalogSchema()]);
  const sync = await getSyncState();
  if (!sync) return { data: [], total: 0, totalProducts: 0, syncedAt: "", ready: false };
  const { limit, offset } = normalizePaging(query);
  const search = String(query.search || "").trim();
  const sql = getSql();
  const rows = await sql.query(`${brandProductsSql}
    SELECT brand_key, MIN(brand_name) AS brand_name, COUNT(*)::int AS product_count,
      COUNT(*) OVER()::int AS total_groups,
      SUM(COUNT(*)) OVER()::int AS total_products
    FROM assigned
    WHERE $2 = '' OR brand_name ILIKE $3
    GROUP BY brand_key
    ORDER BY MIN(brand_name) ASC
    LIMIT $4 OFFSET $5
  `, [sync.completed_scan_id, search, `%${search}%`, limit, offset]);
  return {
    data: rows.map((row) => ({
      key: row.brand_key,
      name: row.brand_name,
      productCount: Number(row.product_count)
    })),
    total: Number(rows[0]?.total_groups || 0),
    totalProducts: Number(rows[0]?.total_products || 0),
    syncedAt: sync.completed_at,
    ready: true
  };
}

async function listBrandProducts(query = {}) {
  await Promise.all([initializeSchema(), require("./catalog.service").initializeCatalogSchema()]);
  const sync = await getSyncState();
  if (!sync) {
    const error = new Error("Shopify brands are waiting for their first sync.");
    error.statusCode = 409;
    throw error;
  }
  const brandKey = String(query.brand || "").trim();
  if (!brandKey) {
    const error = new Error("Choose a brand.");
    error.statusCode = 400;
    throw error;
  }
  const { page, limit, offset } = normalizePaging(query);
  const search = String(query.search || "").trim();
  const sql = getSql();
  const brandRows = await sql.query(`${brandProductsSql}
    SELECT MIN(brand_name) AS brand_name
    FROM assigned
    WHERE brand_key = $2
  `, [sync.completed_scan_id, brandKey]);
  const rows = await sql.query(`${brandProductsSql}
    SELECT product_id, sku, name, is_kit, brand_name,
      COUNT(*) OVER()::int AS total_count
    FROM assigned
    WHERE brand_key = $2
      AND ($3 = '' OR sku ILIKE $4 OR name ILIKE $4)
    ORDER BY sku ASC
    LIMIT $5 OFFSET $6
  `, [sync.completed_scan_id, brandKey, search, `%${search}%`, limit, offset]);
  const total = Number(rows[0]?.total_count || 0);
  return {
    data: rows.map((row) => ({
      id: row.product_id,
      sku: row.sku,
      name: row.name,
      isKit: Boolean(row.is_kit)
    })),
    brandName: brandRows[0]?.brand_name || "",
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    isLastPage: page >= Math.ceil(total / limit),
    syncedAt: sync.completed_at
  };
}

module.exports = {
  collapseVariantBrands,
  completeScan,
  discardScan,
  getSyncState,
  listBrands,
  listBrandProducts,
  saveScanPage
};
