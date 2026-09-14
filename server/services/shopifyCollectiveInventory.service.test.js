const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateTrackedCollectiveInventoryVariants,
  updateProductAvailability,
  _test: {
    isDiscontinuedAvailabilityValue,
    mergeVariantAvailabilityRecords
  }
} = require("./shopify.service");

function variant({
  id,
  sku,
  quantity,
  policy = "DENY",
  tracked = true,
  status = "ACTIVE",
  tags = ["Shopify Collective"],
  productAvailability = ""
}) {
  return {
    id,
    sku,
    inventoryQuantity: quantity,
    inventoryPolicy: policy,
    inventoryItem: { tracked },
    productAvailability: productAvailability
      ? { value: productAvailability }
      : null,
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

test("does not overwrite discontinued Collective availability", () => {
  const records = aggregateTrackedCollectiveInventoryVariants([
    variant({
      id: "discontinued",
      sku: "SKU-DISCONTINUED",
      quantity: 4,
      productAvailability: " Discontinued "
    })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].availability, "in_stock");
  assert.equal(records[0].hasDiscontinuedAvailability, true);
  assert.equal(records[0].availabilityMetafieldMismatch, false);
  assert.equal(isDiscontinuedAvailabilityValue("DISCONTINUED"), true);
});

test("keeps discontinued when duplicate Shopify variants disagree", () => {
  const result = mergeVariantAvailabilityRecords([
    variant({ id: "available", sku: "DUPLICATE-SKU", quantity: 2 }),
    variant({
      id: "discontinued",
      sku: "duplicate-sku",
      quantity: 0,
      productAvailability: "Discontinued"
    })
  ]);

  assert.deepEqual(result.records, [
    {
      sku: "DUPLICATE-SKU",
      availability: "discontinued",
      buildToOrderLeadTime: undefined
    }
  ]);
});

test("rejects attempts to set discontinued through StockBridge", async () => {
  await assert.rejects(
    updateProductAvailability({
      sku: "SKU-DISCONTINUED",
      availability: "discontinued"
    }),
    (error) =>
      error?.statusCode === 409 &&
      /read-only in StockBridge/.test(error.message)
  );
});
