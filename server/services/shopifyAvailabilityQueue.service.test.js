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
