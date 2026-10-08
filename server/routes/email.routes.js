const express = require("express");
const emailController = require("../controllers/email.controller");

const router = express.Router();

router.get("/email/templates", emailController.listTemplates);
router.post("/email/templates", emailController.saveTemplate);
router.post("/email/vendor-stock-check", emailController.sendVendorStockCheck);
router.post("/email/vendor-stock-check/bulk", emailController.sendBulkVendorStockCheck);

module.exports = router;
