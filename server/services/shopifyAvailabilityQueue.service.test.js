const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getRetryDelaySeconds
} = require("./shopifyAvailabilityQueue.service");

test("backs off failed Shopify availability jobs up to one hour", () => {
  assert.equal(getRetryDelaySeconds(0), 60);
  assert.equal(getRetryDelaySeconds(1), 120);
  assert.equal(getRetryDelaySeconds(6), 3600);
  assert.equal(getRetryDelaySeconds(20), 3600);
});

test("commits a debounced SKU row before publishing its targeted wake", async () => {
  const neonPath = require.resolve("../db/neon");
  const eventsPath = require.resolve("./shopifyAvailabilityEvents.service");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const originalEventsModule = require.cache[eventsPath];
  const order = [];
  const publishCalls = [];
  const fakeSql = async (strings) => {
    const query = strings.join("");

    if (query.includes("INSERT INTO shopify_availability_sync_queue")) {
      order.push("database");
      return [{ sku: "DPP-123", process_after: "later", revision: 9 }];
    }

    return [];
  };

  neonModule.getSql = () => fakeSql;
  require.cache[eventsPath] = {
    id: eventsPath,
    filename: eventsPath,
    loaded: true,
    exports: {
      publishAvailabilitySyncWake: async (options) => {
        order.push("publish");
        publishCalls.push(options);
        return { messageId: "message-9", skipped: false };
      }
    }
  };
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);
    const result = await queueService.enqueueAvailabilitySync({
      sku: " DPP-123 ",
      source: "follow-up-update",
      delaySeconds: 30
    });

    assert.deepEqual(order, ["database", "publish"]);
    assert.deepEqual(publishCalls, [
      {
        delaySeconds: 30,
        revision: 9,
        sku: "DPP-123",
        source: "follow-up-update"
      }
    ]);
    assert.deepEqual(result, {
      sku: "DPP-123",
      process_after: "later",
      revision: 9,
      wake: { messageId: "message-9", skipped: false }
    });
  } finally {
    neonModule.getSql = originalGetSql;

    if (originalEventsModule) {
      require.cache[eventsPath] = originalEventsModule;
    } else {
      delete require.cache[eventsPath];
    }

    delete require.cache[servicePath];
  }
});

test("surfaces a wake publish failure after preserving the database row", async () => {
  const neonPath = require.resolve("../db/neon");
  const eventsPath = require.resolve("./shopifyAvailabilityEvents.service");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const originalEventsModule = require.cache[eventsPath];
  let rowCommitted = false;
  const publishError = new Error("queue unavailable");
  const fakeSql = async (strings) => {
    if (strings.join("").includes("INSERT INTO shopify_availability_sync_queue")) {
      rowCommitted = true;
      return [{ sku: "DPP-123", process_after: "later", revision: 10 }];
    }

    return [];
  };

  neonModule.getSql = () => fakeSql;
  require.cache[eventsPath] = {
    id: eventsPath,
    filename: eventsPath,
    loaded: true,
    exports: {
      publishAvailabilitySyncWake: async () => {
        throw publishError;
      }
    }
  };
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);

    await assert.rejects(
      queueService.enqueueAvailabilitySync({ sku: "DPP-123" }),
      (error) => {
        assert.equal(error, publishError);
        assert.deepEqual(error.availabilityQueueRecord, {
          sku: "DPP-123",
          process_after: "later",
          revision: 10
        });
        return true;
      }
    );
    assert.equal(rowCommitted, true);
  } finally {
    neonModule.getSql = originalGetSql;

    if (originalEventsModule) {
      require.cache[eventsPath] = originalEventsModule;
    } else {
      delete require.cache[eventsPath];
    }

    delete require.cache[servicePath];
  }
});

test("fallback cleanup deletes only the failed queue revision", async () => {
  const neonPath = require.resolve("../db/neon");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const queries = [];
  const fakeSql = async () => [];

  fakeSql.query = async (query, values) => {
    queries.push({ query, values });
    return [{ sku: "DPP-123" }];
  };
  neonModule.getSql = () => fakeSql;
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);

    assert.equal(
      await queueService.removeAvailabilitySync("DPP-123", { revision: 12 }),
      true
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0].query, /AND revision = \$2/);
    assert.deepEqual(queries[0].values, ["DPP-123", 12]);
  } finally {
    neonModule.getSql = originalGetSql;
    delete require.cache[servicePath];
  }
});

