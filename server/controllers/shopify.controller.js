const shopifyService = require("../services/shopify.service");
const productsService = require("../services/products.service");

async function assertBuiltToOrderAvailabilityAllowed(sku, availability) {
  const normalizedAvailability = String(availability || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    normalizedAvailability !== "built_to_order" &&
    normalizedAvailability !== "builttoorder"
  ) {
    return;
  }

  const productDetails = await productsService.getProductDetails(sku);
  const assignedVendors = (productDetails.vendors || []).filter(
    (vendor) => vendor.stockSource === "vendor"
  );
  const hasStock =
    Number(productDetails.qtyAvailable || 0) > 0 ||
    (productDetails.vendors || []).some(
      (vendor) => Number(vendor.quantity || 0) > 0
    );

  if (assignedVendors.length === 0 || hasStock) {
    const error = new Error(
      "Built to Order requires at least one assigned vendor and all inventory sources to be out of stock."
    );
    error.statusCode = 409;
    throw error;
  }
}

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

async function updateProductAvailability(req, res, next) {
  try {
    await assertBuiltToOrderAvailabilityAllowed(
      req.body.sku,
      req.body.availability
    );
    const result = await shopifyService.updateProductAvailability({
      sku: req.body.sku,
      availability: req.body.availability,
      buildToOrderLeadTime: req.body.buildToOrderLeadTime,
      buildToOrderMessage: req.body.buildToOrderMessage,
      followUpDate: req.body.followUpDate,
      productName: req.body.productName
    });

    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function syncAvailabilityStateFromShopify(req, res, next) {
  try {
    const result = await shopifyService.syncAvailabilityStateFromShopifyPage({
      after: req.body.cursor,
      first: req.body.first
    });

    res.send(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  resolveOrder,
  syncAvailabilityStateFromShopify,
  updateProductAvailability
};
