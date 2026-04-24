const shopifyService = require("../services/shopify.service");

async function resolveOrder(req, res, next) {
  try {
    const order = await shopifyService.resolveOrder({
      createdAt: req.body.createdAt,
      orderNumber: req.body.orderNumber,
      customerEmail: req.body.customerEmail,
      skus: req.body.skus
    });

    res.send({ order });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  resolveOrder
};
