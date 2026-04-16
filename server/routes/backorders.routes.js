const express = require("express");
const backordersController = require("../controllers/backorders.controller");

const router = express.Router();

router.get("/backorders", backordersController.listBackorders);
router.put("/status/:id", backordersController.updateStatus);

module.exports = router;
