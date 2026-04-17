const express = require("express");
const productsController = require("../controllers/products.controller");

const router = express.Router();

router.get("/products", productsController.listProducts);
router.get("/products/details", productsController.getProductDetails);

module.exports = router;
