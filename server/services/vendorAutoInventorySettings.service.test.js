const assert = require("node:assert/strict");
const test = require("node:test");

const {
  _test: { updateSkuExceptions }
} = require("./vendorAutoInventorySettings.service");

test("updateSkuExceptions adds one canonical exception and preserves unrelated SKUs", () => {
  assert.deepEqual(
    updateSkuExceptions(
      ["OTHER-100", "PPE-110090080"],
      ["PPE-110090080", "110090080"],
      true
    ),
    ["OTHER-100", "PPE-110090080"]
  );
});

test("updateSkuExceptions removes matching product and vendor SKU aliases", () => {
  assert.deepEqual(
    updateSkuExceptions(
      ["OTHER-100", "110090080", "PPE 110090080"],
      ["PPE-110090080", "110090080"],
      false
    ),
    ["OTHER-100"]
  );
});
