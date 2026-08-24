const {
  PollingQueueClient,
  QueueClient,
  parseRawCallback
} = require("@vercel/queue");
const shopifyAvailabilityEventsService = require("../../server/services/shopifyAvailabilityEvents.service");
const shopifyAvailabilityQueueService = require("../../server/services/shopifyAvailabilityQueue.service");

// Push callbacks must use the same deployment partition as their publishers.
const queue = new QueueClient();
const maximumRetryDelaySeconds = 60 * 60;
const visibilityTimeoutSeconds = 240;

function getConsumerRetryDelay(error, deliveryCount) {
  const requestedDelay = Number.parseInt(error?.retryAfterSeconds, 10);

  if (Number.isFinite(requestedDelay) && requestedDelay > 0) {
    return Math.min(requestedDelay, maximumRetryDelaySeconds);
  }

  const safeDeliveryCount = Math.max(
    Number.parseInt(deliveryCount, 10) || 1,
    1
  );

  return Math.min(60 * 2 ** (safeDeliveryCount - 1), maximumRetryDelaySeconds);
}

function getMessageTarget(message) {
  const sku = String(message?.sku || "").trim();
  const revision = Number.parseInt(message?.revision, 10);

  return sku && Number.isFinite(revision) && revision > 0
    ? { sku, revision }
    : {};
}

async function processQueueMessage(message, metadata = {}) {
  const target = getMessageTarget(message);
  const result =
    await shopifyAvailabilityQueueService.processDueAvailabilitySyncs(target);

  if (
    result.pending > 0 &&
    Number.isFinite(Number(result.nextWakeDelaySeconds))
  ) {
    try {
      await shopifyAvailabilityEventsService.publishAvailabilitySyncWake({
        ...target,
        delaySeconds: result.nextWakeDelaySeconds,
        source: target.sku ? "queue-target-reschedule" : "queue-drain"
      });
    } catch (error) {
      error.retryAfterSeconds = Math.max(
        Number.parseInt(result.nextWakeDelaySeconds, 10) || 1,
        1
      );
      throw error;
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Shopify availability queue event processed.",
      queueMessageId: metadata.messageId,
      queueSource: String(message?.source || ""),
      queueTargetSku: target.sku || "",
      queueTargetRevision: target.revision || null,
      ...result
    })
  );

  return result;
}

const callbackOptions = {
  visibilityTimeoutSeconds,
  retry: (error, metadata) => ({
    afterSeconds: getConsumerRetryDelay(error, metadata.deliveryCount)
  })
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
      console.log(
        JSON.stringify({
          level: "info",
          message: "Stale Shopify availability queue notification ignored.",
          queueMessageId: parsed.messageId,
          queueReason: result.reason
        })
      );
      res.status(200).json({ status: "ignored", reason: result.reason });
      return;
    }

    if (!result.ok) {
      res.status(500).json({
        error: "Failed to process queue message",
        reason: result.reason
      });
      return;
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Queue callback error:", error);
    res.status(500).json({ error: "Failed to process queue message" });
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
  getMessageTarget,
  handleRoutingCallback,
  isIgnorableRoutingResult,
  processQueueMessage
};
