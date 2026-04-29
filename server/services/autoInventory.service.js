const crypto = require("crypto");
const { Readable } = require("stream");
const csv = require("csv-parser");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const catalogService = require("./catalog.service");
const notificationsService = require("./notifications.service");
const productsService = require("./products.service");
const settingsService = require("./vendorAutoInventorySettings.service");
const importsService = require("./vendorAutoInventoryImports.service");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const defaultLookbackDays = 14;
const autoInventoryFailureRecipient =
  process.env.AUTO_INVENTORY_FAILURE_RECIPIENT || "cade@dieselpowerproducts.com";
const vendorInventoryLabel =
  process.env.AUTO_INVENTORY_GMAIL_LABEL || "Vendor Inventory";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getImapConfig() {
  const user = normalizeText(process.env.GMAIL_IMAP_USER) || normalizeText(process.env.GMAIL_USER);
  const pass =
    normalizeText(process.env.GMAIL_IMAP_APP_PASSWORD) ||
    normalizeText(process.env.GMAIL_APP_PASSWORD);
  const missing = [
    ["GMAIL_IMAP_USER or GMAIL_USER", user],
    ["GMAIL_IMAP_APP_PASSWORD or GMAIL_APP_PASSWORD", pass]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const error = new Error(`Missing Gmail IMAP configuration: ${missing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }

  const port = Number.parseInt(process.env.GMAIL_IMAP_PORT || "993", 10);

  return {
    host: normalizeText(process.env.GMAIL_IMAP_HOST) || "imap.gmail.com",
    port: Number.isFinite(port) ? port : 993,
    secure: getBooleanEnv(process.env.GMAIL_IMAP_SECURE, true),
    auth: {
      user,
      pass
    },
    logger: false
  };
}

function getLookbackDate() {
  const days = Math.max(
    Number.parseInt(process.env.AUTO_INVENTORY_LOOKBACK_DAYS || "", 10) ||
      defaultLookbackDays,
    1
  );
  const date = new Date();

  date.setDate(date.getDate() - days);
  return date;
}

function getAttachmentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function buildFailureNoteId({ vendorId, attachmentHash, reason }) {
  const hash = crypto
    .createHash("sha1")
    .update(`${vendorId}:${attachmentHash}:${reason}`)
    .digest("hex");

  return `auto-inventory:${hash}`;
}

async function notifyAutoInventoryFailure({
  settings,
  attachment,
  attachmentHash,
  reason,
  details = ""
}) {
  const vendorId = normalizeText(settings?.vendorId);
  const filename = normalizeText(attachment?.filename) || "CSV attachment";
  const senderEmail = normalizeEmail(settings?.senderEmail);
  const safeReason = normalizeText(reason);
  const safeDetails = normalizeText(details);
  const notePreview = [
    `Auto inventory import issue for vendor ${vendorId || "unknown vendor"}.`,
    `File: ${filename}.`,
    senderEmail ? `Sender: ${senderEmail}.` : "",
    safeReason ? `Issue: ${safeReason}.` : "",
    safeDetails ? `Details: ${safeDetails}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  await notificationsService.createSystemNotification({
    recipientEmail: autoInventoryFailureRecipient,
    recipientName: "Cade Carlson",
    sku: "AUTO-INVENTORY",
    noteId: buildFailureNoteId({
      vendorId,
      attachmentHash: attachmentHash || filename,
      reason: safeReason || "unknown"
    }),
    notePreview,
    senderName: "StockBridge Auto Inventory"
  });
}

function isCsvAttachment(attachment) {
  const filename = normalizeText(attachment?.filename).toLowerCase();
  const contentType = normalizeText(attachment?.contentType).toLowerCase();

  return (
    filename.endsWith(".csv") ||
    contentType.includes("csv") ||
    contentType.includes("excel")
  );
}

function getSenderEmails(parsedMessage) {
  return (parsedMessage?.from?.value || [])
    .map((sender) => normalizeEmail(sender?.address))
    .filter(Boolean);
}

function getMessageDateValue(message) {
  const date = new Date(message?.internalDate || 0);

  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getLatestMessage(messages) {
  return messages.reduce((latest, message) => {
    if (!latest) {
      return message;
    }

    const messageDate = getMessageDateValue(message);
    const latestDate = getMessageDateValue(latest);

    if (messageDate > latestDate) {
      return message;
    }

    if (messageDate === latestDate && Number(message?.uid || 0) > Number(latest?.uid || 0)) {
      return message;
    }

    return latest;
  }, null);
}

function findHeaderValue(row, headerName) {
  const wantedHeader = normalizeComparable(headerName);
  const key = Object.keys(row || {}).find(
    (item) => normalizeComparable(item.replace(/^\uFEFF/, "")) === wantedHeader
  );

  return key ? normalizeText(row[key]) : "";
}

function hasHeader(row, headerName) {
  const wantedHeader = normalizeComparable(headerName);

  return Object.keys(row || {}).some(
    (item) => normalizeComparable(item.replace(/^\uFEFF/, "")) === wantedHeader
  );
}

function parseNumericalQuantity(value) {
  const normalized = normalizeText(value).replace(/,/g, "");
  const match = normalized.match(/-?\d+(\.\d+)?/);

  if (!match) {
    return null;
  }

  return Number(match[0]) > 0
    ? enabledVendorStockQuantity
    : disabledVendorStockQuantity;
}

function phraseMatches(value, phrases) {
  const normalizedValue = normalizeComparable(value);

  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeComparable(phrase);

    return (
      normalizedPhrase &&
      (normalizedValue === normalizedPhrase ||
        normalizedValue.includes(normalizedPhrase))
    );
  });
}

function parseAlphabeticalQuantity(value, settings) {
  if (phraseMatches(value, settings.inStockPhrases)) {
    return enabledVendorStockQuantity;
  }

  if (phraseMatches(value, settings.outOfStockPhrases)) {
    return disabledVendorStockQuantity;
  }

  return null;
}

function parseInventoryQuantity(value, settings) {
  return settings.inventoryMode === "alphabetical"
    ? parseAlphabeticalQuantity(value, settings)
    : parseNumericalQuantity(value);
}

function parseCsvRows(content) {
  return new Promise((resolve, reject) => {
    const rows = [];

    Readable.from([content])
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("error", reject)
      .on("end", () => resolve(rows));
  });
}

async function importCsvAttachment({ settings, attachment, message }) {
  const content = attachment.content || Buffer.alloc(0);
  const attachmentHash = getAttachmentHash(content);

  if (await importsService.hasProcessedAttachment(settings.vendorId, attachmentHash)) {
    return {
      imported: 0,
      skipped: 0,
      errors: 0,
      duplicate: true
    };
  }

  let rows;

  try {
    rows = await parseCsvRows(content);
  } catch (error) {
    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "CSV could not be parsed",
      details: error.message
    });
    await importsService.recordImport({
      vendorId: settings.vendorId,
      messageUid: message.uid,
      messageId: message.messageId,
      senderEmail: settings.senderEmail,
      attachmentFilename: attachment.filename,
      attachmentHash,
      errorCount: 1,
      status: "failed",
      errorMessage: error.message
    });
    return {
      imported: 0,
      skipped: 0,
      errors: 1,
      duplicate: false
    };
  }

  if (rows.length === 0) {
    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "CSV did not contain any rows"
    });
    await importsService.recordImport({
      vendorId: settings.vendorId,
      messageUid: message.uid,
      messageId: message.messageId,
      senderEmail: settings.senderEmail,
      attachmentFilename: attachment.filename,
      attachmentHash,
      errorCount: 1,
      status: "failed",
      errorMessage: "CSV did not contain any rows."
    });

    return {
      imported: 0,
      skipped: 0,
      errors: 1,
      duplicate: false
    };
  }

  const firstRow = rows[0] || {};
  const missingHeaders = [
    !hasHeader(firstRow, settings.skuHeader) ? settings.skuHeader : "",
    !hasHeader(firstRow, settings.inventoryHeader) ? settings.inventoryHeader : ""
  ].filter(Boolean);

  if (missingHeaders.length > 0) {
    const availableHeaders = Object.keys(firstRow)
      .map((header) => header.replace(/^\uFEFF/, ""))
      .filter(Boolean)
      .join(", ");

    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "Configured CSV header was not found",
      details: `Missing: ${missingHeaders.join(", ")}. Available headers: ${availableHeaders || "none"}.`
    });
    await importsService.recordImport({
      vendorId: settings.vendorId,
      messageUid: message.uid,
      messageId: message.messageId,
      senderEmail: settings.senderEmail,
      attachmentFilename: attachment.filename,
      attachmentHash,
      errorCount: 1,
      status: "failed",
      errorMessage: `Missing header(s): ${missingHeaders.join(", ")}`
    });

    return {
      imported: 0,
      skipped: rows.length,
      errors: 1,
      duplicate: false
    };
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const missingSkuSamples = [];
  const unmatchedInventorySamples = [];
  const updateErrorSamples = [];

  for (const row of rows) {
    const sku = findHeaderValue(row, settings.skuHeader);
    const inventoryValue = findHeaderValue(row, settings.inventoryHeader);
    const quantity = parseInventoryQuantity(inventoryValue, settings);

    if (!sku || quantity === null) {
      skipped += 1;

      if (!sku && missingSkuSamples.length < 5) {
        missingSkuSamples.push(JSON.stringify(row).slice(0, 180));
      } else if (quantity === null && unmatchedInventorySamples.length < 5) {
        unmatchedInventorySamples.push(`${sku || "unknown SKU"} => ${inventoryValue || "blank"}`);
      }

      continue;
    }

    try {
      const vendorProduct =
        await catalogService.getCatalogVendorProductByVendorAndSku(
          settings.vendorId,
          sku
        );

      if (!vendorProduct) {
        skipped += 1;
        continue;
      }

      const currentIsAvailable = Number(vendorProduct.quantity || 0) > 0;
      const nextIsAvailable = quantity > 0;

      if (currentIsAvailable === nextIsAvailable) {
        skipped += 1;
        continue;
      }

      await productsService.setVendorProductQuantity({
        vendorId: settings.vendorId,
        vendorProductId: vendorProduct.id,
        quantity,
        vendorProduct
      });
      imported += 1;
    } catch (error) {
      errors += 1;
      if (updateErrorSamples.length < 5) {
        updateErrorSamples.push(`${sku}: ${error.message}`);
      }
      console.error("Auto inventory row import failed.", {
        vendorId: settings.vendorId,
        sku,
        error: error.message
      });
    }
  }

  const failureDetails = [];

  if (missingSkuSamples.length > 0) {
    failureDetails.push(`Rows missing SKU: ${missingSkuSamples.join(" | ")}`);
  }

  if (unmatchedInventorySamples.length > 0) {
    const modeDetails =
      settings.inventoryMode === "alphabetical"
        ? `Expected in-stock phrases: ${settings.inStockPhrases.join(" : ") || "none"}; out-of-stock phrases: ${settings.outOfStockPhrases.join(" : ") || "none"}.`
        : "Expected a numerical inventory value.";

    failureDetails.push(
      `Unrecognized inventory values: ${unmatchedInventorySamples.join(" | ")}. ${modeDetails}`
    );
  }

  if (updateErrorSamples.length > 0) {
    failureDetails.push(`SKU Nexus update errors: ${updateErrorSamples.join(" | ")}`);
  }

  if (failureDetails.length > 0) {
    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "Some inventory rows could not be imported",
      details: failureDetails.join(" ")
    });
  }

  await importsService.recordImport({
    vendorId: settings.vendorId,
    messageUid: message.uid,
    messageId: message.messageId,
    senderEmail: settings.senderEmail,
    attachmentFilename: attachment.filename,
    attachmentHash,
    importedCount: imported,
    skippedCount: skipped,
    errorCount: errors,
    status:
      errors > 0 || failureDetails.length > 0
        ? "completed_with_errors"
        : "completed",
    errorMessage: failureDetails.join(" ").slice(0, 1000)
  });

  return {
    imported,
    skipped,
    errors,
    duplicate: false
  };
}

