const { QueueClient } = require("@vercel/queue");

const topicName = "shopify-availability-sync";
const maximumDelaySeconds = 7 * 24 * 60 * 60;
const retentionSeconds = maximumDelaySeconds;
let queue;

function getQueue() {
  if (!queue) {
    // These messages wake a shared Neon-backed queue. Keeping them unpinned makes
    // delayed/retried wakes use the active deployment instead of old application code.
    queue = new QueueClient({ deploymentId: null });
  }

  return queue;
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeDelaySeconds(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(Math.min(parsed, maximumDelaySeconds), 0);
}

function canPublishQueueMessages() {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_OIDC_TOKEN
  );
}

async function publishAvailabilitySyncWake({
  delaySeconds = 0,
  revision = null,
  sku = "",
  source = ""
} = {}) {
  const parsedRevision = Number.parseInt(revision, 10);
  const message = {
    kind: "shopify-availability-sync",
    revision:
      Number.isFinite(parsedRevision) && parsedRevision > 0
        ? parsedRevision
        : null,
    sku: normalizeText(sku, 500),
    source: normalizeText(source, 200)
  };
  const safeDelaySeconds = normalizeDelaySeconds(delaySeconds);

  // Unit tests and the standalone local API server do not have Vercel OIDC.
  // Production always publishes; local queue testing can opt in with a token.
  if (!canPublishQueueMessages()) {
    return {
      messageId: null,
      skipped: true
    };
  }

  const result = await getQueue().send(topicName, message, {
    delaySeconds: safeDelaySeconds,
    retentionSeconds
  });

  return {
    messageId: result.messageId,
    skipped: false
  };
}

module.exports = {
  publishAvailabilitySyncWake,
  topicName,
  _test: {
    canPublishQueueMessages,
    normalizeDelaySeconds
  }
};
