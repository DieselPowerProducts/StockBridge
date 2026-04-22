const skunexus = require("./skunexus.service");
const followUpsService = require("./followUps.service");
const vendorSettingsService = require("./vendorSettings.service");

const vendorProductPageSize = 10000;
const vendorCacheTtlMs = 5 * 60 * 1000;
const stockCheckCacheTtlMs = 5 * 60 * 1000;
const stockCheckFetchConcurrency = 8;
const stockCheckProductPageSize = 1000;
const stockCheckVendorChunkSize = 500;
const productLookupPageSize = 100;
const productFetchConcurrency = 4;
const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const dppWarehouseLabel = "DPP Warehouse";
const dppWarehouseStockType = "WAREHOUSE";
const productSelectionFields = `
  id
  sku
  name
  qty_available
  is_kit
  relatedProduct {
    sku
    name
    qty
  }
`;

const stockCheckCache = new Map();
const vendorCache = new Map();
const stockCheckSortValues = new Set(["all", "yesterday", "today", "tomorrow"]);

function normalizePaging({ page = 1, limit = 50 }) {
  return {
    page: Math.max(Number.parseInt(page, 10) || 1, 1),
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  };
}

function normalizeSearch(search) {
  return String(search || "").trim();
}

function normalizeStockCheckSort(sort) {
  const normalized = String(sort || "all").trim().toLowerCase();

  return stockCheckSortValues.has(normalized) ? normalized : "all";
}

function normalizeDateText(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return new Date().toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const error = new Error("Reference date must use YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function parseDateText(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== String(value)
  ) {
    const error = new Error("Reference date is invalid.");
    error.statusCode = 400;
    throw error;
  }

  return date;
}

