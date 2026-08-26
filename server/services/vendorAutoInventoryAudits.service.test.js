const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./vendorAutoInventoryAudits.service");

test("creates stable inventory sheet IDs per vendor and attachment", () => {
  const first = _test.createAuditId("vendor-1", "attachment-hash");
  const second = _test.createAuditId(" vendor-1 ", "attachment-hash");
  const differentVendor = _test.createAuditId("vendor-2", "attachment-hash");

  assert.equal(first, second);
  assert.notEqual(first, differentVendor);
  assert.match(first, /^inventory-sheet-[a-f0-9]{64}$/);
});

test("maps persisted sheet import summaries and proposals", () => {
  assert.deepEqual(
    _test.mapAuditRow({
      id: "sheet-1",
      vendor_id: "vendor-1",
      vendor_name: "Example Vendor",
      status: "ready_for_review",
      mapping: JSON.stringify({ skuHeader: "Item" }),
      available_headers: JSON.stringify(["Item", "Available"]),
      total_rows: 20,
      matched_rows: 8,
      changed_rows: 3,
      is_legacy: false
    }),
    {
      id: "sheet-1",
      vendorId: "vendor-1",
      vendorName: "Example Vendor",
      messageUid: "",
      messageId: "",
      senderEmail: "",
      subject: "",
      attachmentFilename: "",
      attachmentHash: "",
      status: "ready_for_review",
      mapping: { skuHeader: "Item" },
      availableHeaders: ["Item", "Available"],
      previewRows: [],
      totalRows: 20,
      matchedRows: 8,
      changedRows: 3,
      selectedChangedRows: 0,
      unmatchedRows: 0,
      invalidRows: 0,
      exceptionRows: 0,
      appliedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errorMessage: "",
      manualRetryCount: 0,
      reviewedByEmail: "",
      reviewedByName: "",
      reviewedAt: "",
      createdAt: "",
      updatedAt: "",
      isLegacy: false
    }
  );

  assert.deepEqual(
    _test.mapProposalRow({
      row_number: 4,
      vendor_product_id: "vp-1",
      product_sku: "DPP-1",
      sheet_sku: "VENDOR-1",
      current_quantity: 0,
      proposed_quantity: 999999,
      sheet_quantity: 12,
      change_required: true,
      status: "matched"
    }),
    {
      rowNumber: 4,
      vendorProductId: "vp-1",
      productId: "",
      productSku: "DPP-1",
      vendorSku: "",
      sheetSku: "VENDOR-1",
      inventoryValue: "",
      subtractiveValue: "",
      currentQuantity: 0,
      proposedQuantity: 999999,
      sheetQuantity: 12,
      changeRequired: true,
      selected: true,
      status: "matched",
      errorMessage: ""
    }
  );
});
