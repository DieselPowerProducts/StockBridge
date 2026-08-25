const crypto = require("crypto");
const { Readable } = require("stream");
const csv = require("csv-parser");
const ExcelJS = require("exceljs");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const catalogService = require("./catalog.service");
const notificationsService = require("./notifications.service");
const productsService = require("./products.service");
const productUpdatesService = require("./vendorAutoInventoryProductUpdates.service");
const settingsService = require("./vendorAutoInventorySettings.service");
const auditsService = require("./vendorAutoInventoryAudits.service");
const importsService = require("./vendorAutoInventoryImports.service");
const {
  addSkuMatchKeys,
  buildSkuExceptionKeys,
  getSkuMatchKeys,
  getVendorProductSkuValues,
  isVendorProductExcepted,
  normalizeSkuKey
} = require("./autoInventorySkuMatcher");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const defaultLookbackDays = 14;
const autoInventoryFailureRecipient =
  process.env.AUTO_INVENTORY_FAILURE_RECIPIENT || "cade@dieselpowerproducts.com";
const vendorInventoryLabel =
  process.env.AUTO_INVENTORY_GMAIL_LABEL || "Vendor Inventory";
const gmailInboxLabels = ["\\Inbox", "INBOX"];
const syncTimezone = process.env.CATALOG_SYNC_TIMEZONE || "America/Los_Angeles";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function getVendorProductDisplaySku(vendorProduct) {
  return (
    normalizeText(vendorProduct?.product_sku) ||
    normalizeText(vendorProduct?.sku) ||
    normalizeText(vendorProduct?.label) ||
    normalizeText(vendorProduct?.id)
  );
}

function buildVendorProductSkuLookup(vendorProducts) {
  const lookup = new Map();

  for (const vendorProduct of vendorProducts) {
    for (const value of getVendorProductSkuValues(vendorProduct)) {
      for (const key of getSkuMatchKeys(value)) {
        const current = lookup.get(key) || [];

        if (!current.some((item) => item.id === vendorProduct.id)) {
          current.push(vendorProduct);
        }

        lookup.set(key, current);
      }
    }
  }

  return lookup;
}

function findVendorProductForSheetSku(lookup, sku) {
  const keys = getSkuMatchKeys(sku);
  const exactKey = normalizeSkuKey(sku);

  for (const key of keys) {
    const candidates = lookup.get(key) || [];

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      const exactCandidates = candidates.filter((candidate) =>
        getVendorProductSkuValues(candidate).some(
          (value) => normalizeSkuKey(value) === exactKey
        )
      );

      if (exactCandidates.length === 1) {
        return exactCandidates[0];
      }
    }
  }

  return null;
}

function isVendorProductRepresentedInSheet(vendorProduct, sheetSkuKeys) {
  return getVendorProductSkuValues(vendorProduct).some((value) =>
    getSkuMatchKeys(value).some((key) => sheetSkuKeys.has(key))
  );
}

