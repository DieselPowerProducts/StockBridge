const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./catalog.service");

test("shows BTO vendor products in Stock Check only with a follow-up", () => {
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: true,
      followUpDate: ""
    }),
    false
  );
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: true,
      followUpDate: "2026-07-24"
    }),
    true
  );
});

test("keeps non-vendor BTO and non-BTO products eligible", () => {
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: false,
      followUpDate: ""
    }),
    true
  );
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Backorder",
      hasBuiltToOrderVendor: true,
      followUpDate: ""
    }),
    true
  );
});
