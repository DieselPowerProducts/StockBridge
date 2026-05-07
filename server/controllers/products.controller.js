const productsService = require("../services/products.service");

async function listProducts(req, res, next) {
  try {
    const result = await productsService.listProducts(req.query);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function getProductDetails(req, res, next) {
  try {
    const result = await productsService.getProductDetails(req.query.sku);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function listStockCheckProducts(req, res, next) {
  try {
    const result = await productsService.listStockCheckProducts(req.query);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function updateProductFollowUp(req, res, next) {
  try {
    const result = await productsService.setProductFollowUp(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function updateProductVendorStock(req, res, next) {
  try {
    const result = await productsService.setProductVendorStock(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function assignProductVendor(req, res, next) {
  try {
    const result = await productsService.assignProductVendor(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function refreshProductDetails(req, res, next) {
  try {
    const result = await productsService.refreshProductDetails(req.body?.sku, {
      includeWarehouse: req.body?.includeWarehouse
    });
    res.send(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  assignProductVendor,
  getProductDetails,
  listProducts,
  listStockCheckProducts,
  refreshProductDetails,
  updateProductFollowUp,
  updateProductVendorStock
};
