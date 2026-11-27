const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./shopify.service");
const shopifyService = require("./shopify.service");
const catalogService = require("./catalog.service");
const availabilityStateService = require("./shopifyAvailabilityState.service");

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

test("unlisted kit components can change local availability without a Shopify variant", async (t) => {
  const previous = {
    clientId: process.env.SHOPIFY_CLIENT_ID2,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET2,
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN
  };

  try {
    process.env.SHOPIFY_CLIENT_ID2 = "test-kit-component-availability";
    process.env.SHOPIFY_CLIENT_SECRET2 = "test-secret";
    process.env.SHOPIFY_STORE_DOMAIN = "test.myshopify.com";
    t.mock.method(global, "fetch", async (url) =>
      Response.json(
        String(url).endsWith("/admin/oauth/access_token")
          ? { access_token: "test-token", expires_in: 3600 }
          : { data: { productVariants: { nodes: [] } } }
      )
    );
    t.mock.method(catalogService, "getParentKitSkusForSku", async (sku) =>
      sku === "SYN-6410-02" ? ["SYN-8625-03"] : []
    );
    const clearCaches = t.mock.method(catalogService, "clearCaches", () => {});
    const save = t.mock.method(availabilityStateService, "setAvailabilityStatus", async () => ({
      availability: "out_of_stock",
      availabilityModifier: ""
    }));

    const result = await shopifyService.updateProductAvailability({
      sku: "SYN-6410-02",
      availability: "out_of_stock",
      availabilityModifier: "",
      productName: "King 2.0 Steering Stabilizer"
    });

    assert.equal(result.localOnly, true);
    assert.equal(result.updatedMetafieldOwnerCount, 0);
    assert.deepEqual(save.mock.calls[0].arguments[0], {
      sku: "SYN-6410-02",
      availability: "out_of_stock",
      availabilityModifier: "",
      buildToOrderLeadTime: undefined
    });
    assert.equal(clearCaches.mock.callCount(), 1);

    await assert.rejects(
      shopifyService.updateProductAvailability({
        sku: "UNLISTED-NON-KIT",
        availability: "out_of_stock"
      }),
      /No Shopify product matched this SKU/
    );
    assert.equal(save.mock.callCount(), 1);
  } finally {
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
