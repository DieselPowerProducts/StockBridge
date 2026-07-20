const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveProposal } = require("./productProspectorPrices.service");

const vendors = [
  {
    id: "vendor-turn14",
    vendorProductId: "vp-1",
    vendorSku: "ABC-1",
    productCost: 50,
    newProductCost: null,
    name: "Turn 14 Distribution",
    stockSource: "vendor"
  }
];

function proposal(overrides = {}) {
  return {
    requestIndex: 0,
    distributorKey: "turn14",
    distributorName: "Turn 14 Distribution",
    newProductCost: 55,
    sourceUrl: "https://example.com/product",
    ...overrides
  };
}

test("resolves an assigned WD without changing its live cost", () => {
  const result = resolveProposal(vendors, proposal());
  assert.equal(result.status, "ready");
  assert.equal(result.vendorProductId, "vp-1");
  assert.equal(result.currentProductCost, 50);
  assert.equal(result.newProductCost, 55);
});

test("blocks zero cost and missing source URL", () => {
  assert.equal(resolveProposal(vendors, proposal({ newProductCost: 0 })).status, "invalid_cost");
  assert.equal(resolveProposal(vendors, proposal({ sourceUrl: "" })).status, "invalid_source_url");
});

test("does not guess when the WD is not assigned", () => {
  const result = resolveProposal([], proposal());
  assert.equal(result.status, "vendor_not_assigned");
});
