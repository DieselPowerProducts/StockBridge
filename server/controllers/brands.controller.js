const shopifyBrandsService = require("../services/shopifyBrands.service");

async function listBrands(req, res, next) {
  try {
    res.send(await shopifyBrandsService.listBrands(req.query));
  } catch (error) {
    next(error);
  }
}

async function listBrandProducts(req, res, next) {
  try {
    res.send(await shopifyBrandsService.listBrandProducts(req.query));
  } catch (error) {
    next(error);
  }
}

module.exports = { listBrands, listBrandProducts };
