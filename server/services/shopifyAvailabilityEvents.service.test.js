const test = require("node:test");
const assert = require("node:assert/strict");

const queueModulePath = require.resolve("@vercel/queue");
const serviceModulePath = require.resolve("./shopifyAvailabilityEvents.service");
const queueEnvironmentKeys = [
  "VERCEL",
  "VERCEL_OIDC_TOKEN"
];

function restoreCachedModule(modulePath, cachedModule) {
  if (cachedModule) {
    require.cache[modulePath] = cachedModule;
    return;
  }

  delete require.cache[modulePath];
}

async function withMockedQueueSend({ environment = {}, send }, callback) {
  const originalQueueModule = require.cache[queueModulePath];
  const originalServiceModule = require.cache[serviceModulePath];
  const originalEnvironment = Object.fromEntries(
    queueEnvironmentKeys.map((key) => [key, process.env[key]])
  );

  for (const key of queueEnvironmentKeys) {
    delete process.env[key];
  }

  Object.assign(process.env, environment);
  const clientOptions = [];
  class FakeQueueClient {
    constructor(options) {
      clientOptions.push(options);
    }

    send(...args) {
      return send(...args);
    }
  }

  require.cache[queueModulePath] = {
    id: queueModulePath,
    filename: queueModulePath,
    loaded: true,
    exports: { QueueClient: FakeQueueClient }
  };
  delete require.cache[serviceModulePath];

  try {
    return await callback(require(serviceModulePath), { clientOptions });
  } finally {
    restoreCachedModule(serviceModulePath, originalServiceModule);
    restoreCachedModule(queueModulePath, originalQueueModule);

    for (const key of queueEnvironmentKeys) {
      const value = originalEnvironment[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("normalizes delayed Shopify availability wake times", async () => {
  await withMockedQueueSend(
    {
      send: async () => ({ messageId: "unused" })
    },
    async ({ _test: { normalizeDelaySeconds } }) => {
      assert.equal(normalizeDelaySeconds(undefined), 0);
      assert.equal(normalizeDelaySeconds(-1), 0);
      assert.equal(normalizeDelaySeconds(30), 30);
      assert.equal(
        normalizeDelaySeconds(10 * 24 * 60 * 60),
        7 * 24 * 60 * 60
      );
    }
  );
});

test("publishes the normalized Shopify availability wake payload", async () => {
  const calls = [];

  await withMockedQueueSend(
    {
      environment: { VERCEL: "1" },
      send: async (...args) => {
        calls.push(args);
        return { messageId: "message-123" };
      }
    },
    async ({ publishAvailabilitySyncWake }, { clientOptions }) => {
      const result = await publishAvailabilitySyncWake({
        delaySeconds: 30,
        revision: "42",
        sku: "  DPP-123  ",
        source: "  follow-up-update  "
      });

      assert.deepEqual(result, {
        messageId: "message-123",
        skipped: false
      });
      assert.deepEqual(clientOptions, [undefined]);
      assert.deepEqual(calls, [
        [
          "shopify-availability-sync",
          {
            kind: "shopify-availability-sync",
            revision: 42,
            sku: "DPP-123",
            source: "follow-up-update"
          },
          {
            delaySeconds: 30,
            retentionSeconds: 7 * 24 * 60 * 60
          }
        ]
      ]);
    }
  );
});

test("treats a null queue message ID as an accepted publish", async () => {
  const calls = [];

  await withMockedQueueSend(
    {
      environment: { VERCEL: "1" },
      send: async (...args) => {
        calls.push(args);
        return { messageId: null };
      }
    },
    async ({ publishAvailabilitySyncWake }) => {
      assert.deepEqual(await publishAvailabilitySyncWake({ sku: "DPP-123" }), {
        messageId: null,
        skipped: false
      });
      assert.equal(calls[0][1].revision, null);
    }
  );
});

test("propagates queue publish failures", async () => {
  const publishError = new Error("queue unavailable");

  await withMockedQueueSend(
    {
      environment: { VERCEL: "1" },
      send: async () => {
        throw publishError;
      }
    },
    async ({ publishAvailabilitySyncWake }) => {
      await assert.rejects(
        publishAvailabilitySyncWake({ sku: "DPP-123" }),
        (error) => error === publishError
      );
    }
  );
});

test("skips local publishing when no Vercel queue credentials are available", async () => {
  let sendCalls = 0;

  await withMockedQueueSend(
    {
      send: async () => {
        sendCalls += 1;
        return { messageId: "unexpected" };
      }
    },
    async ({ publishAvailabilitySyncWake }) => {
      assert.deepEqual(await publishAvailabilitySyncWake({ sku: "DPP-123" }), {
        messageId: null,
        skipped: true
      });
      assert.equal(sendCalls, 0);
    }
  );
});
