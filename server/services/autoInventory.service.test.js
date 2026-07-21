const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./autoInventory.service");

const alphabeticalSettings = {
  inventoryMode: "alphabetical",
  inStockPhrases: ["In Stock", "Available"],
  outOfStockPhrases: ["Out of Stock", "Call for Availability"],
  subtractiveColumn: ""
};

test("tracks recognized alphabetical in-stock rows", () => {
  const result = _test.parseInventoryResult("Available now", alphabeticalSettings);

  assert.equal(result.quantity, 999999);
  assert.equal(_test.getTrackedSheetQuantity(result, "alphabetical"), 999999);
});

test("tracks recognized alphabetical out-of-stock rows", () => {
  const result = _test.parseInventoryResult(
    "Call for Availability",
    alphabeticalSettings
  );

  assert.equal(result.quantity, 0);
  assert.equal(_test.getTrackedSheetQuantity(result, "alphabetical"), 0);
});

test("keeps numerical sheet quantities unchanged", () => {
  const result = {
    quantity: 999999,
    sheetQuantity: 12
  };

  assert.equal(_test.getTrackedSheetQuantity(result, "numerical"), 12);
});
