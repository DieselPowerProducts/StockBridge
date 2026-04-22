const vendorsService = require("../services/vendors.service");
const productsService = require("../services/products.service");

async function listVendors(req, res, next) {
  try {
    const vendors = await vendorsService.listVendors(req.query);
    res.send(vendors);
  } catch (err) {
    next(err);
  }
}

async function listVendorProducts(req, res, next) {
  try {
    const vendorId = req.params.vendorId || req.params[0];
    const products = await vendorsService.listVendorProducts(vendorId, req.query);
    res.send(products);
  } catch (err) {
    next(err);
  }
}

async function updateVendorSettings(req, res, next) {
  try {
    const result = await vendorsService.updateVendorSettings(
      req.params.vendorId,
      req.body
    );

    productsService.clearProductCaches();
    res.send(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVendors,
  listVendorProducts,
  updateVendorSettings
};
