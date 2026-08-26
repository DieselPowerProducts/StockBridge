const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./gmailInventory.service");

test("decodes Gmail Pub/Sub notification data", () => {
  const data = Buffer.from(
    JSON.stringify({
      emailAddress: "StockCheck@DieselPowerProducts.com",
      historyId: "123456789"
    })
  ).toString("base64");

  assert.deepEqual(
    _test.decodePushMessage({
      message: {
        data,
        messageId: "pubsub-1"
      }
    }),
    {
      emailAddress: "stockcheck@dieselpowerproducts.com",
      historyId: "123456789",
      messageId: "pubsub-1"
    }
  );
});

test("encrypts Gmail refresh tokens with authenticated encryption", () => {
  const previousKey = process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY;
  process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY = "test-encryption-key";

  try {
    const encrypted = _test.encryptRefreshToken("refresh-token");

    assert.notEqual(encrypted.ciphertext, "refresh-token");
    assert.equal(_test.decryptRefreshToken({
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      refresh_token_auth_tag: encrypted.authTag
    }), "refresh-token");
  } finally {
    if (previousKey === undefined) {
      delete process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY = previousKey;
    }
  }
});

test("selects Gmail labels for inventory replies and inventory sheets", () => {
  const previousStockCheckLabel = process.env.STOCK_CHECK_GMAIL_LABEL;
  const previousInventoryLabel = process.env.AUTO_INVENTORY_GMAIL_LABEL;
  process.env.STOCK_CHECK_GMAIL_LABEL = "Stock Check Replies";
  process.env.AUTO_INVENTORY_GMAIL_LABEL = "Vendor Sheets";

  try {
    assert.deepEqual(
      _test.getMessageLabelNames({
        inventoryAuditMatched: true,
        shouldLabelInventory: true
      }),
      ["Stock Check Replies", "Vendor Sheets"]
    );
    assert.deepEqual(
      _test.getMessageLabelNames({
        inventoryAuditMatched: true
      }),
      ["Stock Check Replies"]
    );
  } finally {
    if (previousStockCheckLabel === undefined) {
      delete process.env.STOCK_CHECK_GMAIL_LABEL;
    } else {
      process.env.STOCK_CHECK_GMAIL_LABEL = previousStockCheckLabel;
    }

    if (previousInventoryLabel === undefined) {
      delete process.env.AUTO_INVENTORY_GMAIL_LABEL;
    } else {
      process.env.AUTO_INVENTORY_GMAIL_LABEL = previousInventoryLabel;
    }
  }
});

test("compares Gmail history IDs without losing integer precision", () => {
  assert.equal(
    _test.isHistoryAtOrBeyond("99999999999999999999", "99999999999999999998"),
    true
  );
  assert.equal(_test.isHistoryAtOrBeyond("123", "124"), false);
  assert.equal(_test.isHistoryAtOrBeyond("", "124"), false);
  assert.equal(
    _test.getLatestHistoryId("123", "99999999999999999999", "456"),
    "99999999999999999999"
  );
});

test("uses a SQL-safe numeric Gmail history ID pattern", () => {
  assert.equal(_test.gmailHistoryIdSqlPattern, "^[0-9]+$");
});

test("finds the original inventory attachment by content hash", () => {
  const wantedContent = Buffer.from("Item,Available\nABC,4\n");
  const otherContent = Buffer.from("other");
  const attachment = _test.findInventorySheetAttachment(
    [
      { filename: "inventory.csv", content: otherContent },
      { filename: "renamed.csv", content: wantedContent }
    ],
    {
      attachmentFilename: "inventory.csv",
      attachmentHash: require("crypto")
        .createHash("sha256")
        .update(wantedContent)
        .digest("hex")
    }
  );

  assert.equal(attachment.filename, "renamed.csv");
});

test("normalizes Gmail queue jobs", () => {
  assert.deepEqual(
    _test.normalizeQueueJob({
      gmailMessageId: " gmail-1 ",
      jobKey: " job-1 ",
      kind: " gmail-message ",
      mailboxEmail: " StockCheck@DieselPowerProducts.com "
    }),
    {
      auditId: "",
      gmailMessageId: "gmail-1",
      jobKey: "job-1",
      kind: "gmail-message",
      mailboxEmail: "stockcheck@dieselpowerproducts.com",
      pageToken: "",
      retryToken: "",
      rfcMessageId: "",
      startHistoryId: "",
      targetHistoryId: ""
    }
  );

  assert.throws(
    () => _test.normalizeQueueJob({ kind: "gmail-message" }),
    /Invalid Gmail queue job/
  );
});
