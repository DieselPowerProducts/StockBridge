const pricesService = require("../services/productProspectorPrices.service");

async function previewPrices(req, res, next) {
  try {
    res.send(await pricesService.previewPrices(req.body));
  } catch (error) {
    next(error);
  }
}

async function stagePrices(req, res, next) {
  try {
    res.send(await pricesService.stagePrices(req.body));
  } catch (error) {
    next(error);
  }
}

module.exports = { previewPrices, stagePrices };