function formatMissingVendorProducts(vendorProducts) {
  const sample = vendorProducts
    .slice(0, 25)
    .map(getVendorProductDisplaySku)
    .filter(Boolean);
  const remainder = vendorProducts.length - sample.length;

  return [
    `StockBridge vendor products missing from inventory sheet (${vendorProducts.length}):`,
    sample.join(", "),
    remainder > 0 ? `and ${remainder} more.` : ""
  ]
    .filter(Boolean)
    .join(" ");
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

function getLocalDateText(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: syncTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
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
  const filename = normalizeText(attachment?.filename) || "sheet attachment";
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

function getAttachmentExtension(attachment) {
  const filename = normalizeText(attachment?.filename).toLowerCase();

  return filename.includes(".") ? filename.split(".").pop() : "";
}

function isCsvAttachment(attachment) {
  const extension = getAttachmentExtension(attachment);
  const contentType = normalizeText(attachment?.contentType).toLowerCase();

  return (
    extension === "csv" ||
    contentType.includes("csv")
  );
}

function isExcelAttachment(attachment) {
  const extension = getAttachmentExtension(attachment);
  const contentType = normalizeText(attachment?.contentType).toLowerCase();

  return (
    ["xlsx", "xlsm", "xltx", "xltm"].includes(extension) ||
    contentType.includes("spreadsheetml") ||
    contentType.includes("officedocument.spreadsheetml")
  );
}

function isInventorySheetAttachment(attachment) {
  const extension = getAttachmentExtension(attachment);
  const contentType = normalizeText(attachment?.contentType).toLowerCase();

  return (
    isCsvAttachment(attachment) ||
    isExcelAttachment(attachment) ||
    ["xls", "ods"].includes(extension) ||
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

function parseNumericalCount(value, { blankAsZero = false } = {}) {
  const normalized = normalizeText(value).replace(/,/g, "");

  if (!normalized && blankAsZero) {
    return 0;
  }

  const match = normalized.match(/-?\d+(\.\d+)?/);

  if (!match) {
    return null;
  }

  return Number(match[0]);
}

function parseNumericalInventoryResult(
  value,
  subtractiveValue = "",
  hasSubtractiveColumn = false
) {
  const inventoryCount = parseNumericalCount(value);

  if (inventoryCount === null) {
    return null;
  }

  const subtractiveCount = hasSubtractiveColumn
    ? parseNumericalCount(subtractiveValue, { blankAsZero: true })
    : 0;

  if (subtractiveCount === null) {
    return null;
  }

  const sheetQuantity = inventoryCount - subtractiveCount;

  return {
    quantity:
      sheetQuantity > 0
        ? enabledVendorStockQuantity
        : disabledVendorStockQuantity,
    sheetQuantity: Math.max(sheetQuantity, 0)
  };
}

function parseNumericalQuantity(value, subtractiveValue = "", hasSubtractiveColumn = false) {
  const result = parseNumericalInventoryResult(
    value,
    subtractiveValue,
    hasSubtractiveColumn
  );

  return result ? result.quantity : null;
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

function parseInventoryResult(value, settings, subtractiveValue = "") {
  const hasSubtractiveColumn = Boolean(
    settings.inventoryMode !== "alphabetical" && settings.subtractiveColumn
  );

  if (settings.inventoryMode === "alphabetical") {
    const quantity = parseAlphabeticalQuantity(value, settings);

    return quantity === null
      ? null
      : {
          quantity,
          sheetQuantity: null
        };
  }

  return parseNumericalInventoryResult(
    value,
    subtractiveValue,
    hasSubtractiveColumn
  );
}

function getTrackedSheetQuantity(inventoryResult, inventoryMode) {
  if (!inventoryResult) {
    return null;
  }

  if (inventoryMode === "alphabetical") {
    return Number(inventoryResult.quantity || 0) > 0
      ? enabledVendorStockQuantity
      : disabledVendorStockQuantity;
  }

  return inventoryResult.sheetQuantity === null ||
    inventoryResult.sheetQuantity === undefined
    ? null
    : Number(inventoryResult.sheetQuantity);
}

function parseInventoryQuantity(value, settings, subtractiveValue = "") {
  const result = parseInventoryResult(value, settings, subtractiveValue);

  return result ? result.quantity : null;
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

function getExcelCellText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((item) => item?.text || "")
        .join("")
        .trim();
    }

    if (value.result !== undefined) {
      return getExcelCellText(value.result);
    }

    if (value.text !== undefined) {
      return getExcelCellText(value.text);
    }

    if (value.hyperlink && value.text) {
      return getExcelCellText(value.text);
    }
  }

  return normalizeText(value);
}

function getExcelRowValues(row) {
  const values = [];

  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    values[columnNumber - 1] = getExcelCellText(cell.value);
  });

  return values.map((value) => normalizeText(value));
}

async function parseExcelRows(content) {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(content);

  const worksheet =
    workbook.worksheets.find((sheet) => Number(sheet.actualRowCount || 0) > 0) ||
    workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  let headers = null;
  const rows = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = getExcelRowValues(row);
    const hasValues = values.some(Boolean);

    if (!hasValues) {
      return;
    }

    if (!headers) {
      headers = values;
      return;
    }

    const item = {};

    headers.forEach((header, index) => {
      if (header) {
        item[header] = values[index] || "";
      }
    });

    if (Object.keys(item).length > 0) {
      rows.push(item);
    }
  });

  return rows;
}

async function parseSheetRows(content, attachment) {
  if (isCsvAttachment(attachment)) {
    return parseCsvRows(content);
  }

  if (isExcelAttachment(attachment)) {
    return parseExcelRows(content);
  }

  const extension = getAttachmentExtension(attachment);
  const error = new Error(
    extension
      ? `Unsupported inventory sheet file type: .${extension}`
      : "Unsupported inventory sheet file type."
  );

  error.statusCode = 415;
  throw error;
}

