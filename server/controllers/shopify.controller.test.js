const test = require("node:test");
const assert = require("node:assert/strict");
const products = require("../services/products.service");
const shopify = require("../services/shopify.service");
const queue = require("../services/shopifyAvailabilityQueue.service");
const controller = require("./shopify.controller");

const btoVendor = { stockSource: "vendor", builtToOrder: true, quantity: 999999 };
for (const scenario of [
  { name: "allows stored stock on BTO vendors", qty: 0, vendors: [btoVendor], allowed: true },
  { name: "allows out-of-stock regular vendors", qty: 0, vendors: [{ stockSource: "vendor", quantity: 0 }], allowed: true },
  { name: "blocks warehouse stock", qty: 0, vendors: [btoVendor, { stockSource: "warehouse", quantity: 1 }], allowed: false },
  { name: "blocks regular vendor stock", qty: 0, vendors: [btoVendor, { stockSource: "vendor", quantity: 1 }], allowed: false },
  { name: "blocks effective stock including kits", qty: 1, vendors: [btoVendor], allowed: false },
  { name: "requires an assigned vendor", qty: 0, vendors: [], allowed: false }
]) {
  test(`BTO availability guard ${scenario.name}`, async (t) => {
    t.mock.method(products, "getProductDetails", async () => ({ qtyAvailable: scenario.qty, vendors: scenario.vendors }));
    const push = t.mock.method(shopify, "updateProductAvailability", async () => ({ ok: true }));
    const cleanup = t.mock.method(queue, "removeAvailabilitySync", async () => {});
    let error;
    let response;
    await controller.updateProductAvailability(
      { body: { sku: "PROF-104-10266", availability: "built_to_order", buildToOrderLeadTime: "10 Days" } },
      { send: (value) => { response = value; } },
      (value) => { error = value; }
    );
    assert.equal(push.mock.callCount(), scenario.allowed ? 1 : 0);
    assert.equal(cleanup.mock.callCount(), scenario.allowed ? 1 : 0);
    if (scenario.allowed) {
      assert.equal(error, undefined);
      assert.deepEqual(response, { ok: true });
    } else {
      assert.equal(error.statusCode, 409);
    }
  });
}