async function processMessageForSettings({ uid, source }, settings) {
  const parsed = await simpleParser(source);
  const senderEmails = getSenderEmails(parsed);

  if (!senderEmails.includes(settings.senderEmail)) {
    return {
      imported: 0,
      skipped: 0,
      errors: 0,
      attachments: 0,
      shouldLabel: false
    };
  }

  const csvAttachments = (parsed.attachments || []).filter(isCsvAttachment);
  const totals = {
    imported: 0,
    skipped: 0,
    errors: 0,
    attachments: 0,
    shouldLabel: csvAttachments.length > 0
  };

  for (const attachment of csvAttachments) {
    const result = await importCsvAttachment({
      settings,
      attachment,
      message: {
        uid: String(uid),
        messageId: normalizeText(parsed.messageId)
      }
    });

    totals.attachments += result.duplicate ? 0 : 1;
    totals.imported += result.imported;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
  }

  return totals;
}

async function shouldLabelMessageForSettings({ source }, settings) {
  const parsed = await simpleParser(source);
  const senderEmails = getSenderEmails(parsed);

  if (!senderEmails.includes(settings.senderEmail)) {
    return false;
  }

  return (parsed.attachments || []).some(isCsvAttachment);
}

async function applyVendorInventoryLabel(client, uid) {
  if (!vendorInventoryLabel) {
    return false;
  }

  await client.messageFlagsAdd(
    String(uid),
    [vendorInventoryLabel],
    {
      uid: true,
      useLabels: true
    }
  );

  await client.messageFlagsRemove(
    String(uid),
    ["\\Inbox"],
    {
      uid: true,
      useLabels: true
    }
  );

  return true;
}

