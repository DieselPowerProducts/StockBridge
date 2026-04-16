const productsService = require("../services/products.service");

async function listProducts(req, res, next) {
  try {
    const result = await productsService.listProducts(req.query);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProducts
};
