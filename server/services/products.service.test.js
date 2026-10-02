const test = require("node:test");
const assert = require("node:assert/strict");

const catalogService = require("./catalog.service");
const productsService = require("./products.service");
const queueService = require("./shopifyAvailabilityQueue.service");
const vendorSettingsService = require("./vendorSettings.service");
const skunexus = require("./skunexus.service");
const followUpsService = require("./followUps.service");
const inventoryAuditService = require("./inventoryAudit.service");
const stockCheckEmailsService = require("./stockCheckEmails.service");
const vendorsService = require("./vendors.service");
const shopifyAvailabilityStateService = require("./shopifyAvailabilityState.service");

for (const noEta of [true, "true", "1"]) {
  test(`blocks No ETA (${noEta}) while any assigned vendor has BTO enabled`, async (t) => {
    t.mock.method(catalogService, "getProductDetails", async () => ({ vendors: [
      { stockSource: "vendor", vendorBuiltToOrder: true, builtToOrder: false },
      { stockSource: "vendor", vendorBuiltToOrder: true, builtToOrder: true }
    ] }));
    const save = t.mock.method(followUpsService, "setFollowUp", async () => ({}));
    await assert.rejects(productsService.setProductFollowUp({
      sku: "TEST", followUpDate: "2026-10-03", followUpNoEta: noEta
    }), { statusCode: 409 });
    assert.equal(save.mock.callCount(), 0);
  });
}

test("allows No ETA after all product vendor BTO switches are off", async (t) => {
  t.mock.method(catalogService, "getProductDetails", async () => ({ vendors: [
    { stockSource: "vendor", vendorBuiltToOrder: true, builtToOrder: false }
  ] }));
  const input = { sku: "TEST", followUpDate: "2026-10-03", followUpNoEta: true };
  t.mock.method(followUpsService, "setFollowUp", async (value) => value);
  t.mock.method(inventoryAuditService, "clearInventoryAuditsForSku", async () => {});
  t.mock.method(stockCheckEmailsService, "clearVendorEmailsForSku", async () => {});
  t.mock.method(catalogService, "clearCaches", () => {});
  const enqueue = t.mock.method(queueService, "enqueueAvailabilitySync", async () => ({}));
  assert.deepEqual(await productsService.setProductFollowUp(input), input);
  assert.equal(enqueue.mock.callCount(), 1);
});

test("clearing No ETA restores vendor BTO before queueing the Shopify update", async (t) => {
  const calls = [];
  t.mock.method(followUpsService, "getFollowUpInfoForSku", async () => ({ followUpNoEta: true }));
  t.mock.method(followUpsService, "setFollowUp", async ({ sku }) => {
    calls.push("follow-up");
    return { sku, followUpDate: "2026-10-07", followUpNoEta: false };
  });
  t.mock.method(require("./shopifyAvailabilityState.service"), "restoreBuiltToOrderAfterNoEta", async () => {
    calls.push("restore-bto");
    return ["FI-MCH1033"];
  });
  t.mock.method(inventoryAuditService, "clearInventoryAuditsForSku", async () => {});
  t.mock.method(stockCheckEmailsService, "clearVendorEmailsForSku", async () => {});
  t.mock.method(catalogService, "clearCaches", () => {});
  t.mock.method(queueService, "enqueueAvailabilitySync", async () => {
    calls.push("queue");
    return {};
  });
  await productsService.setProductFollowUp({
    sku: "FI-MCH1033", followUpDate: "2026-10-07", followUpNoEta: false
  });
  assert.deepEqual(calls, ["follow-up", "restore-bto", "queue"]);
});

for (const enabled of [true, false]) {
  test(`product BTO ${enabled ? "on clears No ETA" : "off preserves follow-up"} and queues Shopify`, async (t) => {
    const details = { sku: "TEST", vendors: [
      { id: "v1", vendorProductId: "vp1", stockSource: "vendor", vendorBuiltToOrder: true }
    ] };
    t.mock.method(catalogService, "getProductDetails", async () => details);
    const save = t.mock.method(catalogService, "setVendorProductBuiltToOrder", async () => {});
    const clear = t.mock.method(catalogService, "clearBuiltToOrderNoEtas", async () => []);
    const restoreBto = t.mock.method(shopifyAvailabilityStateService, "restoreBuiltToOrderAfterNoEta", async () => []);
    const restoreBackorder = t.mock.method(shopifyAvailabilityStateService, "restoreBackorderAfterVendorBtoOff", async () => false);
    t.mock.method(catalogService, "clearCaches", () => {});
    const enqueue = t.mock.method(queueService, "enqueueAvailabilitySync", async () => ({}));
    assert.deepEqual(await productsService.setProductVendorBuiltToOrder({
      sku: "TEST", vendorId: "v1", vendorProductId: "vp1", enabled
    }), details);
    assert.deepEqual(save.mock.calls[0].arguments, ["vp1", enabled]);
    assert.equal(clear.mock.callCount(), enabled ? 1 : 0);
    if (enabled) assert.deepEqual(clear.mock.calls[0].arguments, [{ sku: "TEST" }]);
    assert.equal(restoreBto.mock.callCount(), enabled ? 1 : 0);
    assert.equal(restoreBackorder.mock.callCount(), enabled ? 0 : 1);
    assert.equal(enqueue.mock.callCount(), 1);
  });
}

test("rejects changing BTO on an inactive, unrelated or non-BTO assignment", async (t) => {
  t.mock.method(catalogService, "getProductDetails", async () => ({ sku: "TEST", vendors: [
    { id: "v1", vendorProductId: "vp1", stockSource: "vendor", vendorBuiltToOrder: false }
  ] }));
  const save = t.mock.method(catalogService, "setVendorProductBuiltToOrder", async () => {});
  for (const vendorProductId of ["vp1", "vp2"]) {
    await assert.rejects(productsService.setProductVendorBuiltToOrder({
      sku: "TEST", vendorId: "v1", vendorProductId, enabled: true
    }), { statusCode: 409 });
  }
  assert.equal(save.mock.callCount(), 0);
});

for (const builtToOrder of [true, false]) {
  test(`vendor BTO ${builtToOrder ? "on clears assigned No ETAs before queueing" : "off leaves No ETA alone"}`, async (t) => {
    const calls = [];
    t.mock.method(vendorSettingsService, "setVendorSettings", async () => calls.push("save"));
    t.mock.method(catalogService, "clearCaches", () => {});
    const clear = t.mock.method(catalogService, "clearBuiltToOrderNoEtas", async () => calls.push("clear"));
    t.mock.method(queueService, "enqueueVendorReconciliation", async () => {
      calls.push("queue"); return { queued: 2 };
    });
    t.mock.method(catalogService, "getVendorDetails", async () => ({ id: "v1" }));
    await vendorsService.updateVendorSettings("v1", { builtToOrder, buildTime: "2 weeks" });
    assert.deepEqual(calls, builtToOrder ? ["save", "clear", "queue"] : ["save", "queue"]);
    if (builtToOrder) assert.deepEqual(clear.mock.calls[0].arguments, [{ vendorId: "v1" }]);
  });
}

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
    const clearNoEtas = t.mock.method(catalogService, "clearBuiltToOrderNoEtas", async () => []);
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
    assert.equal(clearNoEtas.mock.callCount(), builtToOrder ? 1 : 0);
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