function getAuditMapping(settings) {
  return {
    skuHeader: normalizeText(settings?.skuHeader),
    inventoryHeader: normalizeText(settings?.inventoryHeader),
    subtractiveColumn: normalizeText(settings?.subtractiveColumn),
    inventoryMode: normalizeText(settings?.inventoryMode) || "numerical",
    inStockPhrases: Array.isArray(settings?.inStockPhrases)
      ? settings.inStockPhrases
      : [],
    outOfStockPhrases: Array.isArray(settings?.outOfStockPhrases)
      ? settings.outOfStockPhrases
      : []
  };
}

async function stageSheetAttachment({ settings, attachment, message }) {
  const content = attachment.content || Buffer.alloc(0);
  const attachmentHash = getAttachmentHash(content);
  const existing = await auditsService.getAuditByAttachment(
    settings.vendorId,
    attachmentHash
  );

  if (
    existing &&
    [
      "applied",
      "rejected",
      "ready_for_review",
      "approved",
      "applying"
    ].includes(existing.status)
  ) {
    return {
      auditId: existing.id,
      duplicate: true,
      errors: 0,
      staged: 0,
      skipped: 0
    };
  }

  const baseAudit = {
    vendorId: settings.vendorId,
    messageUid: message.uid,
    messageId: message.messageId,
    senderEmail: settings.senderEmail,
    subject: message.subject,
    attachmentFilename: attachment.filename,
    attachmentHash,
    mapping: getAuditMapping(settings)
  };
  let rows;

  try {
    rows = await parseSheetRows(content, attachment);
  } catch (error) {
    const audit = await auditsService.stageAudit({
      ...baseAudit,
      status: "failed",
      errorCount: 1,
      errorMessage: `Inventory sheet could not be parsed: ${error.message}`
    });

    return {
      auditId: audit.id,
      duplicate: false,
      errors: 1,
      staged: 0,
      skipped: 0
    };
  }

  if (rows.length === 0) {
    const audit = await auditsService.stageAudit({
      ...baseAudit,
      status: "failed",
      errorCount: 1,
      errorMessage: "Inventory sheet did not contain any rows."
    });

    return {
      auditId: audit.id,
      duplicate: false,
      errors: 1,
      staged: 0,
      skipped: 0
    };
  }

  const firstRow = rows[0] || {};
  const availableHeaders = Object.keys(firstRow)
    .map((header) => header.replace(/^\uFEFF/, ""))
    .filter(Boolean);
  const missingHeaders = [
    !hasHeader(firstRow, settings.skuHeader) ? settings.skuHeader : "",
    !hasHeader(firstRow, settings.inventoryHeader) ? settings.inventoryHeader : "",
    settings.inventoryMode !== "alphabetical" &&
    settings.subtractiveColumn &&
    !hasHeader(firstRow, settings.subtractiveColumn)
      ? settings.subtractiveColumn
      : ""
  ].filter(Boolean);

  if (missingHeaders.length > 0) {
    const audit = await auditsService.stageAudit({
      ...baseAudit,
      status: "needs_mapping",
      availableHeaders,
      totalRows: rows.length,
      invalidRows: rows.length,
      errorCount: 1,
      errorMessage: `Missing configured header(s): ${missingHeaders.join(", ")}`
    });

    return {
      auditId: audit.id,
      duplicate: false,
      errors: 1,
      staged: 0,
      skipped: rows.length
    };
  }

  const vendorProducts =
    await catalogService.getActiveCatalogVendorProductsByVendorId(
      settings.vendorId
    );
  const vendorProductLookup = buildVendorProductSkuLookup(vendorProducts);
  const skuExceptionKeys = buildSkuExceptionKeys(settings.skuExceptions);
  const proposalRows = [];
  const invalidSamples = [];
  let unmatchedRows = 0;
  let invalidRows = 0;
  let exceptionRows = 0;

  rows.forEach((row, index) => {
    const sheetSku = findHeaderValue(row, settings.skuHeader);
    const inventoryValue = findHeaderValue(row, settings.inventoryHeader);
    const subtractiveValue =
      settings.inventoryMode !== "alphabetical" && settings.subtractiveColumn
        ? findHeaderValue(row, settings.subtractiveColumn)
        : "";

    if (!sheetSku) {
      invalidRows += 1;
      if (invalidSamples.length < 5) invalidSamples.push(`Row ${index + 2}: missing SKU`);
      return;
    }

    const vendorProduct = findVendorProductForSheetSku(
      vendorProductLookup,
      sheetSku
    );

    if (!vendorProduct) {
      unmatchedRows += 1;
      return;
    }

    if (isVendorProductExcepted(vendorProduct, skuExceptionKeys, [sheetSku])) {
      exceptionRows += 1;
      return;
    }

    const inventoryResult = parseInventoryResult(
      inventoryValue,
      settings,
      subtractiveValue
    );

    if (!inventoryResult) {
      invalidRows += 1;
      if (invalidSamples.length < 5) {
        invalidSamples.push(
          `Row ${index + 2} (${sheetSku}): ${inventoryValue || "blank"}`
        );
      }
      return;
    }

    const currentQuantity = Number(vendorProduct.quantity || 0);
    const proposedQuantity = Number(inventoryResult.quantity || 0);
    proposalRows.push({
      rowNumber: index + 2,
      vendorProductId: vendorProduct.id,
      productId: vendorProduct.product_id || "",
      productSku: getVendorProductDisplaySku(vendorProduct),
      vendorSku: vendorProduct.sku || vendorProduct.label || sheetSku,
      sheetSku,
      inventoryValue,
      subtractiveValue,
      currentQuantity,
      proposedQuantity,
      sheetQuantity: getTrackedSheetQuantity(
        inventoryResult,
        settings.inventoryMode
      ),
      changeRequired:
        (currentQuantity > 0) !== (proposedQuantity > 0),
      status: "matched",
      errorMessage: ""
    });
  });

  const changedRows = proposalRows.filter((row) => row.changeRequired).length;
  const hasUsableRows = proposalRows.length > 0;
  const errorMessage = invalidSamples.length > 0
    ? `Some rows need attention: ${invalidSamples.join("; ")}`
    : "";
  const audit = await auditsService.stageAudit(
    {
      ...baseAudit,
      status: hasUsableRows ? "ready_for_review" : "failed",
      availableHeaders,
      totalRows: rows.length,
      matchedRows: proposalRows.length,
      changedRows,
      unmatchedRows,
      invalidRows,
      exceptionRows,
      errorCount: hasUsableRows ? 0 : 1,
      errorMessage:
        errorMessage ||
        (hasUsableRows
          ? ""
          : "No configured vendor products could be staged from this sheet.")
    },
    proposalRows
  );

  return {
    auditId: audit.id,
    duplicate: false,
    errors: hasUsableRows ? 0 : 1,
    staged: changedRows,
    skipped: unmatchedRows + invalidRows + exceptionRows
  };
}

