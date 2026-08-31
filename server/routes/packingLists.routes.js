const express = require("express");
const packingListsController = require("../controllers/packingLists.controller");

const router = express.Router();

router.post("/packing-lists/report", packingListsController.createReport);

module.exports = router;
