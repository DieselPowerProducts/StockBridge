const sheetImportsService = require("../services/vendorAutoInventoryAudits.service");
const settingsService = require("../services/vendorAutoInventorySettings.service");
const gmailInventoryService = require("../services/gmailInventory.service");

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

async function approveImport(req, res, next) {
  try {
    const sheetImport = await sheetImportsService.approveAudit(
      req.params.importId,
      req.user
    );

    try {
      const wake = await gmailInventoryService.queueInventoryAuditApply(
        sheetImport.id
      );
      res.send({ ...sheetImport, queued: !wake.skipped });
    } catch (error) {
      await sheetImportsService.setStatus(sheetImport.id, "ready_for_review", {
        errorCount: 1,
        errorMessage: `Unable to queue approved import: ${error.message}`
      });
      throw error;
    }
  } catch (error) {
    next(error);
  }
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
    res.send(await queueManualRetry(req.params.importId, req.user));
  } catch (error) {
    next(error);
  }
}

async function queueManualRetry(importId, reviewer) {
  const sheetImport = await sheetImportsService.requestManualRetry(importId);
  const proposalRows = await sheetImportsService.getProposalRows(sheetImport.id);
  const retryToken = `manual-${sheetImport.manualRetryCount}`;
  let wake;

  try {
    if (proposalRows.length > 0) {
      await sheetImportsService.setStatus(sheetImport.id, "approved", {
        errorCount: 0,
        errorMessage: "",
        reviewer,
        reviewed: true
      });
      wake = await gmailInventoryService.queueInventoryAuditApply(
        sheetImport.id,
        retryToken
      );
    } else {
      wake = await gmailInventoryService.queueGmailMessageRetry(
        {
          auditId: sheetImport.id,
          gmailMessageId: sheetImport.messageUid,
          rfcMessageId: sheetImport.messageId
        },
        retryToken
      );
    }
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
    retryMode: proposalRows.length > 0 ? "apply" : "parse"
  };
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
      const error = new Error("Choose SKU and inventory columns from this sheet.");
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
      const error = new Error("Choose a subtractive column from this sheet.");
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
  getImport,
  listImports,
  rejectImport,
  retryImport,
  updateMapping,
  updateRowSelection
};
