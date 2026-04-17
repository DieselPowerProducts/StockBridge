const skunexus = require("./skunexus.service");

const vendorCacheTtlMs = 5 * 60 * 1000;
const vendorProductPageSize = 10000;
const vendorProductFetchConcurrency = 4;

let vendorCache;
const vendorProductsCache = new Map();

function normalizePaging({ page = 1, limit = 50 } = {}) {
  return {
    page: Math.max(Number.parseInt(page, 10) || 1, 1),
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  };
}

function normalizeSearch(search) {
  return String(search || "").trim().toLowerCase();
}

function matchesSearch(values, search) {
  if (!search) {
    return true;
  }

  const terms = search.split(/\s+/).filter(Boolean);
  const haystack = values
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return terms.every((term) => haystack.includes(term));
}

function paginateRows(rows, { page, limit }) {
  const total = rows.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;

  return {
    data: rows.slice(start, start + limit),
    total,
    totalPages,
    isLastPage: totalPages === 0 || page >= totalPages
  };
}

function graphqlString(value) {
  return JSON.stringify(String(value || ""));
}

function graphqlStringList(values) {
  return values.map(graphqlString).join(", ");
}

function buildVendorFilter(search) {
  return search ? `filter: { fulltext_search: ${graphqlString(search)} }` : "";
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

async function fetchVendorsPage({ page, limit, search }) {
  const data = await skunexus.query(`
    query V1Queries {
      vendor {
        grid(
          ${buildVendorFilter(search)}
          sort: { name: ASC }
          limit: { size: ${limit}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
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

  return data?.vendor?.grid || {
    rows: [],
    totalSize: 0,
    totalPages: 0,
    isLastPage: true
  };
}

function mapVendorSummary(vendor) {
  return {
    id: vendor.id,
    vendor: vendor.name || vendor.label || "",
    status: vendor.status
  };
}

async function getVendorSummaries(queryParams) {
  const { page, limit } = normalizePaging(queryParams);
  const search = normalizeSearch(queryParams.search);
  const cacheKey = `${page}:${limit}:${search}`;

  if (
    vendorCache?.key === cacheKey &&
    Date.now() - vendorCache.createdAt < vendorCacheTtlMs
  ) {
    return vendorCache.data;
  }

  const grid = await fetchVendorsPage({ page, limit, search });
  const result = {
    data: (grid.rows || [])
      .map(mapVendorSummary)
      .filter((vendor) => vendor.id && vendor.vendor),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };

  vendorCache = {
    createdAt: Date.now(),
    data: result,
    key: cacheKey
  };

  return result;
}

async function listVendors(queryParams = {}) {
  return getVendorSummaries(queryParams);
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

async function fetchAllVendorProducts(vendorId) {
  const cached = vendorProductsCache.get(vendorId);

  if (cached && Date.now() - cached.createdAt < vendorCacheTtlMs) {
    return cached.data;
  }

  const firstPage = await fetchVendorProductsPage({
    page: 1,
    limit: vendorProductPageSize,
    vendorId
  });
  const totalPages = Number(firstPage.totalPages || 1);
  const rows = [...(firstPage.rows || [])];

  if (totalPages > 1) {
    const remainingPages = Array.from(
      { length: totalPages - 1 },
      (_, index) => index + 2
    );
    const remainingGrids = await mapWithConcurrency(
      remainingPages,
      vendorProductFetchConcurrency,
      (page) =>
        fetchVendorProductsPage({
          page,
          limit: vendorProductPageSize,
          vendorId
        })
    );

    for (const grid of remainingGrids) {
      rows.push(...(grid.rows || []));
    }
  }

  vendorProductsCache.set(vendorId, {
    createdAt: Date.now(),
    data: rows
  });

  return rows;
}

async function mapVendorProducts(rows) {
  const productIds = Array.from(
    new Set(rows.map((row) => row.product_id).filter(Boolean))
  );
  const productsById = await fetchProductAvailabilityById(productIds);

  return rows.map((row) => {
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
  });
}

async function listVendorProducts(vendorId, queryParams = {}) {
  const { page, limit } = normalizePaging(queryParams);
  const search = normalizeSearch(queryParams.search);

  if (search) {
    const rows = await fetchAllVendorProducts(vendorId);
    const filteredRows = rows.filter((row) =>
      matchesSearch(
        [row.sku, row.label, row.product?.sku, row.product?.name],
        search
      )
    );
    const pageResult = paginateRows(filteredRows, { page, limit });

    return {
      ...pageResult,
      data: await mapVendorProducts(pageResult.data)
    };
  }

  const grid = await fetchVendorProductsPage({
    page,
    limit,
    vendorId
  });
  const rows = grid.rows || [];

  return {
    data: await mapVendorProducts(rows),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };
}

module.exports = {
  listVendors,
  listVendorProducts
};
