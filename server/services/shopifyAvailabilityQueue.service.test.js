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

test("nightly reconciliation includes active kit parents with stale in-stock state", async () => {
  const neonPath = require.resolve("../db/neon");
  const servicePath = require.resolve("./shopifyAvailabilityQueue.service");
  const neonModule = require(neonPath);
  const originalGetSql = neonModule.getSql;
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
  delete require.cache[servicePath];

  try {
    const queueService = require(servicePath);

    await queueService.enqueueNightlyReconciliation();

    const reconciliationQuery = queries.find((query) =>
      query.includes("nightly-reconciliation")
    );

    assert.ok(reconciliationQuery);
    assert.match(reconciliationQuery, /OR product\.is_kit = TRUE/);
  } finally {
    neonModule.getSql = originalGetSql;
    delete require.cache[servicePath];
  }
});
