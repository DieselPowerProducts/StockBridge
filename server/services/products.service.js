const skunexus = require("./skunexus.service");

const vendorProductPageSize = 10000;

function normalizePaging({ page = 1, limit = 50 }) {
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

function buildProductsQuery({ page, limit, search }) {
  const cleanSearch = String(search || "").trim();
  const filter = cleanSearch
    ? `filter: { fulltext_search: ${graphqlString(cleanSearch)} }`
    : "";

  return `
    query V1Queries {
      product {
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
            vendor_id
            product_id
          }
        }
      }
    }
  `);

  return data?.vendorProduct?.grid?.rows || [];
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
  if (vendorIds.length === 0) {
    return [];
  }

  const data = await skunexus.query(`
    query V1Queries {
      vendor {
        grid(
          filter: { id: { operator: in, value: [${graphqlStringList(vendorIds)}] } }
          limit: { size: ${vendorIds.length}, page: 1 }
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

async function fetchProductIdsWithActiveVendors(productIds) {
  const vendorProducts = await fetchVendorProductsForProductIds(productIds);
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

function mapProduct(row, productIdsWithActiveVendors) {
  const qtyAvailable = Number(row.qty_available || 0);
  const hasActiveVendor = productIdsWithActiveVendors.has(row.id);

  return {
    id: row.id,
    sku: row.sku || "",
    name: row.name || "",
    qtyAvailable,
    availability: mapAvailability(qtyAvailable, hasActiveVendor)
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

async function listProducts(queryParams) {
  const { page, limit } = normalizePaging(queryParams);
  const data = await skunexus.query(
    buildProductsQuery({
      page,
      limit,
      search: queryParams.search
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

async function getProductDetails(sku) {
  if (!String(sku || "").trim()) {
    const error = new Error("Product SKU is required.");
    error.statusCode = 400;
    throw error;
  }

  const product = await fetchProductBySku(sku);

  if (!product) {
    const error = new Error("Product not found.");
    error.statusCode = 404;
    throw error;
  }

  const vendorProducts = await fetchVendorProductsForProductIds([product.id]);
  const vendorIds = Array.from(
    new Set(vendorProducts.map((row) => row.vendor_id).filter(Boolean))
  );
  const vendors = await fetchVendorsByIds(vendorIds);
  const vendorsById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const assignedVendors = vendorIds
    .map((vendorId) => {
      const vendor = vendorsById.get(vendorId);

      return {
        id: vendorId,
        name: vendor?.name || vendor?.label || vendorId
      };
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

  return {
    id: product.id,
    sku: product.sku || sku,
    name: product.name || product.sku || sku,
    vendors: assignedVendors
  };
}

module.exports = {
  getProductDetails,
  listProducts
};
