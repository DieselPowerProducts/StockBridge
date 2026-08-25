const crypto = require("crypto");
const { QueueClient } = require("@vercel/queue");

const topicName = "gmail-inventory";
const retentionSeconds = 24 * 60 * 60;
let queue;

function getQueue() {
  if (!queue) {
    // Push consumers are partitioned by deployment. Use the default client so
    // every job remains pinned to the deployment that published it.
    queue = new QueueClient();
  }

  return queue;
}

function normalizeText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function createJobKey(kind, parts) {
  const digest = crypto
    .createHash("sha256")
    .update(parts.map((part) => normalizeText(part, 10000)).join("\n"))
    .digest("hex");

  return `gmail-${normalizeText(kind, 40)}-${digest}`;
}

function canPublishQueueMessages() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN);
}

async function publishJob(message) {
  if (!canPublishQueueMessages()) {
    return {
      jobKey: message.jobKey,
      messageId: null,
      skipped: true
    };
  }

  const result = await getQueue().send(topicName, message, {
    idempotencyKey: message.jobKey,
    retentionSeconds
  });

  return {
    jobKey: message.jobKey,
    messageId: result.messageId,
    skipped: false
  };
}

async function publishNotificationScan({ mailboxEmail, targetHistoryId }) {
  const safeMailboxEmail = normalizeText(mailboxEmail, 320).toLowerCase();
  const safeTargetHistoryId = normalizeText(targetHistoryId, 100);

  return publishJob({
    kind: "history-scan",
    jobKey: createJobKey("history-scan", [
      safeMailboxEmail,
      safeTargetHistoryId
    ]),
    mailboxEmail: safeMailboxEmail,
    targetHistoryId: safeTargetHistoryId
  });
}

async function publishHistoryPage({
  mailboxEmail,
  pageToken,
  startHistoryId,
  targetHistoryId
}) {
  const safeMailboxEmail = normalizeText(mailboxEmail, 320).toLowerCase();
  const safePageToken = normalizeText(pageToken, 10000);
  const safeStartHistoryId = normalizeText(startHistoryId, 100);
  const safeTargetHistoryId = normalizeText(targetHistoryId, 100);

  return publishJob({
    kind: "history-page",
    jobKey: createJobKey("history-page", [
      safeMailboxEmail,
      safeStartHistoryId,
      safePageToken
    ]),
    mailboxEmail: safeMailboxEmail,
    pageToken: safePageToken,
    startHistoryId: safeStartHistoryId,
    targetHistoryId: safeTargetHistoryId
  });
}

async function publishInboxRecovery({
  mailboxEmail,
  pageToken = "",
  targetHistoryId
}) {
  const safeMailboxEmail = normalizeText(mailboxEmail, 320).toLowerCase();
  const safePageToken = normalizeText(pageToken, 10000);
  const safeTargetHistoryId = normalizeText(targetHistoryId, 100);

  return publishJob({
    kind: "inbox-recovery",
    jobKey: createJobKey("inbox-recovery", [
      safeMailboxEmail,
      safeTargetHistoryId,
      safePageToken || "first-page"
    ]),
    mailboxEmail: safeMailboxEmail,
    pageToken: safePageToken,
    targetHistoryId: safeTargetHistoryId
  });
}

async function publishMessage({ mailboxEmail, gmailMessageId }) {
  const safeMailboxEmail = normalizeText(mailboxEmail, 320).toLowerCase();
  const safeGmailMessageId = normalizeText(gmailMessageId, 500);

  return publishJob({
    kind: "gmail-message",
    jobKey: createJobKey("gmail-message", [
      safeMailboxEmail,
      safeGmailMessageId
    ]),
    mailboxEmail: safeMailboxEmail,
    gmailMessageId: safeGmailMessageId
  });
}

module.exports = {
  publishHistoryPage,
  publishInboxRecovery,
  publishMessage,
  publishNotificationScan,
  topicName,
  _test: {
    canPublishQueueMessages,
    createJobKey
  }
};
