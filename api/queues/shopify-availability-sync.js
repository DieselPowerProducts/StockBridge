const { QueueClient } = require("@vercel/queue");
const shopifyAvailabilityEventsService = require("../../server/services/shopifyAvailabilityEvents.service");
const shopifyAvailabilityQueueService = require("../../server/services/shopifyAvailabilityQueue.service");

const queue = new QueueClient({ deploymentId: null });
const maximumRetryDelaySeconds = 60 * 60;

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

module.exports = queue.handleNodeCallback(
  processQueueMessage,
  {
    visibilityTimeoutSeconds: 240,
    retry: (error, metadata) => ({
      afterSeconds: getConsumerRetryDelay(error, metadata.deliveryCount)
    })
  }
);

module.exports._test = {
  getConsumerRetryDelay,
  getMessageTarget,
  processQueueMessage
};
