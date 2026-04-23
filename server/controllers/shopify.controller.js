const shopifyService = require("../services/shopify.service");

async function resolveOrder(req, res, next) {
  try {
    const order = await shopifyService.resolveOrder({
      orderNumber: req.body.orderNumber,
      customerEmail: req.body.customerEmail
    });

    res.send({ order });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  resolveOrder
};
