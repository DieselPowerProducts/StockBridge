const test = require("node:test");
const assert = require("node:assert/strict");

const queueModulePath = require.resolve("@vercel/queue");
const consumerModulePath = require.resolve("./shopify-availability-sync");
const eventsServiceModulePath = require.resolve(
  "../../server/services/shopifyAvailabilityEvents.service"
);
const availabilityQueueServiceModulePath = require.resolve(
  "../../server/services/shopifyAvailabilityQueue.service"
);

function restoreCachedModule(modulePath, cachedModule) {
  if (cachedModule) {
    require.cache[modulePath] = cachedModule;
    return;
  }

  delete require.cache[modulePath];
}

async function withMockedConsumer(
  { processResult, publishAvailabilitySyncWake },
  callback
) {
  const modulePaths = [
    queueModulePath,
    consumerModulePath,
    eventsServiceModulePath,
    availabilityQueueServiceModulePath
  ];
  const originalModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]])
  );
  const calls = {
    process: [],
    publish: []
  };
  let callbackOptions;
  let clientOptions;

  class FakeQueueClient {
    constructor(options) {
      clientOptions = options;
    }

    handleNodeCallback(handler, options) {
      callbackOptions = options;
      return handler;
    }
  }

  require.cache[queueModulePath] = {
    id: queueModulePath,
    filename: queueModulePath,
    loaded: true,
    exports: { QueueClient: FakeQueueClient }
  };
  require.cache[eventsServiceModulePath] = {
    id: eventsServiceModulePath,
    filename: eventsServiceModulePath,
    loaded: true,
    exports: {
      publishAvailabilitySyncWake: async (options) => {
        calls.publish.push(options);
        return publishAvailabilitySyncWake
          ? publishAvailabilitySyncWake(options)
          : { messageId: "wake-message", skipped: false };
      }
    }
  };
  require.cache[availabilityQueueServiceModulePath] = {
    id: availabilityQueueServiceModulePath,
    filename: availabilityQueueServiceModulePath,
    loaded: true,
    exports: {
      processDueAvailabilitySyncs: async (target) => {
        calls.process.push(target);
        return typeof processResult === "function"
          ? processResult()
          : processResult;
      }
    }
  };
  delete require.cache[consumerModulePath];

  try {
    const consumer = require(consumerModulePath);

    return await callback({
      callbackOptions,
      calls,
      clientOptions,
      consumer,
      processQueueMessage: consumer._test.processQueueMessage
    });
  } finally {
    for (const modulePath of modulePaths) {
      restoreCachedModule(modulePath, originalModules.get(modulePath));
    }
  }
}

test("reschedules pending work using the exact database-derived delay", async () => {
  await withMockedConsumer(
    {
      processResult: {
        claimed: 1,
        completed: 1,
        failed: 0,
        nextWakeDelaySeconds: 17,
        pending: 3,
        retried: 0
      }
    },
    async ({ calls, processQueueMessage }) => {
      await processQueueMessage(
        {
          revision: 24,
          sku: "DPP-123",
          source: "follow-up-update"
        },
        { messageId: "queue-message-1" }
      );

      assert.deepEqual(calls.process, [{ sku: "DPP-123", revision: 24 }]);
      assert.equal(calls.publish.length, 1);
      assert.equal(calls.publish[0].delaySeconds, 17);
      assert.equal(calls.publish[0].revision, 24);
      assert.equal(calls.publish[0].sku, "DPP-123");
    }
  );
});

test("does not publish another wake when the database reports no pending work", async () => {
  await withMockedConsumer(
    {
      processResult: {
        claimed: 0,
        completed: 0,
        failed: 0,
        nextWakeDelaySeconds: 0,
        pending: 0,
        retried: 0
      }
    },
    async ({ calls, processQueueMessage }) => {
      await processQueueMessage(
        { revision: 24, sku: "DPP-123", source: "follow-up-update" },
        { messageId: "queue-message-2" }
      );

      assert.deepEqual(calls.process, [{ sku: "DPP-123", revision: 24 }]);
      assert.deepEqual(calls.publish, []);
    }
  );
});

test("backs consumer retries off to a maximum of one hour", async () => {
  await withMockedConsumer(
    {
      processResult: {
        nextWakeDelaySeconds: 0,
        pending: 0
      }
    },
    async ({ callbackOptions, clientOptions, consumer }) => {
      const { getConsumerRetryDelay } = consumer._test;

      assert.equal(clientOptions, undefined);
      assert.equal(getConsumerRetryDelay(null, 1), 60);
      assert.equal(getConsumerRetryDelay(null, 2), 120);
      assert.equal(getConsumerRetryDelay(null, 7), 3600);
      assert.equal(
        getConsumerRetryDelay({ retryAfterSeconds: 17 }, 20),
        17
      );
      assert.equal(
        getConsumerRetryDelay({ retryAfterSeconds: 999999 }, 1),
        3600
      );
      assert.deepEqual(callbackOptions.retry(null, { deliveryCount: 2 }), {
        afterSeconds: 120
      });
    }
  );
});
