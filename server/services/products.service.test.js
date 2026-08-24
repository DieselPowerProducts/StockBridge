const test = require("node:test");
const assert = require("node:assert/strict");

const catalogService = require("./catalog.service");
const productsService = require("./products.service");
const queueService = require("./shopifyAvailabilityQueue.service");

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
