const express = require("express");
const brandsController = require("../controllers/brands.controller");

const router = express.Router();

router.get("/brands", brandsController.listBrands);
router.get("/brands/products", brandsController.listBrandProducts);

module.exports = router;
