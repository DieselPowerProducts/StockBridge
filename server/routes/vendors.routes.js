const express = require("express");
const vendorsController = require("../controllers/vendors.controller");

const router = express.Router();

router.get("/vendors", vendorsController.listVendors);
router.get("/vendors/:vendorId/contacts", vendorsController.listVendorContacts);
router.get(
  "/vendors/:vendorId/auto-inventory",
  vendorsController.getVendorAutoInventorySettings
);
router.get("/vendors/:vendorId/products", vendorsController.listVendorProducts);
router.get(/^\/vendors\/(.+)\/backorders$/, vendorsController.listVendorProducts);
router.put(
  "/vendors/:vendorId/default-contact",
  vendorsController.setVendorDefaultContact
);
router.put(
  "/vendors/:vendorId/auto-inventory",
  vendorsController.updateVendorAutoInventorySettings
);
router.put("/vendors/:vendorId/settings", vendorsController.updateVendorSettings);

module.exports = router;
