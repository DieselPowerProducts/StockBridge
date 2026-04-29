const crypto = require("crypto");
const { Readable } = require("stream");
const csv = require("csv-parser");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const catalogService = require("./catalog.service");
const productsService = require("./products.service");
const settingsService = require("./vendorAutoInventorySettings.service");
const importsService = require("./vendorAutoInventoryImports.service");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const defaultLookbackDays = 14;

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

function findHeaderValue(row, headerName) {
  const wantedHeader = normalizeComparable(headerName);
  const key = Object.keys(row || {}).find(
    (item) => normalizeComparable(item.replace(/^\uFEFF/, "")) === wantedHeader
  );

  return key ? normalizeText(row[key]) : "";
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
    throw error;
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const sku = findHeaderValue(row, settings.skuHeader);
    const inventoryValue = findHeaderValue(row, settings.inventoryHeader);
    const quantity = parseInventoryQuantity(inventoryValue, settings);

    if (!sku || quantity === null) {
      skipped += 1;
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

      await productsService.setVendorProductQuantity({
        vendorId: settings.vendorId,
        vendorProductId: vendorProduct.id,
        quantity,
        vendorProduct
      });
      imported += 1;
    } catch (error) {
      errors += 1;
      console.error("Auto inventory row import failed.", {
        vendorId: settings.vendorId,
        sku,
        error: error.message
      });
    }
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
    status: errors > 0 ? "completed_with_errors" : "completed"
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
      attachments: 0
    };
  }

  const csvAttachments = (parsed.attachments || []).filter(isCsvAttachment);
  const totals = {
    imported: 0,
    skipped: 0,
    errors: 0,
    attachments: 0
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

async function runAutoInventoryImport() {
  const settingsList = await settingsService.getEnabledSettings();

  if (settingsList.length === 0) {
    return {
      ok: true,
      vendors: 0,
      messages: 0,
      attachments: 0,
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
    imported: 0,
    skipped: 0,
    errors: 0
  };

  await client.connect();
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });

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

      for (const uid of uids) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });

        if (!message?.source) {
          continue;
        }

        totals.messages += 1;
        const result = await processMessageForSettings(
          {
            uid,
            source: message.source
          },
          settings
        );

        totals.attachments += result.attachments;
        totals.imported += result.imported;
        totals.skipped += result.skipped;
        totals.errors += result.errors;
      }
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
