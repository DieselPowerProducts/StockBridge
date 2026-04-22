const express = require("express");
const productsController = require("../controllers/products.controller");

const router = express.Router();

router.get("/products", productsController.listProducts);
router.get("/products/details", productsController.getProductDetails);
router.get("/products/stock-check", productsController.listStockCheckProducts);
router.post("/products/details/refresh", productsController.refreshProductDetails);
router.put("/products/follow-up", productsController.updateProductFollowUp);
router.put("/products/vendor-stock", productsController.updateProductVendorStock);

module.exports = router;
