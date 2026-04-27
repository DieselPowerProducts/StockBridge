const express = require("express");
const emailController = require("../controllers/email.controller");

const router = express.Router();

router.get("/email/templates", emailController.listTemplates);
router.post("/email/templates", emailController.saveTemplate);
router.post("/email/vendor-stock-check", emailController.sendVendorStockCheck);

module.exports = router;
