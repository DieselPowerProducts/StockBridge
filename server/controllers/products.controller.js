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

async function listStockCheckVendorGroups(req, res, next) {
  try {
    res.send(await productsService.listStockCheckVendorGroups(req.query));
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

async function updateProductBuiltToOrderLeadTime(req, res, next) {
  try {
    const result = await productsService.setProductBuiltToOrderLeadTime(req.body);
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

async function updateProductVendorBuiltToOrder(req, res, next) {
  try {
    res.send(await productsService.setProductVendorBuiltToOrder(req.body));
  } catch (err) {
    next(err);
  }
}

async function updateProductVendorDetails(req, res, next) {
  try {
    const result = await productsService.setProductVendorDetails(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function updateProductVendorAutoInventory(req, res, next) {
  try {
    const result = await productsService.setProductVendorAutoInventory(req.body);
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
  updateProductVendorBuiltToOrder,
  assignProductVendor,
  getProductDetails,
  listProducts,
  listStockCheckProducts,
  listStockCheckVendorGroups,
  refreshProductDetails,
  updateProductBuiltToOrderLeadTime,
  updateProductFollowUp,
  updateProductVendorAutoInventory,
  updateProductVendorDetails,
  updateProductVendorStock
};
