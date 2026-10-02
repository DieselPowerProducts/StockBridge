const test = require("node:test");
const assert = require("node:assert/strict");

const catalogService = require("./catalog.service");
const productsService = require("./products.service");
const queueService = require("./shopifyAvailabilityQueue.service");
const vendorSettingsService = require("./vendorSettings.service");
const skunexus = require("./skunexus.service");

for (const builtToOrder of [true, false]) {
  test(`new ${builtToOrder ? "BTO" : "regular"} vendor starts with the correct stock`, async (t) => {
    const quantity = builtToOrder ? 0 : 999999;
    const assignment = {
      id: "vp-1", vendor_id: "vendor-1", product_id: "product-1",
      sku: "TEST-123", quantity, status: 1, price: 0
    };
    t.mock.method(catalogService, "getVendorDetails", async () => ({ id: "vendor-1" }));
    t.mock.method(vendorSettingsService, "getVendorSettings", async () => ({ builtToOrder }));
    const refresh = t.mock.method(catalogService, "refreshProductBySku", async () => ({}));
    t.mock.method(catalogService, "getCatalogProductBySku", async () => ({ id: "product-1", sku: "TEST-123" }));
    t.mock.method(catalogService, "getCatalogVendorProductByVendorAndSku", async () => null);
    t.mock.method(catalogService, "getProductDetails", async () => ({
      sku: "TEST-123", vendors: [{ id: "vendor-1", vendorProductId: "vp-1", quantity, builtToOrder }]
    }));
    t.mock.method(catalogService, "updateCatalogVendorProductQuantity", async () => assignment);
    t.mock.method(catalogService, "clearCaches", () => {});
    const enqueue = t.mock.method(queueService, "enqueueAvailabilitySync", async () => ({}));
    const imported = t.mock.method(skunexus, "multipart", async (url, options) => {
      assert.equal(url, "/vendors/vendor-1/products-import");
      assert.equal(options.files[0].content,
        `product_id,sku,quantity,price,status\nproduct-1,TEST-123,${quantity},0,1\n`);
      return { imported_count: 1 };
    });
    t.mock.method(skunexus, "query", async () => ({ vendorProduct: { grid: { rows: [assignment] } } }));
    const stockUpdate = t.mock.method(skunexus, "rest", async () => ({}));
    const details = await productsService.assignProductVendor({ sku: "TEST-123", vendorId: "vendor-1" });
    assert.equal(imported.mock.callCount(), 1);
    assert.equal(refresh.mock.callCount(), 2);
    assert.equal(details.vendors[0].quantity, quantity);
    assert.equal(stockUpdate.mock.callCount(), builtToOrder ? 0 : 1);
    assert.ok(enqueue.mock.calls.some(call => call.arguments[0].source === "vendor-assignment"));
  });
}

async function withQueueFallbackMocks(
  { enqueue, remove, sync },
  callback
) {
  const originalEnqueue = queueService.enqueueAvailabilitySync;
  const originalRemove = queueService.removeAvailabilitySync;
  const originalSync = catalogService.syncShopifyAvailabilityForSkus;
  const originalConsoleError = console.error;
  const errors = [];

  queueService.enqueueAvailabilitySync = enqueue;
  queueService.removeAvailabilitySync = remove;
  catalogService.syncShopifyAvailabilityForSkus = sync;
  console.error = (...args) => errors.push(args);

  try {
    return await callback(errors);
  } finally {
    queueService.enqueueAvailabilitySync = originalEnqueue;
    queueService.removeAvailabilitySync = originalRemove;
    catalogService.syncShopifyAvailabilityForSkus = originalSync;
    console.error = originalConsoleError;
  }
}

test("uses the durable queue without running the direct fallback on success", async () => {
  let syncCalls = 0;

  await withQueueFallbackMocks(
    {
      enqueue: async () => ({ revision: 3 }),
      remove: async () => true,
      sync: async () => {
        syncCalls += 1;
        return { failed: 0 };
      }
    },
    async () => {
      assert.deepEqual(
        await productsService._test.queueShopifyAvailabilitySync(
          "DPP-123",
          "follow-up-update"
        ),
        { revision: 3 }
      );
      assert.equal(syncCalls, 0);
    }
  );
});

test("directly syncs Shopify and removes the row when wake publication fails", async () => {
  const syncCalls = [];
  const removeCalls = [];
  const queueError = new Error("queue unavailable");

  queueError.availabilityQueueRecord = { revision: 12, sku: "DPP-123" };

  await withQueueFallbackMocks(
    {
      enqueue: async () => {
        throw queueError;
      },
      remove: async (...args) => {
        removeCalls.push(args);
        return true;
      },
      sync: async (...args) => {
        syncCalls.push(args);
        return { failed: 0, updated: 1 };
      }
    },
    async (errors) => {
      const result =
        await productsService._test.queueShopifyAvailabilitySync(
          "DPP-123",
          "follow-up-update"
        );

      assert.deepEqual(syncCalls, [
        [
          ["DPP-123"],
          { source: "queue-publish-fallback:follow-up-update" }
        ]
      ]);
      assert.deepEqual(removeCalls, [
        ["DPP-123", { revision: 12 }]
      ]);
      assert.equal(result.fallback, true);
      assert.equal(result.shopify.updated, 1);
      assert.equal(errors.length, 1);
    }
  );
});

test("preserves the database row when both publication and direct sync fail", async () => {
  let removeCalls = 0;

  await withQueueFallbackMocks(
    {
      enqueue: async () => {
        throw new Error("queue unavailable");
      },
      remove: async () => {
        removeCalls += 1;
        return true;
      },
      sync: async () => ({ failed: 1 })
    },
    async (errors) => {
      assert.equal(
        await productsService._test.queueShopifyAvailabilitySync(
          "DPP-123",
          "vendor-inventory-update"
        ),
        null
      );
      assert.equal(removeCalls, 0);
      assert.equal(errors.length, 2);
    }
  );
});
