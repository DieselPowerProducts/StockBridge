const express = require("express");
const productProspectorController = require("../controllers/productProspectorPrices.controller");
const gmailInventoryController = require("../controllers/gmailInventory.controller");
const { requireAuth } = require("../middleware/auth");
const { requireProductProspectorApiKey } = require("../middleware/productProspectorAuth");

const router = express.Router();
router.use("/integrations/product-prospector", requireProductProspectorApiKey);
router.post(
  "/integrations/product-prospector/wd-prices/preview",
  productProspectorController.previewPrices
);
router.post(
  "/integrations/product-prospector/wd-prices",
  productProspectorController.stagePrices
);

router.get(
  "/integrations/gmail/oauth/start",
  requireAuth,
  gmailInventoryController.startOAuth
);
router.get(
  "/integrations/gmail/oauth/callback",
  gmailInventoryController.completeOAuth
);
router.get(
  "/integrations/gmail/status",
  requireAuth,
  gmailInventoryController.getStatus
);
router.post(
  "/integrations/gmail/push",
  gmailInventoryController.receivePush
);

module.exports = router;
