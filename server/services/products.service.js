const skunexus = require("./skunexus.service");
const catalogService = require("./catalog.service");
const followUpsService = require("./followUps.service");
const vendorSettingsService = require("./vendorSettings.service");

const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;

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

async function listProducts(queryParams) {
  return catalogService.listProducts(queryParams);
}

async function listStockCheckProducts(queryParams) {
  return catalogService.listStockCheckProducts(queryParams);
}

async function getProductDetails(sku) {
  return catalogService.getProductDetails(sku);
}

async function refreshProductDetails(sku) {
  await catalogService.refreshProductBySku(sku);
  return catalogService.getProductDetails(sku);
}

async function setProductFollowUp({ sku, followUpDate }) {
  const result = await followUpsService.setFollowUp({ sku, followUpDate });

  clearProductCaches();

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
    catalogService.getCatalogProductBySku(safeSku),
    catalogService.getCatalogVendorProductById(safeVendorProductId),
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

  try {
    const updatedVendorProduct =
      await catalogService.updateCatalogVendorProductQuantity(
        safeVendorProductId,
        quantity
      );

    if (!updatedVendorProduct) {
      console.warn(
        "Catalog vendor product was not found after a successful SKU Nexus stock update.",
        {
          sku: safeSku,
          vendorId: safeVendorId,
          vendorProductId: safeVendorProductId
        }
      );
    }
  } catch (error) {
    console.error(
      "Unable to update the local catalog vendor product after a successful SKU Nexus stock update.",
      error
    );
  }

  clearProductCaches();

  return {
    sku: product.sku || safeSku,
    vendorId: safeVendorId,
    vendorProductId: safeVendorProductId,
    quantity,
    enabled
  };
}

function clearProductCaches() {
  catalogService.clearCaches();
}

module.exports = {
  clearProductCaches,
  getProductDetails,
  listProducts,
  listStockCheckProducts,
  refreshProductDetails,
  setProductFollowUp,
  setProductVendorStock
};
