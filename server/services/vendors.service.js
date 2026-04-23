const catalogService = require("./catalog.service");
const vendorSettingsService = require("./vendorSettings.service");

function normalizeRequiredString(value, message) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function listVendors(queryParams = {}) {
  return catalogService.listVendors(queryParams);
}

async function listVendorProducts(vendorId, queryParams = {}) {
  return catalogService.listVendorProducts(vendorId, queryParams);
}

async function updateVendorSettings(vendorId, settings) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");

  await vendorSettingsService.setVendorSettings({
    vendorId: safeVendorId,
    builtToOrder: settings?.builtToOrder,
    buildTime: settings?.buildTime
  });

  return catalogService.getVendorDetails(safeVendorId);
}

module.exports = {
  listVendors,
  listVendorProducts,
  updateVendorSettings
};
