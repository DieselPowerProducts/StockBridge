const assert = require("node:assert/strict");
const test = require("node:test");
const { collapseVariantBrands } = require("./shopifyBrands.service");

test("uses Shopify's product vendor for each exact SKU", () => {
  const records = collapseVariantBrands([
    { sku: "BDS-55371+98224016(x2)", product: { id: "p1", vendor: "BDS Suspension" } },
    { sku: "  abc-1  ", product: { id: "p2", vendor: "  AFE  " } },
    { sku: "", product: { id: "p3", vendor: "Unused" } }
  ]);

  assert.deepEqual(records, [
    { sku: "BDS-55371+98224016(X2)", vendor: "BDS Suspension", productId: "p1", conflictingVendor: false },
    { sku: "ABC-1", vendor: "AFE", productId: "p2", conflictingVendor: false }
  ]);
});

test("flags duplicate SKUs with different Shopify vendors", () => {
  const records = collapseVariantBrands([
    { sku: "SAME-1", product: { id: "p1", vendor: "AFE" } },
    { sku: "same-1", product: { id: "p2", vendor: "aFe" } },
    { sku: "SAME-1", product: { id: "p3", vendor: "PPE" } }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].conflictingVendor, true);
});

test("keeps a blank Shopify vendor distinct from an unmatched SKU", () => {
  const records = collapseVariantBrands([
    { sku: "BLANK-1", product: { id: "p1", vendor: "" } }
  ]);

  assert.deepEqual(records, [
    { sku: "BLANK-1", vendor: "", productId: "p1", conflictingVendor: false }
  ]);
});
