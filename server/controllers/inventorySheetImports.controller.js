const sheetImportsService = require("../services/vendorAutoInventoryAudits.service");
const settingsService = require("../services/vendorAutoInventorySettings.service");
const gmailInventoryService = require("../services/gmailInventory.service");
const autoInventoryService = require("../services/autoInventory.service");
const productsService = require("../services/products.service");

async function listImports(req, res, next) {
  try {
    res.send(await sheetImportsService.listAudits(req.query));
  } catch (error) {
    next(error);
  }
}

async function getImport(req, res, next) {
  try {
    res.send(
      await sheetImportsService.getAuditDetails(req.params.importId, req.query)
    );
  } catch (error) {
    next(error);
  }
}

async function getImportPreview(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.getAuditRecord(
      req.params.importId
    );

    if (!sheetImport || sheetImport.isLegacy) {
      const error = new Error("A spreadsheet preview is not available for this import.");
      error.statusCode = 404;
      throw error;
    }

    if (sheetImport.previewRows.length > 0) {
      res.send({
        availableHeaders: sheetImport.availableHeaders,
        previewRows: sheetImport.previewRows
      });
      return;
    }

    const attachment = await gmailInventoryService.getInventorySheetAttachment(
      sheetImport.id
    );
    const preview = await autoInventoryService.getSheetPreview(
      attachment.content,
      attachment
    );
    await sheetImportsService.saveAuditPreview(
      sheetImport.id,
      preview.availableHeaders,
      preview.previewRows
    );
    res.send(preview);
  } catch (error) {
    next(error);
  }
}

async function getImportSheet(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.getAuditRecord(
      req.params.importId
    );

    if (!sheetImport || sheetImport.isLegacy) {
      const error = new Error("The original spreadsheet is not available.");
      error.statusCode = 404;
      throw error;
    }

    const attachment = await gmailInventoryService.getInventorySheetAttachment(
      sheetImport.id
    );
    res.send(
      await autoInventoryService.getSheetData(
        attachment.content,
        attachment,
        req.query
      )
    );
  } catch (error) {
    next(error);
  }
}

async function getImportFile(req, res, next) {
  try {
    const attachment = await gmailInventoryService.getInventorySheetAttachment(
      req.params.importId
    );
    const encodedFilename = encodeURIComponent(attachment.filename);

    res.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      "Content-Type": attachment.contentType,
      "X-Content-Type-Options": "nosniff"
    });
    res.send(attachment.content);
  } catch (error) {
    next(error);
  }
}

async function approveImport(req, res, next) {
  try {
    res.send(await approveAndQueueImport(req.params.importId, req.user));
  } catch (error) {
    next(error);
  }
}

async function approveAndQueueImport(importId, reviewer) {
  const sheetImport = await sheetImportsService.approveAudit(importId, reviewer);

  try {
    const wake = await gmailInventoryService.queueInventoryAuditApply(
      sheetImport.id
    );
    return { ...sheetImport, queued: !wake.skipped };
  } catch (error) {
    await sheetImportsService.setStatus(sheetImport.id, "ready_for_review", {
      errorCount: 1,
      errorMessage: `Unable to queue approved import: ${error.message}`
    });
    throw error;
  }
}

function canAutoApplyResolvedAudit(audit) {
  return Boolean(
    audit &&
    audit.status === "ready_for_review" &&
    Number(audit.missingSkuRows || 0) === 0 &&
    Number(audit.invalidRows || 0) === 0
  );
}

function shouldReparseResolvedAudit(audit) {
  return Boolean(
    audit &&
    audit.status === "ready_for_review" &&
    Number(audit.missingSkuRows || 0) === 0 &&
    Number(audit.invalidRows || 0) > 0
  );
}

async function rejectImport(req, res, next) {
  try {
    res.send(
      await sheetImportsService.rejectAudit(req.params.importId, req.user)
    );
  } catch (error) {
    next(error);
  }
}

async function retryImport(req, res, next) {
  try {
    res.send(await queueManualRetry(req.params.importId));
  } catch (error) {
    next(error);
  }
}

async function queueManualRetry(importId) {
  const sheetImport = await sheetImportsService.requestManualRetry(importId);
  const retryToken = `manual-${sheetImport.manualRetryCount}`;
  let wake;

  try {
    wake = await gmailInventoryService.queueGmailMessageRetry(
      {
        auditId: sheetImport.id,
        gmailMessageId: sheetImport.messageUid,
        rfcMessageId: sheetImport.messageId
      },
      retryToken
    );
  } catch (error) {
    await sheetImportsService.setStatus(sheetImport.id, "failed", {
      errorCount: 1,
      errorMessage: `Unable to queue retry: ${error.message}`
    });
    throw error;
  }

  return {
    ...sheetImport,
    queued: !wake.skipped,
    retryMode: "parse"
  };
}

async function addMissingSkuException(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.getAuditRecord(
      req.params.importId
    );
    const vendorProductId = String(req.body?.vendorProductId || "").trim();
    const productSku = String(req.body?.productSku || "").trim();

    if (!sheetImport || sheetImport.isLegacy) {
      const error = new Error("Inventory sheet import not found.");
      error.statusCode = 404;
      throw error;
    }

    if (!vendorProductId || !productSku) {
      const error = new Error("A missing product SKU is required.");
      error.statusCode = 400;
      throw error;
    }

    await productsService.setProductVendorMissingSheetException({
      sku: productSku,
      vendorId: sheetImport.vendorId,
      vendorProductId
    });
    const missingSku = await sheetImportsService.resolveMissingSku(
      sheetImport.id,
      vendorProductId
    );
    const resolvedAudit = await sheetImportsService.getAuditRecord(
      sheetImport.id
    );

    if (canAutoApplyResolvedAudit(resolvedAudit)) {
      const approvedImport = await approveAndQueueImport(
        sheetImport.id,
        req.user
      );

      res.send({
        audit: approvedImport,
        autoApply: true,
        missingSku,
        queued: approvedImport.queued
      });
      return;
    }

    res.send({
      audit: resolvedAudit,
      autoApply: false,
      missingSku,
      queued: false
    });
  } catch (error) {
    next(error);
  }
}

