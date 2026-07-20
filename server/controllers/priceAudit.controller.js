const priceAuditService = require("../services/priceAudit.service");

async function listPriceAudits(req, res, next) {
  try {
    const result = await priceAuditService.listPriceAudits(req.query);
    res.send(result);
  } catch (error) {
    next(error);
  }
}

async function confirmPriceAudit(req, res, next) {
  try {
    const result = await priceAuditService.confirmPriceAudit(
      req.params.vendorProductId,
      req.body?.newProductCost
    );
    res.send(result);
  } catch (error) {
    next(error);
  }
}

async function denyPriceAudit(req, res, next) {
  try {
    const result = await priceAuditService.denyPriceAudit(
      req.params.vendorProductId
    );
    res.send(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  confirmPriceAudit,
  denyPriceAudit,
  listPriceAudits
};
