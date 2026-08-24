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
  {
    parsedCallback = {
      receiptHandle: "receipt-1"
    },
    processResult,
    publishAvailabilitySyncWake,
    receiveError,
    receiveResult = { ok: true }
  },
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
    direct: [],
    process: [],
    publish: [],
    receive: []
  };
  let callbackOptions;
  let clientOptions;
  const pollingClientOptions = [];

  class FakeQueueClient {
    constructor(options) {
      clientOptions = options;
    }

    handleNodeCallback(handler, options) {
      callbackOptions = options;
      return async (req, res) => {
        calls.direct.push({ req });
        res.status(202).json({ status: "direct" });
      };
    }
  }

  class FakePollingQueueClient {
    constructor(options) {
      pollingClientOptions.push(options);
    }

    async receive(...args) {
      calls.receive.push(args);

      if (receiveError) {
        throw receiveError;
      }

      return receiveResult;
    }
  }

  require.cache[queueModulePath] = {
    id: queueModulePath,
    filename: queueModulePath,
    loaded: true,
    exports: {
      PollingQueueClient: FakePollingQueueClient,
      QueueClient: FakeQueueClient,
      parseRawCallback: () => parsedCallback
    }
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
      pollingClientOptions,
      processQueueMessage: consumer._test.processQueueMessage
    });
  } finally {
    for (const modulePath of modulePaths) {
      restoreCachedModule(modulePath, originalModules.get(modulePath));
    }
  }
}

function createResponse() {
  return {
    body: null,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
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

test("acknowledges stale routing notifications without processing them again", async () => {
  await withMockedConsumer(
    {
      parsedCallback: {
        consumerGroup: "availability-consumer",
        messageId: "missing-message",
        queueName: "shopify-availability-sync",
        region: "iad1"
      },
      processResult: {},
      receiveResult: {
        messageId: "missing-message",
        ok: false,
        reason: "not_found"
      }
    },
    async ({ calls, consumer, pollingClientOptions }) => {
      const response = createResponse();

      await consumer({ body: {}, headers: {}, method: "POST" }, response);

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body, {
        reason: "not_found",
        status: "ignored"
      });
      assert.deepEqual(pollingClientOptions, [{ region: "iad1" }]);
      assert.equal(calls.receive.length, 1);
      assert.deepEqual(calls.process, []);
      assert.deepEqual(calls.direct, []);
    }
  );
});

test("keeps unexpected routing failures retryable", async () => {
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await withMockedConsumer(
      {
        parsedCallback: {
          consumerGroup: "availability-consumer",
          messageId: "retry-message",
          queueName: "shopify-availability-sync",
          region: "iad1"
        },
        processResult: {},
        receiveError: new Error("queue unavailable")
      },
      async ({ consumer }) => {
        const response = createResponse();

        await consumer({ body: {}, headers: {}, method: "POST" }, response);

        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.body, {
          error: "Failed to process queue message"
        });
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("keeps inline queue delivery on the SDK callback path", async () => {
  await withMockedConsumer(
    {
      parsedCallback: {
        messageId: "inline-message",
        receiptHandle: "receipt-1"
      },
      processResult: {}
    },
    async ({ calls, consumer }) => {
      const response = createResponse();

      await consumer({ body: {}, headers: {}, method: "POST" }, response);

      assert.equal(response.statusCode, 202);
      assert.deepEqual(response.body, { status: "direct" });
      assert.equal(calls.direct.length, 1);
      assert.deepEqual(calls.receive, []);
    }
  );
});
