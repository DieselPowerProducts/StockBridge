const {
  PollingQueueClient,
  QueueClient,
  parseRawCallback
} = require("@vercel/queue");
const gmailInventoryService = require("../../server/services/gmailInventory.service");

// Push callbacks must use the same deployment partition as their publishers.
const queue = new QueueClient();
const maximumProcessingAttempts = 5;
const hardAcknowledgeAttempt = 8;
const maximumRetryDelaySeconds = 15 * 60;
const visibilityTimeoutSeconds = 240;

function getDeliveryCount(metadata) {
  return Math.max(Number.parseInt(metadata?.deliveryCount, 10) || 1, 1);
}

function getConsumerRetryDelay(error, deliveryCount) {
  const requestedDelay = Number.parseInt(error?.retryAfterSeconds, 10);

  if (Number.isFinite(requestedDelay) && requestedDelay > 0) {
    return Math.min(requestedDelay, maximumRetryDelaySeconds);
  }

  const safeDeliveryCount = Math.max(
    Number.parseInt(deliveryCount, 10) || 1,
    1
  );

  return Math.min(
    60 * 2 ** (safeDeliveryCount - 1),
    maximumRetryDelaySeconds
  );
}

function getRetryDirective(error, metadata) {
  if (getDeliveryCount(metadata) >= hardAcknowledgeAttempt) {
    return { acknowledge: true };
  }

  return {
    afterSeconds: getConsumerRetryDelay(error, metadata?.deliveryCount)
  };
}

function logQueueResult(level, message, details) {
  console[level](
    JSON.stringify({
      level: level === "log" ? "info" : level,
      message,
      ...details
    })
  );
}

async function processQueueMessage(message, metadata = {}) {
  const deliveryCount = getDeliveryCount(metadata);
  const job = await gmailInventoryService.startQueueJob(message, metadata);

  if (job.status === "completed" || job.status === "failed") {
    logQueueResult("log", "Gmail queue duplicate ignored.", {
      deliveryCount,
      jobKey: job.jobKey,
      jobKind: job.kind,
      queueMessageId: metadata.messageId || "",
      status: job.status
    });

    return {
      duplicate: true,
      jobKey: job.jobKey,
      status: job.status
    };
  }

  if (deliveryCount > maximumProcessingAttempts) {
    const retryLimitError = new Error(
      `Gmail queue job exceeded ${maximumProcessingAttempts} processing attempts.`
    );
    await gmailInventoryService.failQueueJob(job.jobKey, retryLimitError, {
      terminal: true
    });
    logQueueResult("error", "Gmail queue retry limit reached.", {
      deliveryCount,
      error: retryLimitError.message,
      jobKey: job.jobKey,
      jobKind: job.kind,
      queueMessageId: metadata.messageId || ""
    });

    return {
      failed: true,
      jobKey: job.jobKey,
      terminal: true
    };
  }

  try {
    const result = await gmailInventoryService.processQueuedJob(message);
    await gmailInventoryService.completeQueueJob(job.jobKey, result);
    logQueueResult("log", "Gmail queue job processed.", {
      deliveryCount,
      jobKey: job.jobKey,
      jobKind: job.kind,
      queueMessageId: metadata.messageId || "",
      result
    });

    return result;
  } catch (error) {
    const terminal = deliveryCount >= maximumProcessingAttempts;
    await gmailInventoryService.failQueueJob(job.jobKey, error, { terminal });
    logQueueResult("error", "Gmail queue job failed.", {
      deliveryCount,
      error: String(error?.message || error),
      jobKey: job.jobKey,
      jobKind: job.kind,
      queueMessageId: metadata.messageId || "",
      terminal
    });

    if (terminal) {
      return {
        failed: true,
        jobKey: job.jobKey,
        terminal: true
      };
    }

    throw error;
  }
}

const callbackOptions = {
  visibilityTimeoutSeconds,
  retry: getRetryDirective
};
const directQueueCallback = queue.handleNodeCallback(
  processQueueMessage,
  callbackOptions
);

function isIgnorableRoutingResult(result) {
  return (
    result?.ok === false &&
    ["already_processed", "not_available", "not_found"].includes(
      result.reason
    )
  );
}

async function handleRoutingCallback(parsed, res) {
  const pollingQueue = new PollingQueueClient({
    region: parsed.region || process.env.VERCEL_REGION || "iad1"
  });

  try {
    const result = await pollingQueue.receive(
      parsed.queueName,
      parsed.consumerGroup,
      processQueueMessage,
      {
        messageId: parsed.messageId,
        visibilityTimeoutSeconds,
        retry: callbackOptions.retry
      }
    );

    if (isIgnorableRoutingResult(result)) {
      logQueueResult("log", "Stale Gmail queue notification ignored.", {
        queueMessageId: parsed.messageId,
        queueReason: result.reason
      });
      res.status(200).json({ status: "ignored", reason: result.reason });
      return;
    }

    if (!result.ok) {
      res.status(500).json({
        error: "Failed to process Gmail queue message",
        reason: result.reason
      });
      return;
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Gmail queue callback error:", error);
    res.status(500).json({ error: "Failed to process Gmail queue message" });
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    await directQueueCallback(req, res);
    return;
  }

  let parsed;

  try {
    parsed = parseRawCallback(req.body, req.headers);
  } catch {
    await directQueueCallback(req, res);
    return;
  }

  if ("receiptHandle" in parsed) {
    await directQueueCallback(req, res);
    return;
  }

  await handleRoutingCallback(parsed, res);
}

module.exports = handler;

module.exports._test = {
  getConsumerRetryDelay,
  getRetryDirective,
  handleRoutingCallback,
  isIgnorableRoutingResult,
  maximumProcessingAttempts,
  processQueueMessage
};
