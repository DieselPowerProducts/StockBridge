const express = require("express");
const priceAuditController = require("../controllers/priceAudit.controller");

const router = express.Router();

router.get("/price-audit", priceAuditController.listPriceAudits);
router.post(
  "/price-audit/:vendorProductId/confirm",
  priceAuditController.confirmPriceAudit
);
router.post(
  "/price-audit/:vendorProductId/deny",
  priceAuditController.denyPriceAudit
);

module.exports = router;
