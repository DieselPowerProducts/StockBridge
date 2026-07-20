const assert = require("node:assert/strict");
const test = require("node:test");

const { readBearerToken } = require("./productProspectorAuth");

test("reads a standard bearer token without a regular expression", () => {
  assert.equal(readBearerToken("Bearer secret-key"), "secret-key");
  assert.equal(readBearerToken("bearer    secret-key   "), "secret-key");
});

test("rejects missing or unsupported authorization schemes", () => {
  assert.equal(readBearerToken(""), "");
  assert.equal(readBearerToken("Bearer"), "");
  assert.equal(readBearerToken("Basic secret-key"), "");
});

test("handles a very large malformed header in linear time", () => {
  assert.equal(readBearerToken(`bearer${"  ".repeat(100_000)}`), "");
});