async function addAllMissingSkuExceptions(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.getAuditRecord(
      req.params.importId
    );

    if (!sheetImport || sheetImport.isLegacy) {
      const error = new Error("Inventory sheet import not found.");
      error.statusCode = 404;
      throw error;
    }

    const missingSkus = await sheetImportsService.getUnresolvedMissingSkus(
      sheetImport.id
    );

    if (missingSkus.length === 0) {
      const error = new Error("There are no unresolved missing SKUs to approve.");
      error.statusCode = 409;
      throw error;
    }

    await productsService.setProductVendorMissingSheetExceptions({
      vendorId: sheetImport.vendorId,
      missingSkus
    });
    const resolvedMissingSkus = await sheetImportsService.resolveAllMissingSkus(
      sheetImport.id
    );
    const resolvedAudit = await sheetImportsService.getAuditRecord(sheetImport.id);

    if (canAutoApplyResolvedAudit(resolvedAudit)) {
      const approvedImport = await approveAndQueueImport(
        sheetImport.id,
        req.user
      );

      res.send({
        audit: approvedImport,
        autoApply: true,
        resolvedCount: resolvedMissingSkus.length,
        queued: approvedImport.queued
      });
      return;
    }

    if (shouldReparseResolvedAudit(resolvedAudit)) {
      const retryingImport = await queueManualRetry(sheetImport.id);

      res.send({
        audit: retryingImport,
        autoApply: false,
        reparsing: true,
        resolvedCount: resolvedMissingSkus.length,
        queued: retryingImport.queued
      });
      return;
    }

    res.send({
      audit: resolvedAudit,
      autoApply: false,
      reparsing: false,
      resolvedCount: resolvedMissingSkus.length,
      queued: false
    });
  } catch (error) {
    next(error);
  }
}

async function updateMapping(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.getAuditRecord(
      req.params.importId
    );

    if (!sheetImport) {
      const error = new Error("Inventory sheet import not found.");
      error.statusCode = 404;
      throw error;
    }

    if (
      sheetImport.isLegacy ||
      !["ready_for_review", "needs_mapping", "failed"].includes(sheetImport.status)
    ) {
      const error = new Error("This inventory sheet mapping cannot be changed.");
      error.statusCode = 409;
      throw error;
    }

    const availableHeaders = new Set(sheetImport.availableHeaders || []);
    const skuHeader = String(req.body?.skuHeader || "").trim();
    const inventoryHeader = String(req.body?.inventoryHeader || "").trim();
    const subtractiveColumn = String(req.body?.subtractiveColumn || "").trim();

    if (!availableHeaders.has(skuHeader) || !availableHeaders.has(inventoryHeader)) {
      const error = new Error("Choose SKU and stock-value columns from this sheet.");
      error.statusCode = 400;
      throw error;
    }

    if (
      skuHeader === inventoryHeader ||
      (subtractiveColumn &&
        (subtractiveColumn === skuHeader || subtractiveColumn === inventoryHeader))
    ) {
      const error = new Error("Choose a different sheet column for each field.");
      error.statusCode = 400;
      throw error;
    }

    if (subtractiveColumn && !availableHeaders.has(subtractiveColumn)) {
      const error = new Error("Choose a quantity-to-subtract column from this sheet.");
      error.statusCode = 400;
      throw error;
    }

    const mapping = {
      skuHeader,
      inventoryHeader,
      subtractiveColumn
    };
    const saveToVendor = req.body?.saveToVendor === true;

    if (saveToVendor) {
      const currentSettings = await settingsService.getSettings(
        sheetImport.vendorId
      );
      await settingsService.saveSettings(sheetImport.vendorId, {
        ...currentSettings,
        ...mapping
      });
    }

    const updatedImport = await sheetImportsService.updateAuditMapping(
      sheetImport.id,
      mapping
    );

    try {
      const wake = await gmailInventoryService.queueGmailMessageRetry(
        {
          auditId: updatedImport.id,
          gmailMessageId: updatedImport.messageUid,
          rfcMessageId: updatedImport.messageId
        },
        `mapping-${Date.now()}`
      );

      res.send({
        ...updatedImport,
        mappingSavedToVendor: saveToVendor,
        queued: !wake.skipped,
        retryMode: "parse"
      });
    } catch (error) {
      await sheetImportsService.setStatus(updatedImport.id, "failed", {
        errorCount: 1,
        errorMessage: `Unable to queue mapped sheet: ${error.message}`
      });
      throw error;
    }
  } catch (error) {
    next(error);
  }
}

async function updateRowSelection(req, res, next) {
  try {
    if (typeof req.body?.selected !== "boolean") {
      const error = new Error("Choose whether to include or remove this SKU.");
      error.statusCode = 400;
      throw error;
    }

    res.send(
      await sheetImportsService.updateProposalSelection(
        req.params.importId,
        req.params.rowNumber,
        req.body.selected
      )
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  approveImport,
  getImportFile,
  getImportSheet,
  getImportPreview,
  getImport,
  listImports,
  rejectImport,
  retryImport,
  addAllMissingSkuExceptions,
  addMissingSkuException,
  updateMapping,
  updateRowSelection,
  _test: {
    canAutoApplyResolvedAudit,
    shouldReparseResolvedAudit
  }
};
