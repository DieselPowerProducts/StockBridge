const skunexus = require("./skunexus.service");

const vendorCacheTtlMs = 5 * 60 * 1000;
const vendorProductPageSize = 10000;
const vendorProductFetchConcurrency = 4;

let vendorCache;

function normalizePaging({ page = 1, limit = 50 } = {}) {
  return {
    page: Math.max(Number.parseInt(page, 10) || 1, 1),
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  };
}

function graphqlString(value) {
  return JSON.stringify(String(value || ""));
}

function graphqlStringList(values) {
  return values.map(graphqlString).join(", ");
}

function mapAvailability(qtyAvailable) {
  return Number(qtyAvailable || 0) > 0 ? "Available" : "Backorder";
}

async function fetchVendorProductsPage({ page, limit, vendorId = "" }) {
  const filter = vendorId
    ? `filter: { vendor_id: { operator: eq, value: [${graphqlString(vendorId)}] } }`
    : "";
  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        grid(
          ${filter}
          sort: { sku: ASC }
          limit: { size: ${limit}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
          rows {
            id
            vendor_id
            product_id
            sku
            label
            product {
              id
              sku
              name
            }
          }
        }
      }
    }
  `);

  return data?.vendorProduct?.grid || {
    rows: [],
    totalSize: 0,
    totalPages: 0,
    isLastPage: true
  };
}

async function fetchVendorProductIdsPage(page) {
  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        grid(
          limit: { size: ${vendorProductPageSize}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
          rows {
            vendor_id
            product_id
          }
        }
      }
    }
  `);

  return data?.vendorProduct?.grid || {
    rows: [],
    totalSize: 0,
    totalPages: 0,
    isLastPage: true
  };
}

function mergeVendorProductCounts(productIdsByVendor, rows) {
  for (const row of rows || []) {
    if (!row.vendor_id || !row.product_id) {
      continue;
    }

    const productIds = productIdsByVendor.get(row.vendor_id) || new Set();
    productIds.add(row.product_id);
    productIdsByVendor.set(row.vendor_id, productIds);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;

      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

async function fetchAllVendorProductCounts() {
  const productIdsByVendor = new Map();
  const firstPage = await fetchVendorProductIdsPage(1);
  const totalPages = Number(firstPage.totalPages || 1);

  mergeVendorProductCounts(productIdsByVendor, firstPage.rows);

  if (totalPages <= 1) {
    return productIdsByVendor;
  }

  const remainingPages = Array.from(
    { length: totalPages - 1 },
    (_, index) => index + 2
  );
  const remainingGrids = await mapWithConcurrency(
    remainingPages,
    vendorProductFetchConcurrency,
    fetchVendorProductIdsPage
  );

  for (const grid of remainingGrids) {
    mergeVendorProductCounts(productIdsByVendor, grid.rows);
  }

  return productIdsByVendor;
}

async function fetchAllVendors() {
  const data = await skunexus.query(`
    query V1Queries {
      vendor {
        grid(
          sort: { name: ASC }
          limit: { size: 500, page: 1 }
        ) {
          rows {
            id
            name
            label
            status
          }
        }
      }
    }
  `);

  return data?.vendor?.grid?.rows || [];
}

async function listVendors() {
  if (vendorCache && Date.now() - vendorCache.createdAt < vendorCacheTtlMs) {
    return vendorCache.data;
  }

  const [vendors, productIdsByVendor] = await Promise.all([
    fetchAllVendors(),
    fetchAllVendorProductCounts()
  ]);

  const data = vendors
    .map((vendor) => {
      const productIds = productIdsByVendor.get(vendor.id);

      return {
        id: vendor.id,
        vendor: vendor.name || vendor.label || "",
        status: vendor.status,
        productCount: productIds?.size || 0
      };
    })
    .filter((vendor) => vendor.id && vendor.vendor && vendor.productCount > 0)
    .sort((a, b) =>
      a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" })
    );

  vendorCache = {
    createdAt: Date.now(),
    data
  };

  return data;
}

async function fetchProductAvailabilityById(productIds) {
  if (productIds.length === 0) {
    return new Map();
  }

  const data = await skunexus.query(`
    query V1Queries {
      product {
        grid(
          filter: { id: { operator: in, value: [${graphqlStringList(productIds)}] } }
          limit: { size: ${productIds.length}, page: 1 }
        ) {
          rows {
            id
            sku
            name
            qty_available
          }
        }
      }
    }
  `);
  const rows = data?.product?.grid?.rows || [];

  return new Map(rows.map((product) => [product.id, product]));
}

async function listVendorProducts(vendorId, queryParams = {}) {
  const { page, limit } = normalizePaging(queryParams);
  const grid = await fetchVendorProductsPage({
    page,
    limit,
    vendorId
  });
  const rows = grid.rows || [];
  const productIds = Array.from(
    new Set(rows.map((row) => row.product_id).filter(Boolean))
  );
  const productsById = await fetchProductAvailabilityById(productIds);

  return {
    data: rows.map((row) => {
      const product = productsById.get(row.product_id) || row.product || {};
      const qtyAvailable = Number(product.qty_available || 0);

      return {
        id: row.product_id || row.id,
        vendorProductId: row.id,
        sku: product.sku || row.product?.sku || row.sku || row.label || "",
        name: product.name || row.product?.name || "",
        qtyAvailable,
        availability: mapAvailability(qtyAvailable)
      };
    }),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };
}

module.exports = {
  listVendors,
  listVendorProducts
};