async function importSheetAttachment({ settings, attachment, message }) {
  const content = attachment.content || Buffer.alloc(0);
  const attachmentHash = getAttachmentHash(content);
  const stockRemovedDate = getLocalDateText();

  if (await importsService.hasProcessedAttachment(settings.vendorId, attachmentHash)) {
    await importsService.touchProcessedAttachment({
      vendorId: settings.vendorId,
      messageUid: message.uid,
      messageId: message.messageId,
      senderEmail: settings.senderEmail,
      attachmentFilename: attachment.filename,
      attachmentHash
    });

    return {
      imported: 0,
      staged: 0,
      skipped: 0,
      errors: 0,
      duplicate: true,
      followUpsSet: 0
    };
  }

  let rows;

  try {
    rows = await parseSheetRows(content, attachment);
  } catch (error) {
    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "Inventory sheet could not be parsed",
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
      staged: 0,
      skipped: 0,
      errors: 1,
      duplicate: false,
      followUpsSet: 0
    };
  }

  if (rows.length === 0) {
    await notifyAutoInventoryFailure({
      settings,
      attachment,
      attachmentHash,
      reason: "Inventory sheet did not contain any rows"
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
      errorMessage: "Inventory sheet did not contain any rows."
    });

    return {
      imported: 0,
      skipped: 0,
      errors: 1,
      duplicate: false,
      followUpsSet: 0
    };
  }

  const firstRow = rows[0] || {};
  const missingHeaders = [
    !hasHeader(firstRow, settings.skuHeader) ? settings.skuHeader : "",
    !hasHeader(firstRow, settings.inventoryHeader) ? settings.inventoryHeader : "",
    settings.inventoryMode !== "alphabetical" &&
    settings.subtractiveColumn &&
    !hasHeader(firstRow, settings.subtractiveColumn)
      ? settings.subtractiveColumn
      : ""
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
      reason: "Configured inventory sheet header was not found",
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
      duplicate: false,
      followUpsSet: 0
    };
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let followUpsSet = 0;
  const missingSkuSamples = [];
  const unmatchedInventorySamples = [];
  const updateErrorSamples = [];
  const followUpErrorSamples = [];
  const sheetSkuKeys = new Set();
  const vendorProducts =
    await catalogService.getActiveCatalogVendorProductsByVendorId(
      settings.vendorId
    );
  const vendorProductLookup = buildVendorProductSkuLookup(vendorProducts);
  const skuExceptionKeys = buildSkuExceptionKeys(settings.skuExceptions);
  const sheetManagedProductUpdates = new Map();

  for (const row of rows) {
    const sku = findHeaderValue(row, settings.skuHeader);
    const inventoryValue = findHeaderValue(row, settings.inventoryHeader);
    const subtractiveValue =
      settings.inventoryMode !== "alphabetical" && settings.subtractiveColumn
        ? findHeaderValue(row, settings.subtractiveColumn)
        : "";

    if (sku) {
      addSkuMatchKeys(sheetSkuKeys, sku);
    }

    if (!sku) {
      skipped += 1;

      if (missingSkuSamples.length < 5) {
        missingSkuSamples.push(JSON.stringify(row).slice(0, 180));
      }

      continue;
    }

    const vendorProduct = findVendorProductForSheetSku(vendorProductLookup, sku);

    if (!vendorProduct) {
      skipped += 1;
      continue;
    }

    if (isVendorProductExcepted(vendorProduct, skuExceptionKeys, [sku])) {
      skipped += 1;
      continue;
    }

    const inventoryResult = parseInventoryResult(
      inventoryValue,
      settings,
      subtractiveValue
    );

    if (!inventoryResult) {
      skipped += 1;

      if (unmatchedInventorySamples.length < 5) {
        unmatchedInventorySamples.push(
          settings.inventoryMode !== "alphabetical" && settings.subtractiveColumn
            ? `${sku} => ${settings.inventoryHeader}: ${inventoryValue || "blank"}, ${settings.subtractiveColumn}: ${subtractiveValue || "blank"}`
            : `${sku} => ${inventoryValue || "blank"}`
        );
      }

      continue;
    }

    const quantity = inventoryResult.quantity;
    const trackedSheetQuantity = getTrackedSheetQuantity(
      inventoryResult,
      settings.inventoryMode
    );
    const sheetManagedProductUpdate =
      trackedSheetQuantity !== null
        ? {
            vendorId: settings.vendorId,
            vendorProductId: vendorProduct.id,
            productId: vendorProduct.product_id || "",
            sku: getVendorProductDisplaySku(vendorProduct),
            sheetSku: sku,
            quantity: trackedSheetQuantity,
            inventoryValue,
            subtractiveValue,
            attachmentFilename: attachment.filename,
            messageId: message.messageId
          }
        : null;

    try {
      const currentIsAvailable = Number(vendorProduct.quantity || 0) > 0;
      const nextIsAvailable = quantity > 0;
      const stockWasRemoved = currentIsAvailable && !nextIsAvailable;

      if (currentIsAvailable === nextIsAvailable) {
        if (sheetManagedProductUpdate) {
          sheetManagedProductUpdates.set(
            vendorProduct.id,
            sheetManagedProductUpdate
          );
        }

        skipped += 1;
        continue;
      }

      const updateResult = await productsService.setVendorProductQuantity({
        vendorId: settings.vendorId,
        vendorProductId: vendorProduct.id,
        quantity,
        vendorProduct
      });
      vendorProduct.quantity = quantity;

      if (sheetManagedProductUpdate) {
        sheetManagedProductUpdates.set(
          vendorProduct.id,
          sheetManagedProductUpdate
        );
      }

      if (stockWasRemoved) {
        try {
          const followUpResult = await setBackorderFollowUpForStockRemoval({
            followUpDate: stockRemovedDate,
            sku:
              updateResult.sku ||
              vendorProduct.product_sku ||
              getVendorProductDisplaySku(vendorProduct)
          });

          if (followUpResult.followUpSet) {
            followUpsSet += 1;
          }
        } catch (error) {
          errors += 1;
          if (followUpErrorSamples.length < 5) {
            followUpErrorSamples.push(`${sku}: ${error.message}`);
          }
          console.error("Auto inventory follow-up update failed.", {
            vendorId: settings.vendorId,
            sku,
            error: error.message
          });
        }
      }

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

  await productUpdatesService.replaceVendorProductUpdatesForVendor({
    vendorId: settings.vendorId,
    updates: Array.from(sheetManagedProductUpdates.values())
  });

  const failureDetails = [];

  if (missingSkuSamples.length > 0) {
    failureDetails.push(`Rows missing SKU: ${missingSkuSamples.join(" | ")}`);
  }

  if (unmatchedInventorySamples.length > 0) {
    const modeDetails =
      settings.inventoryMode === "alphabetical"
        ? `Expected in-stock phrases: ${settings.inStockPhrases.join(" : ") || "none"}; out-of-stock phrases: ${settings.outOfStockPhrases.join(" : ") || "none"}.`
        : settings.subtractiveColumn
          ? `Expected numerical values for ${settings.inventoryHeader} and ${settings.subtractiveColumn}.`
          : "Expected a numerical inventory value.";

    failureDetails.push(
      `Unrecognized inventory values: ${unmatchedInventorySamples.join(" | ")}. ${modeDetails}`
    );
  }

  if (updateErrorSamples.length > 0) {
    failureDetails.push(`SKU Nexus update errors: ${updateErrorSamples.join(" | ")}`);
  }

  if (followUpErrorSamples.length > 0) {
    failureDetails.push(
      `Backorder follow-up update errors: ${followUpErrorSamples.join(" | ")}`
    );
  }

  const missingVendorProducts = vendorProducts.filter(
    (vendorProduct) =>
      !isVendorProductExcepted(vendorProduct, skuExceptionKeys) &&
      !isVendorProductRepresentedInSheet(vendorProduct, sheetSkuKeys)
  );

  if (missingVendorProducts.length > 0) {
    failureDetails.push(formatMissingVendorProducts(missingVendorProducts));
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
    duplicate: false,
    followUpsSet
  };
}

async function setBackorderFollowUpForStockRemoval({ sku, followUpDate }) {
  const safeSku = normalizeText(sku);

  if (!safeSku) {
    return {
      followUpSet: false,
      reason: "missing_sku"
    };
  }

  const details = await catalogService.getProductDetails(safeSku);

  if (details.availability !== "Backorder") {
    return {
      availability: details.availability,
      followUpSet: false,
      reason: "not_backordered",
      sku: safeSku
    };
  }

  const result = await productsService.setProductFollowUp({
    sku: details.sku || safeSku,
    followUpDate,
    followUpNoEta: false
  });

  return {
    followUpDate: result.followUpDate,
    followUpSet: true,
    sku: result.sku || details.sku || safeSku
  };
}

async function applyStagedInventoryAudit(auditId) {
  const audit = await auditsService.getAuditRecord(auditId);

  if (!audit) {
    const error = new Error("Inventory sheet audit not found.");
    error.statusCode = 404;
    throw error;
  }

  if (audit.status === "applied") {
    return {
      applied: audit.appliedCount,
      auditId: audit.id,
      duplicate: true,
      errors: audit.errorCount,
      skipped: audit.skippedCount,
      status: audit.status
    };
  }

  if (!["approved", "applying"].includes(audit.status)) {
    const error = new Error("This inventory sheet has not been approved.");
    error.statusCode = 409;
    throw error;
  }

  await auditsService.setStatus(audit.id, "applying", {
    errorCount: 0,
    errorMessage: ""
  });
  const [proposalRows, vendorProducts] = await Promise.all([
    auditsService.getProposalRows(audit.id),
    catalogService.getActiveCatalogVendorProductsByVendorId(audit.vendorId)
  ]);
  const vendorProductsById = new Map(
    vendorProducts.map((vendorProduct) => [String(vendorProduct.id), vendorProduct])
  );
  const mapping = audit.mapping || {};
  const stockRemovedDate = getLocalDateText();
  const sheetManagedProductUpdates = new Map();
  const updateErrors = [];
  let applied = audit.appliedCount;
  let skipped = 0;
  let followUpsSet = 0;

  for (const proposal of proposalRows) {
    const vendorProduct = vendorProductsById.get(proposal.vendorProductId);

    if (!vendorProduct) {
      skipped += 1;
      updateErrors.push(`${proposal.productSku || proposal.sheetSku}: vendor product is no longer active`);
      continue;
    }

    const trackedQuantity =
      proposal.sheetQuantity === null
        ? proposal.proposedQuantity
        : proposal.sheetQuantity;
    const sheetManagedProductUpdate = {
      vendorId: audit.vendorId,
      vendorProductId: proposal.vendorProductId,
      productId: proposal.productId || vendorProduct.product_id || "",
      sku: proposal.productSku || getVendorProductDisplaySku(vendorProduct),
      sheetSku: proposal.sheetSku,
      quantity: trackedQuantity,
      inventoryValue: proposal.inventoryValue,
      subtractiveValue: proposal.subtractiveValue,
      attachmentFilename: audit.attachmentFilename,
      messageId: audit.messageId
    };

    const currentIsAvailable = Number(vendorProduct.quantity || 0) > 0;
    const nextIsAvailable = Number(proposal.proposedQuantity || 0) > 0;
    const stockWasRemoved =
      !nextIsAvailable &&
      (currentIsAvailable || Number(proposal.currentQuantity || 0) > 0);
    let inventoryApplied = false;

    if (currentIsAvailable === nextIsAvailable) {
      sheetManagedProductUpdates.set(
        proposal.vendorProductId,
        sheetManagedProductUpdate
      );
      skipped += 1;
      inventoryApplied = true;
    } else {
      try {
        await productsService.setVendorProductQuantity({
          vendorId: audit.vendorId,
          vendorProductId: proposal.vendorProductId,
          quantity: proposal.proposedQuantity,
          vendorProduct
        });
        vendorProduct.quantity = proposal.proposedQuantity;
        sheetManagedProductUpdates.set(
          proposal.vendorProductId,
          sheetManagedProductUpdate
        );
        applied += 1;
        inventoryApplied = true;
      } catch (error) {
        updateErrors.push(
          `${proposal.productSku || proposal.sheetSku}: ${error.message}`
        );
      }
    }

    if (inventoryApplied && stockWasRemoved) {
      try {
        const followUpResult = await setBackorderFollowUpForStockRemoval({
          followUpDate: stockRemovedDate,
          sku:
            proposal.productSku || getVendorProductDisplaySku(vendorProduct)
        });

        if (followUpResult.followUpSet) followUpsSet += 1;
      } catch (error) {
        updateErrors.push(
          `${proposal.productSku || proposal.sheetSku} follow-up: ${error.message}`
        );
      }
    }
  }

  await productUpdatesService.replaceVendorProductUpdatesForVendor({
    vendorId: audit.vendorId,
    updates: Array.from(sheetManagedProductUpdates.values())
  });

  const errorMessage = updateErrors.slice(0, 20).join(" | ");
  const status = updateErrors.length > 0 ? "failed" : "applied";
  await importsService.recordImport({
    vendorId: audit.vendorId,
    messageUid: audit.messageUid,
    messageId: audit.messageId,
    senderEmail: audit.senderEmail,
    attachmentFilename: audit.attachmentFilename,
    attachmentHash: audit.attachmentHash,
    importedCount: applied,
    skippedCount: skipped,
    errorCount: updateErrors.length,
    status: updateErrors.length > 0 ? "completed_with_errors" : "completed",
    errorMessage
  });
  await auditsService.setStatus(audit.id, status, {
    appliedCount: applied,
    skippedCount: skipped,
    errorCount: updateErrors.length,
    errorMessage
  });

  return {
    applied,
    auditId: audit.id,
    errors: updateErrors.length,
    followUpsSet,
    inventoryMode: mapping.inventoryMode || "numerical",
    skipped,
    status
  };
}

async function processParsedMessageForSettings({ uid, parsed }, settings) {
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

  const sheetAttachments = (parsed.attachments || []).filter(
    isInventorySheetAttachment
  );
  const totals = {
    imported: 0,
    staged: 0,
    skipped: 0,
    errors: 0,
    attachments: 0,
    followUpsSet: 0,
    shouldLabel: sheetAttachments.length > 0
  };

  for (const attachment of sheetAttachments) {
    const result = await stageSheetAttachment({
      settings,
      attachment,
      message: {
        uid: String(uid),
        messageId: normalizeText(parsed.messageId),
        subject: normalizeText(parsed.subject)
      }
    });

    totals.attachments += result.duplicate ? 0 : 1;
    totals.staged += result.staged || 0;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
    totals.followUpsSet += result.followUpsSet || 0;
  }

  return totals;
}

async function processMessageForSettings({ uid, source }, settings) {
  const parsed = await simpleParser(source);

  return processParsedMessageForSettings({ uid, parsed }, settings);
}

async function processInventoryMessageSource({ messageUid, source }) {
  const settingsList = await settingsService.getEnabledSettings();
  const parsed = await simpleParser(source);
  const totals = {
    imported: 0,
    staged: 0,
    skipped: 0,
    errors: 0,
    attachments: 0,
    followUpsSet: 0,
    shouldLabel: false
  };

  for (const settings of settingsList) {
    const result = await processParsedMessageForSettings(
      {
        uid: messageUid,
        parsed
      },
      settings
    );

    totals.imported += result.imported;
    totals.staged += result.staged || 0;
    totals.skipped += result.skipped;
    totals.errors += result.errors;
    totals.attachments += result.attachments;
    totals.followUpsSet += result.followUpsSet || 0;
    totals.shouldLabel = totals.shouldLabel || result.shouldLabel;
  }

  return totals;
}

async function shouldLabelMessageForSettings({ source }, settings) {
  const parsed = await simpleParser(source);
  const senderEmails = getSenderEmails(parsed);

  if (!senderEmails.includes(settings.senderEmail)) {
    return false;
  }

  return (parsed.attachments || []).some(isInventorySheetAttachment);
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

  await archiveVendorInventoryEmail(client, uid);

  return true;
}

async function getArchiveMailboxPath(client) {
  const mailboxes = await client.list();
  const archiveMailbox = mailboxes.find(
    (mailbox) =>
      mailbox?.specialUse === "\\All" ||
      mailbox?.specialUse === "\\Archive"
  );

  return archiveMailbox?.path || "[Gmail]/All Mail";
}

async function archiveVendorInventoryEmail(client, uid) {
  const archiveMailboxPath = await getArchiveMailboxPath(client);

  try {
    const moved = await client.messageMove(String(uid), archiveMailboxPath, {
      uid: true
    });

    if (moved) {
      return true;
    }
  } catch (error) {
    console.warn("Unable to move vendor inventory email to archive mailbox.", {
      uid,
      archiveMailboxPath,
      error: error.message
    });
  }

  await client.messageFlagsRemove(String(uid), gmailInboxLabels, {
    uid: true,
    useLabels: true
  });

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
      staged: 0,
      skipped: 0,
      followUpsSet: 0,
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
    staged: 0,
    skipped: 0,
    followUpsSet: 0,
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
          { internalDate: true },
          { uid: true }
        );

        if (!message) {
          continue;
        }

        messages.push({
          uid,
          internalDate: message.internalDate
        });
      }

      const latestMessage = getLatestMessage(messages);

      if (!latestMessage) {
        continue;
      }

      console.log("Auto inventory vendor import started.", {
        vendorId: settings.vendorId,
        senderEmail: settings.senderEmail,
        inboxMessages: messages.length,
        latestUid: String(latestMessage.uid)
      });

      const latestMessageWithSource = await client.fetchOne(
        String(latestMessage.uid),
        { internalDate: true, source: true },
        { uid: true }
      );

      if (!latestMessageWithSource?.source) {
        console.warn("Auto inventory latest message had no source.", {
          vendorId: settings.vendorId,
          latestUid: String(latestMessage.uid)
        });
        continue;
      }

      totals.messages += 1;
      const result = await processMessageForSettings(
        {
          uid: latestMessage.uid,
          internalDate:
            latestMessageWithSource.internalDate || latestMessage.internalDate,
          source: latestMessageWithSource.source
        },
        settings
      );

      totals.attachments += result.attachments;
      totals.imported += result.imported;
      totals.staged += result.staged || 0;
      totals.skipped += result.skipped;
      totals.followUpsSet += result.followUpsSet || 0;
      totals.errors += result.errors;

      console.log("Auto inventory vendor import completed.", {
        vendorId: settings.vendorId,
        imported: result.imported,
        staged: result.staged || 0,
        skipped: result.skipped,
        errors: result.errors,
        attachments: result.attachments,
        followUpsSet: result.followUpsSet || 0
      });

      for (const message of messages) {
        const labelKey = String(message.uid);

        if (labeledUids.has(labelKey)) {
          continue;
        }

        const messageWithSource =
          labelKey === String(latestMessage.uid)
            ? latestMessageWithSource
            : await client.fetchOne(
                String(message.uid),
                { internalDate: true, source: true },
                { uid: true }
              );

        if (!messageWithSource?.source) {
          continue;
        }

        let shouldLabel = false;

        try {
          shouldLabel = await shouldLabelMessageForSettings(
            {
              uid: message.uid,
              internalDate: messageWithSource.internalDate || message.internalDate,
              source: messageWithSource.source
            },
            settings
          );
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
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return totals;
}

module.exports = {
  applyStagedInventoryAudit,
  processInventoryMessageSource,
  runAutoInventoryImport,
  _test: {
    getTrackedSheetQuantity,
    parseInventoryResult,
    stageSheetAttachment
  }
};
