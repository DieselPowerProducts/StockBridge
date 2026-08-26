const assert = require("node:assert/strict");
const test = require("node:test");

const {
  _test: { updateSkuExceptions }
} = require("./vendorAutoInventorySettings.service");
const { getSkuMatchKeys } = require("./autoInventorySkuMatcher");

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

test("SKU matching tolerates vendor grouping dashes", () => {
  const compactSkuKeys = getSkuMatchKeys("ATS-1039093278");
  const groupedSkuKeys = getSkuMatchKeys("103-909-3278");

  assert.equal(
    compactSkuKeys.some((key) => groupedSkuKeys.includes(key)),
    true
  );
});

test("SKU matching does not collapse short ambiguous keys", () => {
  assert.equal(getSkuMatchKeys("AB-12").includes("ab12"), false);
});
