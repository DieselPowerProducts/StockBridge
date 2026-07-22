const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateTrackedCollectiveInventoryVariants
} = require("./shopify.service");

function variant({
  id,
  sku,
  quantity,
  policy = "DENY",
  tracked = true,
  status = "ACTIVE",
  tags = ["Shopify Collective"]
}) {
  return {
    id,
    sku,
    inventoryQuantity: quantity,
    inventoryPolicy: policy,
    inventoryItem: { tracked },
    product: {
      id: `product-${id}`,
      status,
      tags
    }
  };
}

test("maps tracked Collective inventory to StockBridge availability", () => {
  const records = aggregateTrackedCollectiveInventoryVariants([
    variant({ id: "available", sku: "SKU-1", quantity: 4 }),
    variant({ id: "backorder", sku: "SKU-2", quantity: 0, policy: "CONTINUE" }),
    variant({ id: "out", sku: "SKU-3", quantity: 0, policy: "DENY" })
  ]);

  assert.deepEqual(
    records.map(({ sku, inventoryQuantity, inventoryPolicy, availability }) => ({
      sku,
      inventoryQuantity,
      inventoryPolicy,
      availability
    })),
    [
      {
        sku: "SKU-1",
        inventoryQuantity: 4,
        inventoryPolicy: "DENY",
        availability: "in_stock"
      },
      {
        sku: "SKU-2",
        inventoryQuantity: 0,
        inventoryPolicy: "CONTINUE",
        availability: "backordered"
      },
      {
        sku: "SKU-3",
        inventoryQuantity: 0,
        inventoryPolicy: "DENY",
        availability: "out_of_stock"
      }
    ]
  );
});

test("combines duplicate SKUs and keeps mixed policy SKUs sellable", () => {
  const records = aggregateTrackedCollectiveInventoryVariants([
    variant({ id: "one", sku: "same-sku", quantity: 0, policy: "DENY" }),
    variant({ id: "two", sku: "SAME-SKU", quantity: 0, policy: "CONTINUE" })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].sku, "same-sku");
  assert.equal(records[0].inventoryPolicy, "CONTINUE");
  assert.equal(records[0].availability, "backordered");
  assert.equal(records[0].variantIds.length, 2);
});

test("ignores products that are not active tracked Collective products", () => {
  const records = aggregateTrackedCollectiveInventoryVariants([
    variant({ id: "untracked", sku: "SKU-1", quantity: 2, tracked: false }),
    variant({ id: "draft", sku: "SKU-2", quantity: 2, status: "DRAFT" }),
    variant({ id: "ordinary", sku: "SKU-3", quantity: 2, tags: ["Supplier"] }),
    variant({ id: "missing-sku", sku: "", quantity: 2 })
  ]);

  assert.deepEqual(records, []);
});
