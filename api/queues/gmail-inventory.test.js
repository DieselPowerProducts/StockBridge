const test = require("node:test");
const assert = require("node:assert/strict");

const queueModulePath = require.resolve("@vercel/queue");
const consumerModulePath = require.resolve("./gmail-inventory");
const gmailServiceModulePath = require.resolve(
  "../../server/services/gmailInventory.service"
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
    failError,
    processError,
    processResult = { messagesQueued: 1 },
    startResult = {
      jobKey: "gmail-job-1",
      kind: "gmail-message",
      status: "processing"
    }
  } = {},
  callback
) {
  const modulePaths = [
    queueModulePath,
    consumerModulePath,
    gmailServiceModulePath
  ];
  const originalModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]])
  );
  const calls = {
    complete: [],
    fail: [],
    process: [],
    start: []
  };
  let callbackOptions;

  class FakeQueueClient {
    handleNodeCallback(handler, options) {
      callbackOptions = options;
      return async (_req, res) => res.status(202).json({ status: "direct" });
    }
  }

  class FakePollingQueueClient {}

  require.cache[queueModulePath] = {
    id: queueModulePath,
    filename: queueModulePath,
    loaded: true,
    exports: {
      PollingQueueClient: FakePollingQueueClient,
      QueueClient: FakeQueueClient,
      parseRawCallback: () => ({ receiptHandle: "receipt-1" })
    }
  };
  require.cache[gmailServiceModulePath] = {
    id: gmailServiceModulePath,
    filename: gmailServiceModulePath,
    loaded: true,
    exports: {
      completeQueueJob: async (...args) => {
        calls.complete.push(args);
      },
      failQueueJob: async (...args) => {
        calls.fail.push(args);
        if (failError) throw failError;
      },
      processQueuedJob: async (...args) => {
        calls.process.push(args);
        if (processError) throw processError;
        return processResult;
      },
      startQueueJob: async (...args) => {
        calls.start.push(args);
        return startResult;
      }
    }
  };
  delete require.cache[consumerModulePath];

  try {
    const consumer = require(consumerModulePath);
    return await callback({
      callbackOptions,
      calls,
      consumer,
      processQueueMessage: consumer._test.processQueueMessage
    });
  } finally {
    for (const modulePath of modulePaths) {
      restoreCachedModule(modulePath, originalModules.get(modulePath));
    }
  }
}

const message = {
  gmailMessageId: "gmail-message-1",
  jobKey: "gmail-job-1",
  kind: "gmail-message",
  mailboxEmail: "stockcheck@dieselpowerproducts.com"
};

test("completes a successful Gmail queue job", async () => {
  await withMockedConsumer({}, async ({ calls, processQueueMessage }) => {
    const result = await processQueueMessage(message, {
      deliveryCount: 1,
      messageId: "queue-message-1"
    });

    assert.deepEqual(result, { messagesQueued: 1 });
    assert.equal(calls.start.length, 1);
    assert.equal(calls.process.length, 1);
    assert.deepEqual(calls.complete, [
      ["gmail-job-1", { messagesQueued: 1 }]
    ]);
    assert.deepEqual(calls.fail, []);
  });
});

test("acknowledges already completed Gmail queue jobs", async () => {
  await withMockedConsumer(
    {
      startResult: {
        jobKey: "gmail-job-1",
        kind: "gmail-message",
        status: "completed"
      }
    },
    async ({ calls, processQueueMessage }) => {
      const result = await processQueueMessage(message, {
        deliveryCount: 2,
        messageId: "queue-message-2"
      });

      assert.equal(result.duplicate, true);
      assert.deepEqual(calls.process, []);
      assert.deepEqual(calls.complete, []);
    }
  );
});

test("retries transient Gmail job failures", async () => {
  const processError = new Error("temporary Gmail error");
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await withMockedConsumer(
      { processError },
      async ({ calls, processQueueMessage }) => {
        await assert.rejects(
          processQueueMessage(message, {
            deliveryCount: 2,
            messageId: "queue-message-3"
          }),
          (error) => error === processError
        );

        assert.equal(calls.fail.length, 1);
        assert.deepEqual(calls.fail[0][2], { terminal: false });
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("stores and acknowledges the fifth failed processing attempt", async () => {
  const processError = new Error("poison Gmail message");
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await withMockedConsumer(
      { processError },
      async ({ calls, processQueueMessage }) => {
        const result = await processQueueMessage(message, {
          deliveryCount: 5,
          messageId: "queue-message-4"
        });

        assert.equal(result.terminal, true);
        assert.equal(calls.fail.length, 1);
        assert.deepEqual(calls.fail[0][2], { terminal: true });
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("does not rerun work after prior invocations reached the time limit", async () => {
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await withMockedConsumer({}, async ({ calls, processQueueMessage }) => {
      const result = await processQueueMessage(message, {
        deliveryCount: 6,
        messageId: "queue-message-5"
      });

      assert.equal(result.terminal, true);
      assert.deepEqual(calls.process, []);
      assert.equal(calls.fail.length, 1);
      assert.deepEqual(calls.fail[0][2], { terminal: true });
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("backs off retries and enforces a hard acknowledgement ceiling", async () => {
  await withMockedConsumer({}, async ({ callbackOptions, consumer }) => {
    const { getConsumerRetryDelay, getRetryDirective } = consumer._test;

    assert.equal(getConsumerRetryDelay(null, 1), 60);
    assert.equal(getConsumerRetryDelay(null, 2), 120);
    assert.equal(getConsumerRetryDelay(null, 8), 15 * 60);
    assert.deepEqual(getRetryDirective(null, { deliveryCount: 4 }), {
      afterSeconds: 480
    });
    assert.deepEqual(getRetryDirective(null, { deliveryCount: 8 }), {
      acknowledge: true
    });
    assert.deepEqual(callbackOptions.retry(null, { deliveryCount: 8 }), {
      acknowledge: true
    });
  });
});
