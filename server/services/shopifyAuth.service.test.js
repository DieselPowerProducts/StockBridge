const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./shopify.service");

test("Shopify token errors retain the HTTP status without exposing credentials", async () => {
  const previous = {
    fetch: global.fetch,
    clientId: process.env.SHOPIFY_CLIENT_ID2,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET2,
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
    consoleError: console.error
  };
  const logged = [];
  let calls = 0;

  try {
    process.env.SHOPIFY_CLIENT_ID2 = "test-client-auth-failure";
    process.env.SHOPIFY_CLIENT_SECRET2 = "test-secret";
    process.env.SHOPIFY_STORE_DOMAIN = "test.myshopify.com";
    console.error = (...args) => logged.push(args);
    global.fetch = async () => {
      calls += 1;
      return new Response("<html>Unauthorized</html>", {
        status: 401,
        headers: { "content-type": "text/html", "x-request-id": "request-123" }
      });
    };

    await assert.rejects(
      _test.fetchShopifyAccessToken("availability"),
      /Unable to authenticate with Shopify \(HTTP 401\)/
    );
    assert.equal(calls, 1);
    assert.deepEqual(logged[0][1], {
      profile: "availability",
      status: 401,
      contentType: "text/html",
      requestId: "request-123"
    });
  } finally {
    global.fetch = previous.fetch;
    console.error = previous.consoleError;
    for (const [key, value] of [
      ["SHOPIFY_CLIENT_ID2", previous.clientId],
      ["SHOPIFY_CLIENT_SECRET2", previous.clientSecret],
      ["SHOPIFY_STORE_DOMAIN", previous.storeDomain]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Shopify token requests retry temporary server failures", async () => {
  const previous = {
    fetch: global.fetch,
    clientId: process.env.SHOPIFY_CLIENT_ID2,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET2,
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN
  };
  let calls = 0;

  try {
    process.env.SHOPIFY_CLIENT_ID2 = "test-client-transient-failure";
    process.env.SHOPIFY_CLIENT_SECRET2 = "test-secret";
    process.env.SHOPIFY_STORE_DOMAIN = "test.myshopify.com";
    global.fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response("Unavailable", { status: 503 })
        : Response.json({ access_token: "test-token", expires_in: 86399 });
    };

    assert.equal(await _test.fetchShopifyAccessToken("availability"), "test-token");
    assert.equal(calls, 2);
  } finally {
    global.fetch = previous.fetch;
    for (const [key, value] of [
      ["SHOPIFY_CLIENT_ID2", previous.clientId],
      ["SHOPIFY_CLIENT_SECRET2", previous.clientSecret],
      ["SHOPIFY_STORE_DOMAIN", previous.storeDomain]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
