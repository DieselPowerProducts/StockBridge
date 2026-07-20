const express = require("express");
const controller = require("../controllers/productProspectorPrices.controller");
const { requireProductProspectorApiKey } = require("../middleware/productProspectorAuth");

const router = express.Router();
router.use("/integrations/product-prospector", requireProductProspectorApiKey);
router.post("/integrations/product-prospector/wd-prices/preview", controller.previewPrices);
router.post("/integrations/product-prospector/wd-prices", controller.stagePrices);

module.exports = router;
