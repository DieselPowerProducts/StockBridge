const skunexus = require("./skunexus.service");
const followUpsService = require("./followUps.service");

const vendorProductPageSize = 10000;
const vendorCacheTtlMs = 5 * 60 * 1000;
const stockCheckCacheTtlMs = 5 * 60 * 1000;
const stockCheckFetchConcurrency = 8;
const stockCheckProductPageSize = 1000;
const stockCheckVendorChunkSize = 500;
const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const dppWarehouseLabel = "DPP Warehouse";
const dppWarehouseStockType = "WAREHOUSE";

const stockCheckCache = new Map();
const vendorCache = new Map();

function normalizePaging({ page = 1, limit = 50 }) {
  return {
    page: Math.max(Number.parseInt(page, 10) || 1, 1),
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  };
}

function normalizeSearch(search) {
  return String(search || "").trim();
}

function emptyProductsResponse() {
  return {
    data: [],
    total: 0,
    totalPages: 0,
    isLastPage: true
  };
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

function normalizeRequiredString(value, message) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function buildProductFilter({ search, onlyZeroQty = false }) {
  const cleanSearch = normalizeSearch(search);
  const filters = [];

  if (cleanSearch) {
    filters.push(`fulltext_search: ${graphqlString(cleanSearch)}`);
  }

  if (onlyZeroQty) {
    filters.push(`qty_available: { operator: eq, value: ["0"] }`);
  }

  return filters.length > 0 ? `filter: { ${filters.join(", ")} }` : "";
}

function buildProductsQuery({ page, limit, search }) {
  return `
    query V1Queries {
      product {
        grid(
          ${buildProductFilter({ search })}
          sort: { sku: ASC }
          limit: { size: ${limit}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
          rows {
            id
            sku
            name
            qty_available
          }
        }
      }
    }
  `;
}

function buildZeroQtyProductsQuery({ page, search }) {
  return `
    query V1Queries {
      product {
        grid(
          ${buildProductFilter({ search, onlyZeroQty: true })}
          sort: { sku: ASC }
          limit: { size: ${stockCheckProductPageSize}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
          rows {
            id
            sku
            name
            qty_available
          }
        }
      }
    }
  `;
}

function mapAvailability(qtyAvailable, hasActiveVendor) {
  if (Number(qtyAvailable || 0) > 0 || !hasActiveVendor) {
    return "Available";
  }

  return "Backorder";
}

function isActiveVendor(vendor) {
  return Number(vendor?.status || 0) >= 2;
}

function getCachedVendor(vendorId) {
  const cached = vendorCache.get(vendorId);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt >= vendorCacheTtlMs) {
    vendorCache.delete(vendorId);
    return null;
  }

  return cached.vendor;
}

function cacheVendors(vendors) {
  const createdAt = Date.now();

  for (const vendor of vendors) {
    if (vendor?.id) {
      vendorCache.set(vendor.id, { createdAt, vendor });
    }
  }
}

async function fetchVendorAssignmentsForProductIds(productIds) {
  if (productIds.length === 0) {
    return [];
  }

  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        grid(
          filter: { product_id: { operator: in, value: [${graphqlStringList(productIds)}] } }
          limit: { size: ${vendorProductPageSize}, page: 1 }
        ) {
          rows {
            vendor_id
            product_id
          }
        }
      }
    }
  `);

  return data?.vendorProduct?.grid?.rows || [];
}

async function fetchVendorProductsForProductIds(productIds) {
  if (productIds.length === 0) {
    return [];
  }

  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        grid(
          filter: { product_id: { operator: in, value: [${graphqlStringList(productIds)}] } }
          limit: { size: ${vendorProductPageSize}, page: 1 }
        ) {
          rows {
            id
            vendor_id
            product_id
            quantity
          }
        }
      }
    }
  `);

  return data?.vendorProduct?.grid?.rows || [];
}

