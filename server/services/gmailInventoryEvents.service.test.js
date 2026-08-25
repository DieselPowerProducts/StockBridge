const test = require("node:test");
const assert = require("node:assert/strict");

const queueModulePath = require.resolve("@vercel/queue");
const serviceModulePath = require.resolve("./gmailInventoryEvents.service");
const queueEnvironmentKeys = ["VERCEL", "VERCEL_OIDC_TOKEN"];

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
  const clientOptions = [];

  for (const key of queueEnvironmentKeys) {
    delete process.env[key];
  }

  Object.assign(process.env, environment);

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

test("publishes idempotent Gmail scan jobs", async () => {
  const calls = [];

  await withMockedQueueSend(
    {
      environment: { VERCEL: "1" },
      send: async (...args) => {
        calls.push(args);
        return { messageId: "queue-message-1" };
      }
    },
    async ({ publishNotificationScan }, { clientOptions }) => {
      const first = await publishNotificationScan({
        mailboxEmail: " StockCheck@DieselPowerProducts.com ",
        targetHistoryId: "12345"
      });
      const second = await publishNotificationScan({
        mailboxEmail: "stockcheck@dieselpowerproducts.com",
        targetHistoryId: "12345"
      });

      assert.equal(first.jobKey, second.jobKey);
      assert.equal(first.messageId, "queue-message-1");
      assert.deepEqual(clientOptions, [undefined]);
      assert.equal(calls.length, 2);
      assert.equal(calls[0][0], "gmail-inventory");
      assert.deepEqual(calls[0][1], {
        kind: "history-scan",
        jobKey: first.jobKey,
        mailboxEmail: "stockcheck@dieselpowerproducts.com",
        targetHistoryId: "12345"
      });
      assert.deepEqual(calls[0][2], {
        idempotencyKey: first.jobKey,
        retentionSeconds: 24 * 60 * 60
      });
    }
  );
});

test("uses a stable per-message idempotency key", async () => {
  const calls = [];

  await withMockedQueueSend(
    {
      environment: { VERCEL_OIDC_TOKEN: "token" },
      send: async (...args) => {
        calls.push(args);
        return { messageId: "queue-message-2" };
      }
    },
    async ({ publishMessage }) => {
      const result = await publishMessage({
        gmailMessageId: "gmail-abc",
        mailboxEmail: "stockcheck@dieselpowerproducts.com"
      });

      assert.equal(calls[0][1].kind, "gmail-message");
      assert.equal(calls[0][1].gmailMessageId, "gmail-abc");
      assert.equal(calls[0][2].idempotencyKey, result.jobKey);

      const retry = await publishMessage({
        gmailMessageId: "gmail-abc",
        mailboxEmail: "stockcheck@dieselpowerproducts.com",
        retryToken: "manual-1",
        rfcMessageId: "<vendor-sheet@example.com>"
      });

      assert.notEqual(retry.jobKey, result.jobKey);
      assert.equal(calls[1][1].rfcMessageId, "<vendor-sheet@example.com>");
    }
  );
});

test("publishes inventory approval jobs with retry-specific keys", async () => {
  const calls = [];

  await withMockedQueueSend(
    {
      environment: { VERCEL: "1" },
      send: async (...args) => {
        calls.push(args);
        return { messageId: "queue-message-apply" };
      }
    },
    async ({ publishAuditApply }) => {
      const result = await publishAuditApply({
        auditId: "sheet-1",
        mailboxEmail: "stockcheck@dieselpowerproducts.com"
      });

      assert.equal(calls[0][1].kind, "apply-inventory-audit");
      assert.equal(calls[0][1].auditId, "sheet-1");
      assert.equal(calls[0][2].idempotencyKey, result.jobKey);
    }
  );
});

test("skips local Gmail publishing without queue credentials", async () => {
  let sendCalls = 0;

  await withMockedQueueSend(
    {
      send: async () => {
        sendCalls += 1;
        return { messageId: "unexpected" };
      }
    },
    async ({ publishNotificationScan }) => {
      const result = await publishNotificationScan({
        mailboxEmail: "stockcheck@dieselpowerproducts.com",
        targetHistoryId: "12345"
      });

      assert.equal(result.messageId, null);
      assert.equal(result.skipped, true);
      assert.equal(sendCalls, 0);
    }
  );
});