function formatDateText(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateText(value, days) {
  const date = parseDateText(value);

  date.setUTCDate(date.getUTCDate() + days);

  return formatDateText(date);
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

function normalizeKitChild(row) {
  const sku = String(row?.sku || "").trim();

  if (!sku) {
    return null;
  }

  return {
    sku,
    name: row?.name || sku,
    qty: Math.max(Number(row?.qty || 0), 1)
  };
}

function normalizeProductNode(row) {
  const sku = String(row?.sku || "").trim();

  if (!sku) {
    return null;
  }

  return {
    id: row?.id || "",
    sku,
    name: row?.name || sku,
    qty_available: Math.max(Number(row?.qty_available || 0), 0),
    is_kit: Boolean(row?.is_kit),
    relatedProduct: (row?.relatedProduct || [])
      .map(normalizeKitChild)
      .filter(Boolean)
  };
}

function getKitChildSkus(products) {
  return Array.from(
    new Set(
      products.flatMap((product) =>
        (product?.relatedProduct || []).map((child) => child.sku).filter(Boolean)
      )
    )
  );
}

function buildProductFilter({ search, onlyZeroQty = false, onlyKits = false }) {
  const cleanSearch = normalizeSearch(search);
  const filters = [];

  if (cleanSearch) {
    filters.push(`fulltext_search: ${graphqlString(cleanSearch)}`);
  }

  if (onlyZeroQty) {
    filters.push(`qty_available: { operator: eq, value: ["0"] }`);
  }

  if (onlyKits) {
    filters.push("is_kit: { operator: eq, value: [true] }");
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
            ${productSelectionFields}
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
            ${productSelectionFields}
          }
        }
      }
    }
  `;
}

function buildKitProductsQuery({ page, search }) {
  return `
    query V1Queries {
      product {
        grid(
          ${buildProductFilter({ search, onlyKits: true })}
          sort: { sku: ASC }
          limit: { size: ${stockCheckProductPageSize}, page: ${page} }
        ) {
          totalSize
          totalPages
          isLastPage
          rows {
            ${productSelectionFields}
          }
        }
      }
    }
  `;
}

function getUnavailableAvailability(hasBuiltToOrderVendor) {
  return hasBuiltToOrderVendor ? "Built to Order" : "Backorder";
}

function mapAvailability(qtyAvailable, hasActiveVendor, hasBuiltToOrderVendor = false) {
  if (Number(qtyAvailable || 0) > 0 || !hasActiveVendor) {
    return "Available";
  }

  return getUnavailableAvailability(hasBuiltToOrderVendor);
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

async function fetchVendorAvailabilityMetadata(vendorIds) {
  if (vendorIds.length === 0) {
    return {
      activeVendorIds: new Set(),
      builtToOrderVendorIds: new Set()
    };
  }

  const [vendors, settingsByVendorId] = await Promise.all([
    fetchVendorsByIds(vendorIds),
    vendorSettingsService.getVendorSettingsByVendorIds(vendorIds)
  ]);
  const activeVendorIds = new Set(
    vendors
      .filter(isActiveVendor)
      .map((vendor) => vendor.id)
      .filter(Boolean)
  );
  const builtToOrderVendorIds = new Set(
    Array.from(activeVendorIds).filter(
      (vendorId) => settingsByVendorId.get(vendorId)?.builtToOrder
    )
  );

  return {
    activeVendorIds,
    builtToOrderVendorIds
  };
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

function buildProductVendorAvailability(
  vendorProducts,
  activeVendorIds,
  builtToOrderVendorIds
) {
  const productIdsWithActiveVendors = new Set();
  const productIdsWithBuiltToOrderVendors = new Set();

  for (const row of vendorProducts) {
    if (!row?.product_id || !row?.vendor_id || !activeVendorIds.has(row.vendor_id)) {
      continue;
    }

    productIdsWithActiveVendors.add(row.product_id);

    if (builtToOrderVendorIds.has(row.vendor_id)) {
      productIdsWithBuiltToOrderVendors.add(row.product_id);
    }
  }

  return {
    productIdsWithActiveVendors,
    productIdsWithBuiltToOrderVendors
  };
}

async function getProductVendorAvailabilityInfo(productIds) {
  const vendorProducts = await fetchVendorAssignmentsForProductIds(productIds);
  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );

  if (vendorIds.length === 0) {
    return {
      productIdsWithActiveVendors: new Set(),
      productIdsWithBuiltToOrderVendors: new Set()
    };
  }

  const { activeVendorIds, builtToOrderVendorIds } =
    await fetchVendorAvailabilityMetadata(vendorIds);

  return buildProductVendorAvailability(
    vendorProducts,
    activeVendorIds,
    builtToOrderVendorIds
  );
}

function getEffectiveQtyAvailable(sku, productsBySku, qtyCache = new Map(), visiting = new Set()) {
  const safeSku = String(sku || "").trim();

  if (!safeSku) {
    return 0;
  }

  if (qtyCache.has(safeSku)) {
    return qtyCache.get(safeSku);
  }

  const product = productsBySku.get(safeSku);

  if (!product) {
    qtyCache.set(safeSku, 0);
    return 0;
  }

  if (!product.is_kit || product.relatedProduct.length === 0) {
    const qtyAvailable = product.is_kit ? 0 : product.qty_available;
    qtyCache.set(safeSku, qtyAvailable);
    return qtyAvailable;
  }

  if (visiting.has(safeSku)) {
    qtyCache.set(safeSku, 0);
    return 0;
  }

  visiting.add(safeSku);
  const childQtyAvailable = product.relatedProduct.map((child) => {
    const requiredQty = Math.max(Number(child.qty || 0), 1);
    const childQty = getEffectiveQtyAvailable(
      child.sku,
      productsBySku,
      qtyCache,
      visiting
    );

    return Math.floor(childQty / requiredQty);
  });
  visiting.delete(safeSku);

  const qtyAvailable =
    childQtyAvailable.length > 0 ? Math.min(...childQtyAvailable) : 0;
  qtyCache.set(safeSku, qtyAvailable);

  return qtyAvailable;
}

function mapProduct(
  row,
  productVendorAvailability,
  followUpsBySku,
  { productsBySku = new Map(), qtyCache = new Map() } = {}
) {
  const normalizedRow = normalizeProductNode(row);
  const sku = normalizedRow?.sku || row?.sku || "";
  const product = normalizedRow?.sku ? productsBySku.get(normalizedRow.sku) || normalizedRow : null;
  const isKit = Boolean(product?.is_kit);
  const hasActiveVendor = productVendorAvailability.productIdsWithActiveVendors.has(row.id);
  const hasBuiltToOrderVendor =
    productVendorAvailability.productIdsWithBuiltToOrderVendors.has(row.id);
  const qtyAvailable = isKit
    ? getEffectiveQtyAvailable(sku, productsBySku, qtyCache)
    : Math.max(Number(row?.qty_available || 0), 0);
  const availability = isKit
    ? qtyAvailable > 0
      ? "Available"
      : getUnavailableAvailability(hasBuiltToOrderVendor)
    : mapAvailability(qtyAvailable, hasActiveVendor, hasBuiltToOrderVendor);

  return {
    id: row.id,
    sku,
    name: row.name || "",
    qtyAvailable,
    availability,
    followUpDate: followUpsBySku?.get(sku) || "",
    isKit
  };
}

async function fetchProductsBySkus(skus) {
  const uniqueSkus = Array.from(
    new Set(skus.map((sku) => String(sku || "").trim()).filter(Boolean))
  );

  if (uniqueSkus.length === 0) {
    return [];
  }

  const skuChunks = chunkRows(uniqueSkus, productLookupPageSize);
  const grids = await mapWithConcurrency(
    skuChunks,
    productFetchConcurrency,
    async (skuChunk) => {
      const data = await skunexus.query(`
        query V1Queries {
          product {
            grid(
              filter: { sku: { operator: in, value: [${graphqlStringList(skuChunk)}] } }
              limit: { size: ${skuChunk.length}, page: 1 }
            ) {
              rows {
                ${productSelectionFields}
              }
            }
          }
        }
      `);

      return data?.product?.grid?.rows || [];
    }
  );

  return grids.flat();
}

async function buildProductGraph(rows) {
  const productsBySku = new Map();
  let nextSkus = getKitChildSkus(rows.map(normalizeProductNode).filter(Boolean));

  for (const row of rows) {
    const product = normalizeProductNode(row);

    if (product) {
      productsBySku.set(product.sku, product);
    }
  }

  while (nextSkus.length > 0) {
    const missingSkus = nextSkus.filter((childSku) => !productsBySku.has(childSku));

    if (missingSkus.length === 0) {
      break;
    }

    const fetchedProducts = await fetchProductsBySkus(missingSkus);

    if (fetchedProducts.length === 0) {
      break;
    }

    for (const fetchedProduct of fetchedProducts) {
      const product = normalizeProductNode(fetchedProduct);

      if (product) {
        productsBySku.set(product.sku, product);
      }
    }

    nextSkus = getKitChildSkus(Array.from(productsBySku.values()));
  }

  return {
    productsBySku,
    qtyCache: new Map()
  };
}

function buildKitChildProducts(product, productGraph) {
  if (!product?.is_kit) {
    return [];
  }

  return product.relatedProduct.map((child) => {
    const childProduct = productGraph.productsBySku.get(child.sku);
    const qtyAvailable = getEffectiveQtyAvailable(
      child.sku,
      productGraph.productsBySku,
      productGraph.qtyCache
    );

    return {
      sku: child.sku,
      name: childProduct?.name || child.name || child.sku,
      qtyRequired: Math.max(Number(child.qty || 0), 1),
      qtyAvailable,
      availability: qtyAvailable > 0 ? "Available" : "Backorder",
      isKit: Boolean(childProduct?.is_kit)
    };
  });
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
            ${productSelectionFields}
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

async function fetchKitProductsPage({ page, search }) {
  const data = await skunexus.query(buildKitProductsQuery({ page, search }));

  return data?.product?.grid || {
    rows: [],
    totalSize: 0,
    totalPages: 0,
    isLastPage: true
  };
}

async function fetchAllProductRows(fetchPage) {
  const firstPage = await fetchPage(1);
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
      (page) => fetchPage(page)
    );

    for (const grid of remainingGrids) {
      rows.push(...(grid.rows || []));
    }
  }

  return rows;
}

function dedupeAndSortProducts(rows) {
  const productsByKey = new Map();

  for (const row of rows) {
    const key = String(row?.sku || row?.id || "").trim();

    if (key && !productsByKey.has(key)) {
      productsByKey.set(key, row);
    }
  }

  return Array.from(productsByKey.values()).sort((left, right) =>
    String(left?.sku || "").localeCompare(String(right?.sku || ""), undefined, {
      sensitivity: "base"
    })
  );
}

function matchesProductSearch(product, search) {
  if (!search) {
    return true;
  }

  const terms = String(search)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = [product?.sku, product?.name]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return terms.every((term) => haystack.includes(term));
}

function compareStockCheckProducts(left, right) {
  const leftDate = String(left?.followUpDate || "");
  const rightDate = String(right?.followUpDate || "");

  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (leftDate && !rightDate) {
    return -1;
  }

  if (!leftDate && rightDate) {
    return 1;
  }

  return String(left?.sku || "").localeCompare(String(right?.sku || ""), undefined, {
    sensitivity: "base"
  });
}

function filterStockCheckProducts(products, sort, referenceDate) {
  if (sort === "all") {
    return [...products].sort(compareStockCheckProducts);
  }

  const offsetBySort = {
    yesterday: -1,
    today: 0,
    tomorrow: 1
  };
  const targetDate = addDaysToDateText(referenceDate, offsetBySort[sort] || 0);

  return products
    .filter((product) => product.followUpDate === targetDate)
    .sort(compareStockCheckProducts);
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

async function getProductVendorAvailabilityInfoInChunks(productIds) {
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
  const vendorMetadataChunks = await mapWithConcurrency(
    vendorChunks,
    stockCheckFetchConcurrency,
    fetchVendorAvailabilityMetadata
  );
  const activeVendorIds = new Set(
    vendorMetadataChunks.flatMap((metadata) => Array.from(metadata.activeVendorIds))
  );
  const builtToOrderVendorIds = new Set(
    vendorMetadataChunks.flatMap((metadata) =>
      Array.from(metadata.builtToOrderVendorIds)
    )
  );

  return buildProductVendorAvailability(
    vendorProducts,
    activeVendorIds,
    builtToOrderVendorIds
  );
}

async function getStockCheckProducts({ search, sort = "all", referenceDate = "" } = {}) {
  const cleanSearch = normalizeSearch(search);
  const cleanSort = normalizeStockCheckSort(sort);
  const cleanReferenceDate = normalizeDateText(referenceDate);
  const cacheKey = `${cleanSearch.toLowerCase()}:${cleanSort}:${cleanReferenceDate}`;
  const cached = stockCheckCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < stockCheckCacheTtlMs) {
    return cached.data;
  }

  const [zeroQtyRows, kitRows, followUpsBySku] = await Promise.all([
    fetchAllProductRows((page) =>
      fetchZeroQtyProductsPage({
        page,
        search: cleanSearch
      })
    ),
    fetchAllProductRows((page) =>
      fetchKitProductsPage({
        page,
        search: cleanSearch
      })
    ),
    followUpsService.getAllFollowUps()
  ]);
  const followUpRows = await fetchProductsBySkus(Array.from(followUpsBySku.keys()));
  const candidateRows = dedupeAndSortProducts([
    ...zeroQtyRows,
    ...kitRows,
    ...followUpRows
  ]);

  if (candidateRows.length === 0) {
    stockCheckCache.set(cacheKey, {
      createdAt: Date.now(),
      data: []
    });

    return [];
  }

  const [productVendorAvailability, productGraph] = await Promise.all([
    getProductVendorAvailabilityInfoInChunks(
      candidateRows.map((product) => product.id).filter(Boolean)
    ),
    buildProductGraph(candidateRows)
  ]);
  const data = candidateRows
    .map((product) =>
      mapProduct(product, productVendorAvailability, followUpsBySku, productGraph)
    )
    .filter(
      (product) =>
        product.availability !== "Available" || Boolean(product.followUpDate)
    )
    .filter((product) => matchesProductSearch(product, cleanSearch));
  const filteredData = filterStockCheckProducts(
    data,
    cleanSort,
    cleanReferenceDate
  );

  stockCheckCache.set(cacheKey, {
    createdAt: Date.now(),
    data: filteredData
  });

  return filteredData;
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
  const [productVendorAvailability, productGraph] = await Promise.all([
    getProductVendorAvailabilityInfo(rows.map((product) => product.id).filter(Boolean)),
    buildProductGraph(rows)
  ]);

  return {
    data: rows.map((product) =>
      mapProduct(product, productVendorAvailability, undefined, productGraph)
    ),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };
}

async function listStockCheckProducts(queryParams) {
  const { page, limit } = normalizePaging(queryParams);
  const products = await getStockCheckProducts({
    search: queryParams.search,
    sort: queryParams.sort,
    referenceDate: queryParams.referenceDate
  });

  return paginateRows(products, { page, limit });
}

async function getProductDetails(sku) {
  const safeSku = normalizeRequiredString(sku, "Product SKU is required.");
  const [vendorProducts, fullProduct, dppWarehouseStockRows, followUpDate] =
    await Promise.all([
    fetchVendorProductsForSku(safeSku),
    fetchProductBySku(safeSku),
    fetchDppWarehouseStockForSku(safeSku),
    followUpsService.getFollowUpForSku(safeSku)
  ]);
  const relatedProduct = vendorProducts.find((vendorProduct) => vendorProduct.product)?.product;
  const product =
    fullProduct ||
    (relatedProduct && relatedProduct.id
      ? {
          id: relatedProduct.id,
          sku: relatedProduct.sku || safeSku,
          name: relatedProduct.name || relatedProduct.sku || safeSku
        }
      : null);

  if (!product) {
    const error = new Error("Product not found.");
    error.statusCode = 404;
    throw error;
  }

  const productGraph = await buildProductGraph([product]);
  const productNode =
    productGraph.productsBySku.get(product.sku || safeSku) ||
    normalizeProductNode(product);
  const qtyAvailable = productNode
    ? getEffectiveQtyAvailable(
        productNode.sku,
        productGraph.productsBySku,
        productGraph.qtyCache
      )
    : 0;
  const baseAvailability = qtyAvailable > 0 ? "Available" : "Backorder";
  const childProducts = buildKitChildProducts(productNode, productGraph);

  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );
  const [vendors, settingsByVendorId] = await Promise.all([
    fetchVendorsByIds(vendorIds),
    vendorSettingsService.getVendorSettingsByVendorIds(vendorIds)
  ]);
  const vendorsById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const hasBuiltToOrderVendor = vendorProducts.some((vendorProduct) => {
    const settings = settingsByVendorId.get(vendorProduct.vendor_id);
    const vendor = vendorsById.get(vendorProduct.vendor_id);

    return Boolean(
      vendorProduct.vendor_id &&
        settings?.builtToOrder &&
        isActiveVendor(vendor)
    );
  });
  const availability =
    baseAvailability === "Available"
      ? "Available"
      : getUnavailableAvailability(hasBuiltToOrderVendor);
  const assignedVendors = vendorProducts
    .filter((vendorProduct) => vendorProduct.id && vendorProduct.vendor_id)
    .map((vendorProduct) => {
      const vendor = vendorsById.get(vendorProduct.vendor_id);
      const settings = settingsByVendorId.get(vendorProduct.vendor_id);

      return {
        id: vendorProduct.vendor_id,
        vendorProductId: vendorProduct.id,
        name: vendor?.name || vendor?.label || vendorProduct.vendor_id,
        quantity: Number(vendorProduct.quantity || 0),
        stockSource: "vendor",
        stockType: "VENDOR",
        canUpdateStock: !settings?.builtToOrder,
        builtToOrder: Boolean(settings?.builtToOrder),
        buildTime: String(settings?.buildTime || "")
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
            canUpdateStock: false,
            builtToOrder: false,
            buildTime: ""
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
    qtyAvailable,
    availability,
    isKit: Boolean(productNode?.is_kit),
    followUpDate,
    childProducts,
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

  const [product, vendorProduct, vendorSettings] = await Promise.all([
    fetchProductBySku(safeSku),
    fetchVendorProductById(safeVendorProductId),
    vendorSettingsService.getVendorSettings(safeVendorId)
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

  if (vendorSettings.builtToOrder) {
    const error = new Error(
      "Built-to-order vendors cannot have manual stock overrides."
    );
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

function clearProductCaches() {
  stockCheckCache.clear();
}

module.exports = {
  clearProductCaches,
  getProductDetails,
  listProducts,
  listStockCheckProducts,
  setProductFollowUp,
  setProductVendorStock
};
