const vendorsService = require("../services/vendors.service");

async function listVendors(req, res, next) {
  try {
    const vendors = await vendorsService.listVendors();
    res.send(vendors);
  } catch (err) {
    next(err);
  }
}

async function listVendorBackorders(req, res, next) {
  try {
    const vendor = req.params.vendor || req.params[0];
    const backorders = await vendorsService.listVendorBackorders(vendor);
    res.send(backorders);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVendors,
  listVendorBackorders
};