async function fetchVendorProductsForSku(sku) {
  const safeSku = normalizeRequiredString(sku, "Product SKU is required.");
  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        grid(
          filter: {
            product: { sku: { operator: eq, value: [${graphqlString(safeSku)}] } }
          }
          limit: { size: ${vendorProductPageSize}, page: 1 }
        ) {
          rows {
            id
            vendor_id
            product_id
            quantity
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

  return data?.vendorProduct?.grid?.rows || [];
}

async function fetchVendorProductById(vendorProductId) {
  const data = await skunexus.query(`
    query V1Queries {
      vendorProduct {
        details(id: ${graphqlString(vendorProductId)}) {
          id
          vendor_id
          product_id
          sku
          label
          quantity
          price
          status
        }
      }
    }
  `);

  return data?.vendorProduct?.details || null;
}

async function fetchDppWarehouseStockForSku(sku) {
  const data = await skunexus.query(`
    query V1Queries {
      stock {
        stocksGrid(
          filter: {
            product: { sku: { operator: eq, value: [${graphqlString(sku)}] } }
            type: [${dppWarehouseStockType}]
            location: {
              warehouse_label: { operator: eq, value: [${graphqlString(dppWarehouseLabel)}] }
            }
          }
          limit: { size: 100, page: 1 }
        ) {
          rows {
            id
            qty
            qty_available
            type
            location {
              warehouse {
                id
                label
              }
            }
          }
        }
      }
    }
  `);

  return (data?.stock?.stocksGrid?.rows || []).filter(
    (row) =>
      row.type === dppWarehouseStockType &&
      row.location?.warehouse?.label === dppWarehouseLabel
  );
}

async function fetchActiveVendorIds(vendorIds) {
  if (vendorIds.length === 0) {
    return new Set();
  }

  const vendors = await fetchVendorsByIds(vendorIds);

  return new Set(
    vendors
      .filter(isActiveVendor)
      .map((vendor) => vendor.id)
      .filter(Boolean)
  );
}

async function fetchVendorsByIds(vendorIds) {
  const uniqueVendorIds = Array.from(new Set(vendorIds.filter(Boolean)));

  if (uniqueVendorIds.length === 0) {
    return [];
  }

  const cachedVendors = [];
  const missingVendorIds = [];

  for (const vendorId of uniqueVendorIds) {
    const cachedVendor = getCachedVendor(vendorId);

    if (cachedVendor) {
      cachedVendors.push(cachedVendor);
    } else {
      missingVendorIds.push(vendorId);
    }
  }

  if (missingVendorIds.length === 0) {
    return cachedVendors;
  }

  const data = await skunexus.query(`
    query V1Queries {
      vendor {
        grid(
          filter: { id: { operator: in, value: [${graphqlStringList(missingVendorIds)}] } }
          limit: { size: ${missingVendorIds.length}, page: 1 }
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

  const fetchedVendors = data?.vendor?.grid?.rows || [];
  cacheVendors(fetchedVendors);

  return [...cachedVendors, ...fetchedVendors];
}

async function fetchProductIdsWithActiveVendors(productIds) {
  const vendorProducts = await fetchVendorAssignmentsForProductIds(productIds);
  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );
  const activeVendorIds = await fetchActiveVendorIds(vendorIds);

  return new Set(
    vendorProducts
      .filter((row) => activeVendorIds.has(row.vendor_id))
      .map((row) => row.product_id)
      .filter(Boolean)
  );
}

function mapProduct(row, productIdsWithActiveVendors, followUpsBySku) {
  const qtyAvailable = Number(row.qty_available || 0);
  const hasActiveVendor = productIdsWithActiveVendors.has(row.id);
  const sku = row.sku || "";
  const availability = mapAvailability(qtyAvailable, hasActiveVendor);

  return {
    id: row.id,
    sku,
    name: row.name || "",
    qtyAvailable,
    availability,
    followUpDate:
      availability === "Backorder" ? followUpsBySku?.get(sku) || "" : ""
  };
}

async function fetchProductBySku(sku) {
  const data = await skunexus.query(`
    query V1Queries {
      product {
        grid(
          filter: { sku: { operator: eq, value: [${graphqlString(sku)}] } }
          limit: { size: 1, page: 1 }
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

  return data?.product?.grid?.rows?.[0] || null;
}

async function fetchZeroQtyProductsPage({ page, search }) {
  const data = await skunexus.query(buildZeroQtyProductsQuery({ page, search }));

  return data?.product?.grid || {
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

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

async function fetchProductIdsWithActiveVendorsInChunks(productIds) {
  const productIdChunks = chunkRows(productIds, stockCheckProductPageSize);
  const vendorProductChunks = await mapWithConcurrency(
    productIdChunks,
    stockCheckFetchConcurrency,
    fetchVendorAssignmentsForProductIds
  );
  const vendorProducts = vendorProductChunks.flat();
  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );
  const vendorChunks = chunkRows(vendorIds, stockCheckVendorChunkSize);
  const vendorIdSets = await mapWithConcurrency(
    vendorChunks,
    stockCheckFetchConcurrency,
    fetchActiveVendorIds
  );
  const activeVendorIds = new Set(
    vendorIdSets.flatMap((vendorIdSet) => Array.from(vendorIdSet))
  );

  return new Set(
    vendorProducts
      .filter((row) => activeVendorIds.has(row.vendor_id))
      .map((row) => row.product_id)
      .filter(Boolean)
  );
}

async function getStockCheckProducts(search) {
  const cleanSearch = normalizeSearch(search);
  const cacheKey = cleanSearch.toLowerCase();
  const cached = stockCheckCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < stockCheckCacheTtlMs) {
    return cached.data;
  }

  const firstPage = await fetchZeroQtyProductsPage({
    page: 1,
    search: cleanSearch
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
      stockCheckFetchConcurrency,
      (page) =>
        fetchZeroQtyProductsPage({
          page,
          search: cleanSearch
        })
    );

    for (const grid of remainingGrids) {
      rows.push(...(grid.rows || []));
    }
  }

  const productIdsWithActiveVendors =
    await fetchProductIdsWithActiveVendorsInChunks(
      rows.map((product) => product.id).filter(Boolean)
    );
  const backorderRows = rows.filter((product) =>
    productIdsWithActiveVendors.has(product.id)
  );
  const followUpsBySku = await followUpsService.getFollowUpsForSkus(
    backorderRows.map((product) => product.sku).filter(Boolean)
  );
  const data = backorderRows.map((product) =>
    mapProduct(product, productIdsWithActiveVendors, followUpsBySku)
  );

  stockCheckCache.set(cacheKey, {
    createdAt: Date.now(),
    data
  });

  return data;
}

async function listProducts(queryParams) {
  const { page, limit } = normalizePaging(queryParams);
  const search = normalizeSearch(queryParams.search);

  if (!search) {
    return emptyProductsResponse();
  }

  const data = await skunexus.query(
    buildProductsQuery({
      page,
      limit,
      search
    })
  );
  const grid = data?.product?.grid || {};
  const rows = grid.rows || [];
  const productIdsWithActiveVendors = await fetchProductIdsWithActiveVendors(
    rows.map((product) => product.id).filter(Boolean)
  );

  return {
    data: rows.map((product) =>
      mapProduct(product, productIdsWithActiveVendors)
    ),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };
}

async function listStockCheckProducts(queryParams) {
  const { page, limit } = normalizePaging(queryParams);
  const products = await getStockCheckProducts(queryParams.search);

  return paginateRows(products, { page, limit });
}

async function getProductDetails(sku) {
  const safeSku = normalizeRequiredString(sku, "Product SKU is required.");
  const [vendorProducts, dppWarehouseStockRows, followUpDate] = await Promise.all([
    fetchVendorProductsForSku(safeSku),
    fetchDppWarehouseStockForSku(safeSku),
    followUpsService.getFollowUpForSku(safeSku)
  ]);
  const relatedProduct = vendorProducts.find((vendorProduct) => vendorProduct.product)
    ?.product;
  const product =
    relatedProduct && relatedProduct.id
      ? {
          id: relatedProduct.id,
          sku: relatedProduct.sku || safeSku,
          name: relatedProduct.name || relatedProduct.sku || safeSku
        }
      : await fetchProductBySku(safeSku);

  if (!product) {
    const error = new Error("Product not found.");
    error.statusCode = 404;
    throw error;
  }

  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );
  const vendors = await fetchVendorsByIds(vendorIds);
  const vendorsById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const assignedVendors = vendorProducts
    .filter((vendorProduct) => vendorProduct.id && vendorProduct.vendor_id)
    .map((vendorProduct) => {
      const vendor = vendorsById.get(vendorProduct.vendor_id);

      return {
        id: vendorProduct.vendor_id,
        vendorProductId: vendorProduct.id,
        name: vendor?.name || vendor?.label || vendorProduct.vendor_id,
        quantity: Number(vendorProduct.quantity || 0),
        stockSource: "vendor",
        stockType: "VENDOR",
        canUpdateStock: true
      };
    });
  const dppWarehouseStock = dppWarehouseStockRows.reduce(
    (summary, row) => ({
      id: row.location?.warehouse?.id || summary.id,
      quantity: summary.quantity + Number(row.qty_available || 0)
    }),
    { id: "", quantity: 0 }
  );
  const assignedStockSources = [
    ...assignedVendors,
    ...(dppWarehouseStockRows.length > 0
      ? [
          {
            id: dppWarehouseStock.id || dppWarehouseLabel,
            vendorProductId: `warehouse:${dppWarehouseStock.id || dppWarehouseLabel}`,
            name: dppWarehouseLabel,
            quantity: dppWarehouseStock.quantity,
            stockSource: "warehouse",
            stockType: dppWarehouseStockType,
            canUpdateStock: false
          }
        ]
      : [])
  ]
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

  return {
    id: product.id,
    sku: product.sku || safeSku,
    name: product.name || product.sku || safeSku,
    followUpDate,
    vendors: assignedStockSources
  };
}

async function setProductFollowUp({ sku, followUpDate }) {
  const result = await followUpsService.setFollowUp({ sku, followUpDate });

  stockCheckCache.clear();

  return result;
}

async function setProductVendorStock({
  sku,
  vendorId,
  vendorProductId,
  enabled
}) {
  const safeSku = normalizeRequiredString(sku, "Product SKU is required.");
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const safeVendorProductId = normalizeRequiredString(
    vendorProductId,
    "Vendor product ID is required."
  );

  if (typeof enabled !== "boolean") {
    const error = new Error("Enabled must be true or false.");
    error.statusCode = 400;
    throw error;
  }

  const [product, vendorProduct] = await Promise.all([
    fetchProductBySku(safeSku),
    fetchVendorProductById(safeVendorProductId)
  ]);

  if (!product) {
    const error = new Error("Product not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!vendorProduct) {
    const error = new Error("Vendor product not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    vendorProduct.vendor_id !== safeVendorId ||
    vendorProduct.product_id !== product.id
  ) {
    const error = new Error("Vendor product does not match this product.");
    error.statusCode = 409;
    throw error;
  }

  const quantity = enabled
    ? enabledVendorStockQuantity
    : disabledVendorStockQuantity;
  const productSku = vendorProduct.sku || product.sku || safeSku;
  const payload = cleanPayload({
    product_id: vendorProduct.product_id,
    sku: productSku,
    label: vendorProduct.label || productSku,
    quantity,
    price: optionalNumber(vendorProduct.price),
    status: optionalNumber(vendorProduct.status)
  });

  await skunexus.rest(
    `/vendors/${encodeURIComponent(safeVendorId)}/products/${encodeURIComponent(
      safeVendorProductId
    )}`,
    {
      method: "PUT",
      body: payload
    }
  );

  stockCheckCache.clear();

  return {
    sku: product.sku || safeSku,
    vendorId: safeVendorId,
    vendorProductId: safeVendorProductId,
    quantity,
    enabled
  };
}

module.exports = {
  getProductDetails,
  listProducts,
  listStockCheckProducts,
  setProductFollowUp,
  setProductVendorStock
};