test("an early targeted wake reports the next effective database due time", async () => {
  const neonPath = require.resolve("../db/neon");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const queries = [];
  const fakeSql = async () => [];

  fakeSql.query = async (query, values) => {
    queries.push({ query, values });

    if (query.includes("WITH due AS")) {
      return [];
    }

    if (query.includes("next_wake_delay_seconds")) {
      return [{ pending: 1, next_wake_delay_seconds: 2 }];
    }

    throw new Error("Unexpected SQL query in queue timing test.");
  };
  neonModule.getSql = () => fakeSql;
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);
    const result = await queueService.processDueAvailabilitySyncs({
      sku: "TEST-SKU",
      revision: 7
    });
    const claimQuery = queries.find(({ query }) => query.includes("WITH due AS"));
    const nextWakeQuery = queries.find(({ query }) =>
      query.includes("next_wake_delay_seconds")
    );

    assert.deepEqual(result, {
      claimed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      pending: 1,
      nextWakeDelaySeconds: 2
    });
    assert.deepEqual(claimQuery.values, [100, true, "TEST-SKU", 7, 240]);
    assert.deepEqual(nextWakeQuery.values, [true, "TEST-SKU", 7]);
    assert.match(nextWakeQuery.query, /MIN\(\s*GREATEST\(/);
    assert.match(nextWakeQuery.query, /COALESCE\(locked_until, process_after\)/);
  } finally {
    neonModule.getSql = originalGetSql;
    delete require.cache[servicePath];
  }
});

test("reports no replacement wake when the database queue is empty", async () => {
  const neonPath = require.resolve("../db/neon");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const fakeSql = async () => [];

  fakeSql.query = async () => [
    { pending: 0, next_wake_delay_seconds: null }
  ];
  neonModule.getSql = () => fakeSql;
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);

    assert.deepEqual(await queueService.getNextAvailabilitySyncWake(), {
      pending: 0,
      nextWakeDelaySeconds: null
    });
  } finally {
    neonModule.getSql = originalGetSql;
    delete require.cache[servicePath];
  }
});

test("nightly reconciliation includes stale in-stock products that have lost stock", async () => {
  const neonPath = require.resolve("../db/neon");
  const eventsPath = require.resolve("./shopifyAvailabilityEvents.service");
  const statePath = require.resolve("./shopifyAvailabilityState.service");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
  const originalEventsModule = require.cache[eventsPath];
  const originalStateModule = require.cache[statePath];
  const queries = [];

  neonModule.getSql = () => async (strings, ...values) => {
    queries.push(
      strings.reduce(
        (query, part, index) => `${query}${part}${index < values.length ? "$value" : ""}`,
        ""
      )
    );
    return [];
  };
  require.cache[eventsPath] = {
    id: eventsPath,
    filename: eventsPath,
    loaded: true,
    exports: {
      publishAvailabilitySyncWake: async () => ({
        messageId: "nightly-message",
        skipped: false
      })
    }
  };
  require.cache[statePath] = {
    id: statePath,
    filename: statePath,
    loaded: true,
    exports: {
      initializeSchema: async () => {}
    }
  };
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);

    await queueService.enqueueNightlyReconciliation();

    const reconciliationQuery = queries.find((query) =>
      query.includes("nightly-reconciliation")
    );

    assert.ok(reconciliationQuery);
    assert.match(reconciliationQuery, /OR product\.is_kit = TRUE/);
    assert.match(
      reconciliationQuery,
      /FROM catalog_vendor_products AS assigned_vendor_product/
    );
    assert.match(
      reconciliationQuery,
      /FROM catalog_vendor_products AS stocked_vendor_product/
    );
    assert.match(
      reconciliationQuery,
      /FROM catalog_warehouse_stock AS warehouse_stock/
    );
  } finally {
    neonModule.getSql = originalGetSql;

    if (originalEventsModule) {
      require.cache[eventsPath] = originalEventsModule;
    } else {
      delete require.cache[eventsPath];
    }

    if (originalStateModule) {
      require.cache[statePath] = originalStateModule;
    } else {
      delete require.cache[statePath];
    }

    delete require.cache[servicePath];
  }
});