async function runAutoInventoryImport() {
  const settingsList = await settingsService.getEnabledSettings();

  if (settingsList.length === 0) {
    return {
      ok: true,
      vendors: 0,
      messages: 0,
      attachments: 0,
      labeled: 0,
      imported: 0,
      skipped: 0,
      errors: 0
    };
  }

  const client = new ImapFlow(getImapConfig());
  const totals = {
    ok: true,
    vendors: settingsList.length,
    messages: 0,
    attachments: 0,
    labeled: 0,
    imported: 0,
    skipped: 0,
    errors: 0
  };
  const labeledUids = new Set();

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    const since = getLookbackDate();

    for (const settings of settingsList) {
      const uids =
        (await client.search(
          {
            from: settings.senderEmail,
            since
          },
          { uid: true }
        )) || [];
      const messages = [];

      for (const uid of uids) {
        const message = await client.fetchOne(
          String(uid),
          { internalDate: true, source: true },
          { uid: true }
        );

        if (!message?.source) {
          continue;
        }

        messages.push({
          uid,
          internalDate: message.internalDate,
          source: message.source
        });
      }

      const latestMessage = getLatestMessage(messages);

      if (!latestMessage) {
        continue;
      }

      for (const message of messages) {
        const labelKey = String(message.uid);

        if (labeledUids.has(labelKey)) {
          continue;
        }

        let shouldLabel = false;

        try {
          shouldLabel = await shouldLabelMessageForSettings(message, settings);
        } catch (error) {
          totals.errors += 1;
          console.error("Unable to inspect vendor inventory email for labeling.", {
            uid: message.uid,
            label: vendorInventoryLabel,
            error: error.message
          });
          continue;
        }

        if (!shouldLabel) {
          continue;
        }

        try {
          if (await applyVendorInventoryLabel(client, message.uid)) {
            labeledUids.add(labelKey);
            totals.labeled += 1;
          }
        } catch (error) {
          totals.errors += 1;
          console.error("Unable to label or archive vendor inventory email.", {
            uid: message.uid,
            label: vendorInventoryLabel,
            error: error.message
          });
        }
      }

      totals.messages += 1;
      const result = await processMessageForSettings(
        {
          uid: latestMessage.uid,
          source: latestMessage.source
        },
        settings
      );

      totals.attachments += result.attachments;
      totals.imported += result.imported;
      totals.skipped += result.skipped;
      totals.errors += result.errors;
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return totals;
}

module.exports = {
  runAutoInventoryImport
};
