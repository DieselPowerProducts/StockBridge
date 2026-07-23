const express = require("express");
const auditController = require("../controllers/audit.controller");

const router = express.Router();

router.get("/audits/inventory", auditController.listInventoryAudits);

module.exports = router;
