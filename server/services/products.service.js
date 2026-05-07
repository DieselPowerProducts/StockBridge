const skunexus = require("./skunexus.service");
const catalogService = require("./catalog.service");
const followUpsService = require("./followUps.service");
const stockCheckEmailsService = require("./stockCheckEmails.service");
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

function normalizeStockQuantity(value) {
  const quantity = Number(value);

  return Number.isFinite(quantity) && quantity > 0
    ? enabledVendorStockQuantity
    : disabledVendorStockQuantity;
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

async function refreshProductDetails(sku, options = {}) {
  await catalogService.refreshProductBySku(sku, {
    includeWarehouse: options.includeWarehouse !== false
  });
  return catalogService.getProductDetails(sku);
}

async function setProductFollowUp({ sku, followUpDate }) {
  const result = await followUpsService.setFollowUp({ sku, followUpDate });

  await stockCheckEmailsService.clearVendorEmailsForSku(result.sku || sku);
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
  const result = await setVendorProductQuantity({
    vendorId: safeVendorId,
    vendorProductId: safeVendorProductId,
    quantity,
    vendorProduct
  });

  return {
    ...result,
    sku: product.sku || safeSku,
    enabled
  };
}

async function setVendorProductQuantity({
  vendorId,
  vendorProductId,
  quantity,
  vendorProduct = null
}) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const safeVendorProductId = normalizeRequiredString(
    vendorProductId,
    "Vendor product ID is required."
  );
  const safeQuantity = normalizeStockQuantity(quantity);

  const [resolvedVendorProduct, vendorSettings] = await Promise.all([
    vendorProduct || catalogService.getCatalogVendorProductById(safeVendorProductId),
    vendorSettingsService.getVendorSettings(safeVendorId)
  ]);

  if (!resolvedVendorProduct) {
    const error = new Error("Vendor product not found.");
    error.statusCode = 404;
    throw error;
  }

  if (resolvedVendorProduct.vendor_id !== safeVendorId) {
    const error = new Error("Vendor product does not match this vendor.");
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

  const productSku =
    resolvedVendorProduct.sku ||
    resolvedVendorProduct.product_sku ||
    resolvedVendorProduct.label ||
    "";
  const payload = cleanPayload({
    product_id: resolvedVendorProduct.product_id,
    sku: productSku,
    label: resolvedVendorProduct.label || productSku,
    quantity: safeQuantity,
    price: optionalNumber(resolvedVendorProduct.price),
    status: optionalNumber(resolvedVendorProduct.status)
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
        safeQuantity
      );

    if (!updatedVendorProduct) {
      console.warn(
        "Catalog vendor product was not found after a successful SKU Nexus stock update.",
        {
          sku: productSku,
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
    sku: resolvedVendorProduct.product_sku || productSku,
    vendorId: safeVendorId,
    vendorProductId: safeVendorProductId,
    quantity: safeQuantity,
    enabled: safeQuantity > 0
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
  setProductVendorStock,
  setVendorProductQuantity
};
