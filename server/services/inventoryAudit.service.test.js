const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./inventoryAudit.service");

test("collects normalized reply and reference message IDs", () => {
  assert.deepEqual(
    _test.collectMessageIds({
      inReplyTo: "<StockCheck-123@example.com>",
      references: [
        "<older@example.com>",
        "<StockCheck-123@example.com>"
      ]
    }),
    ["stockcheck-123@example.com", "older@example.com"]
  );
});

test("keeps reply text and removes quoted email content", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "We have 12 available and can ship today.",
        "",
        "On Thu, Jul 23, 2026 at 9:00 AM StockBridge wrote:",
        "> Is ABC-123 in stock?",
        "> Thank you!"
      ].join("\r\n")
    ),
    "We have 12 available and can ship today."
  );
});

test("removes Outlook original-message blocks", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "ETA is the first week of August.",
        "",
        "-----Original Message-----",
        "From: StockBridge <stockcheck@example.com>",
        "Sent: Thursday, July 23, 2026",
        "To: Vendor <vendor@example.com>",
        "Subject: Stock Check: ABC-123"
      ].join("\n")
    ),
    "ETA is the first week of August."
  );
});

test("removes inline image placeholders from plain text", () => {
  assert.equal(
    _test.stripQuotedReply("Available now.\n\n[cid:signature-logo@example.com]"),
    "Available now."
  );
});
