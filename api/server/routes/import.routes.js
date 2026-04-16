const express = require("express");
const importController = require("../controllers/import.controller");
const upload = require("../middleware/upload");

const router = express.Router();

router.post("/import", upload.single("file"), importController.importBackorders);

module.exports = router;
