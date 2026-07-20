const { getSql } = require("../db/neon");
const catalogService = require("./catalog.service");
const productsService = require("./products.service");

const defaultPageSize = 50;
const maxPageSize = 100;

function normalizePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeRequiredString(value, message) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function mapAuditRow(row) {
  return {
    vendorProductId: String(row.vendor_product_id || ""),
    sku: String(row.product_sku || row.vendor_sku || ""),
    vendorSku: String(row.vendor_sku || ""),
    vendorId: String(row.vendor_id || ""),
    vendorName: String(row.vendor_name || row.vendor_id || ""),
    currentPrice:
      row.current_price === null || row.current_price === undefined
        ? null
        : Number(row.current_price),
    newProductCost: Number(row.pending_price),
    priceSourceUrl: String(row.pending_price_source_url || ""),
    updatedAt: row.pending_price_updated_at || ""
  };
}

async function listPriceAudits({ page, limit, search } = {}) {
  await catalogService.initializeCatalogSchema();
  const sql = getSql();
  const safePage = normalizePositiveInteger(page, 1);
  const safeLimit = normalizePositiveInteger(limit, defaultPageSize, maxPageSize);
  const safeSearch = String(search || "").trim();
  const searchPattern = `%${safeSearch}%`;
  const offset = (safePage - 1) * safeLimit;
  const [rows, countRows] = await Promise.all([
    sql`
      SELECT
        vp.vendor_product_id,
        vp.vendor_id,
        vp.sku AS vendor_sku,
        vp.price AS current_price,
        vp.pending_price,
        vp.pending_price_source_url,
        vp.pending_price_updated_at,
        p.sku AS product_sku,
        COALESCE(NULLIF(v.name, ''), NULLIF(v.label, ''), vp.vendor_id) AS vendor_name
      FROM catalog_vendor_products vp
      JOIN catalog_products p ON p.product_id = vp.product_id
      LEFT JOIN catalog_vendors v ON v.vendor_id = vp.vendor_id
      WHERE vp.pending_price IS NOT NULL
        AND (
          ${safeSearch} = ''
          OR p.sku ILIKE ${searchPattern}
          OR vp.sku ILIKE ${searchPattern}
          OR vp.label ILIKE ${searchPattern}
          OR v.name ILIKE ${searchPattern}
          OR v.label ILIKE ${searchPattern}
        )
      ORDER BY vp.pending_price_updated_at DESC NULLS LAST, p.sku ASC, vp.vendor_product_id ASC
      LIMIT ${safeLimit}
      OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM catalog_vendor_products vp
      JOIN catalog_products p ON p.product_id = vp.product_id
      LEFT JOIN catalog_vendors v ON v.vendor_id = vp.vendor_id
      WHERE vp.pending_price IS NOT NULL
        AND (
          ${safeSearch} = ''
          OR p.sku ILIKE ${searchPattern}
          OR vp.sku ILIKE ${searchPattern}
          OR vp.label ILIKE ${searchPattern}
          OR v.name ILIKE ${searchPattern}
          OR v.label ILIKE ${searchPattern}
        )
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

async function confirmPriceAudit(vendorProductId) {
  await catalogService.initializeCatalogSchema();
  const safeVendorProductId = normalizeRequiredString(
    vendorProductId,
    "Vendor product ID is required."
  );
  const sql = getSql();
  const rows = await sql`
    SELECT
      vp.vendor_product_id,
      vp.vendor_id,
      vp.sku AS vendor_sku,
      vp.label AS vendor_label,
      vp.pending_price,
      p.sku AS product_sku
    FROM catalog_vendor_products vp
    JOIN catalog_products p ON p.product_id = vp.product_id
    WHERE vp.vendor_product_id = ${safeVendorProductId}
    LIMIT 1
  `;
  const pending = rows[0];

  if (!pending) {
    const error = new Error("Price audit item not found.");
    error.statusCode = 404;
    throw error;
  }

  if (pending.pending_price === null || pending.pending_price === undefined) {
    const error = new Error("This price proposal has already been handled.");
    error.statusCode = 409;
    throw error;
  }

  const productSku = normalizeRequiredString(
    pending.product_sku,
    "The price audit item does not have a product SKU."
  );
  const vendorSku = normalizeRequiredString(
    pending.vendor_sku || pending.vendor_label || productSku,
    "The price audit item does not have a vendor SKU."
  );
  const newPrice = Number(pending.pending_price);

  await productsService.setProductVendorDetails({
    sku: productSku,
    vendorId: pending.vendor_id,
    vendorProductId: safeVendorProductId,
    vendorSku,
    productCost: newPrice
  });

  const clearedRows = await sql`
    UPDATE catalog_vendor_products
    SET
      pending_price = NULL,
      pending_price_source_url = '',
      pending_price_updated_at = NULL
    WHERE vendor_product_id = ${safeVendorProductId}
    RETURNING vendor_product_id
  `;

  if (clearedRows.length === 0) {
    const error = new Error(
      "The vendor cost was updated, but the price audit could not be removed."
    );
    error.statusCode = 409;
    throw error;
  }

  return {
    vendorProductId: safeVendorProductId,
    sku: productSku,
    currentPrice: newPrice
  };
}

module.exports = {
  confirmPriceAudit,
  listPriceAudits
};
