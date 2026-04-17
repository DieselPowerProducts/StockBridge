const vendorsService = require("../services/vendors.service");

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

module.exports = {
  listVendors,
  listVendorProducts
};
