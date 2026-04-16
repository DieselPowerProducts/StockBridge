const skunexus = require("./skunexus.service");

function normalizePaging({ page = 1, limit = 50 }) {
  return {
    page: Math.max(Number.parseInt(page, 10) || 1, 1),
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  };
}

function graphqlString(value) {
  return JSON.stringify(String(value || ""));
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

function mapProduct(row) {
  const qtyAvailable = Number(row.qty_available || 0);

  return {
    id: row.id,
    sku: row.sku || "",
    name: row.name || "",
    qtyAvailable,
    availability: qtyAvailable > 0 ? "Available" : "Backorder"
  };
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

  return {
    data: (grid.rows || []).map(mapProduct),
    total: Number(grid.totalSize || 0),
    totalPages: Number(grid.totalPages || 0),
    isLastPage: Boolean(grid.isLastPage)
  };
}

module.exports = {
  listProducts
};
