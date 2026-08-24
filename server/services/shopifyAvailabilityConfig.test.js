const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const config = require(path.resolve(__dirname, "../../vercel.json"));

test("keeps every existing non-availability cron schedule unchanged", () => {
  const schedulesByPath = new Map(
    config.crons.map((cron) => [cron.path, cron.schedule])
  );

  assert.equal(
    schedulesByPath.get("/api/cron/catalog-warehouse-sync"),
    "0 0-3,13-23 * * *"
  );
  assert.equal(
    schedulesByPath.get("/api/cron/catalog-full-sync"),
    "15 10 * * *"
  );
  assert.equal(
    schedulesByPath.get("/api/cron/auto-inventory"),
    "0 * * * *"
  );
  assert.equal(schedulesByPath.get("/api/cron/gmail-watch"), "30 9 * * *");
});

test("runs the push consumer serially without the availability polling cron", () => {
  const queueFunction =
    config.functions["api/queues/shopify-availability-sync.js"];
  const trigger = queueFunction.experimentalTriggers.find(
    (candidate) => candidate.type === "queue/v2beta"
  );
  const availabilityCron = config.crons.find(
    (cron) => cron.path === "/api/cron/shopify-availability-sync"
  );

  assert.ok(queueFunction);
  assert.deepEqual(trigger, {
    type: "queue/v2beta",
    topic: "shopify-availability-sync",
    retryAfterSeconds: 60,
    initialDelaySeconds: 0,
    maxConcurrency: 1
  });
  assert.equal(availabilityCron, undefined);
});
