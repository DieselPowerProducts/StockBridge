const express = require("express");
const vendorsController = require("../controllers/vendors.controller");

const router = express.Router();

router.get("/vendors", vendorsController.listVendors);
router.get("/vendors/:vendorId/products", vendorsController.listVendorProducts);
router.get(/^\/vendors\/(.+)\/backorders$/, vendorsController.listVendorProducts);

module.exports = router;
