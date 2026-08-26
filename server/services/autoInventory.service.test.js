const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./autoInventory.service");

const alphabeticalSettings = {
  inventoryMode: "alphabetical",
  inStockPhrases: ["In Stock", "Available"],
  outOfStockPhrases: ["Out of Stock", "Call for Availability"],
  subtractiveColumn: ""
};

test("tracks recognized alphabetical in-stock rows", () => {
  const result = _test.parseInventoryResult("Available now", alphabeticalSettings);

  assert.equal(result.quantity, 999999);
  assert.equal(_test.getTrackedSheetQuantity(result, "alphabetical"), 999999);
});

test("tracks recognized alphabetical out-of-stock rows", () => {
  const result = _test.parseInventoryResult(
    "Call for Availability",
    alphabeticalSettings
  );

  assert.equal(result.quantity, 0);
  assert.equal(_test.getTrackedSheetQuantity(result, "alphabetical"), 0);
});

test("keeps numerical sheet quantities unchanged", () => {
  const result = {
    quantity: 999999,
    sheetQuantity: 12
  };

  assert.equal(_test.getTrackedSheetQuantity(result, "numerical"), 12);
});

test("applies a card mapping without changing vendor identity or exceptions", () => {
  const result = _test.applyAuditMappingToSettings(
    {
      vendorId: "vendor-1",
      senderEmail: "vendor@example.com",
      skuHeader: "Default SKU",
      inventoryHeader: "Default Qty",
      skuExceptions: ["KEEP-MANUAL"]
    },
    {
      mapping: {
        skuHeader: "Card SKU",
        inventoryHeader: "Card Qty",
        subtractiveColumn: "Allocated"
      }
    }
  );

  assert.equal(result.skuHeader, "Card SKU");
  assert.equal(result.inventoryHeader, "Card Qty");
  assert.equal(result.subtractiveColumn, "Allocated");
  assert.equal(result.vendorId, "vendor-1");
  assert.equal(result.senderEmail, "vendor@example.com");
  assert.deepEqual(result.skuExceptions, ["KEEP-MANUAL"]);
});


const servicePath = require.resolve("./autoInventory.service");
const catalogPath = require.resolve("./catalog.service");
const auditsPath = require.resolve("./vendorAutoInventoryAudits.service");
const productsPath = require.resolve("./products.service");

function restoreModule(modulePath, original) {
  if (original) require.cache[modulePath] = original;
  else delete require.cache[modulePath];
}

async function withStagingHarness(callback) {
  const paths = [servicePath, catalogPath, auditsPath, productsPath];
  const originals = new Map(paths.map((path) => [path, require.cache[path]]));
  const staged = [];
  let productUpdateCalls = 0;

  require.cache[catalogPath] = {
    id: catalogPath,
    filename: catalogPath,
    loaded: true,
    exports: {
      getActiveCatalogVendorProductsByVendorId: async () => [
        {
          id: "vendor-product-1",
          vendor_id: "vendor-1",
          product_id: "product-1",
          product_sku: "DPP-100",
          sku: "VENDOR-100",
          label: "VENDOR-100",
          quantity: 0,
          price: 10,
          status: 1
        }
      ]
    }
  };
  require.cache[auditsPath] = {
    id: auditsPath,
    filename: auditsPath,
    loaded: true,
    exports: {
      getAuditByAttachment: async () => null,
      stageAudit: async (summary, rows) => {
        staged.push({ summary, rows });
        return { id: "sheet-1" };
      }
    }
  };
  require.cache[productsPath] = {
    id: productsPath,
    filename: productsPath,
    loaded: true,
    exports: {
      setVendorProductQuantity: async () => {
        productUpdateCalls += 1;
        throw new Error("staging must not update inventory");
      }
    }
  };
  delete require.cache[servicePath];

  try {
    const service = require(servicePath);
    await callback({
      productUpdateCalls: () => productUpdateCalls,
      staged,
      stageSheetAttachment: service._test.stageSheetAttachment
    });
  } finally {
    for (const path of paths) restoreModule(path, originals.get(path));
  }
}

const stagingSettings = {
  vendorId: "vendor-1",
  senderEmail: "vendor@example.com",
  skuHeader: "Item",
  inventoryHeader: "Available",
  subtractiveColumn: "",
  skuExceptions: [],
  inventoryMode: "numerical",
  inStockPhrases: [],
  outOfStockPhrases: []
};

test("stages matched inventory changes without updating SKU Nexus", async () => {
  await withStagingHarness(async ({ productUpdateCalls, staged, stageSheetAttachment }) => {
    const result = await stageSheetAttachment({
      settings: stagingSettings,
      attachment: {
        filename: "inventory.csv",
        contentType: "text/csv",
        content: Buffer.from("Item,Available\nVENDOR-100,12\nUNKNOWN,3\n")
      },
      message: {
        uid: "gmail-1",
        messageId: "message-1",
        subject: "Inventory"
      }
    });

    assert.equal(productUpdateCalls(), 0);
    assert.equal(result.staged, 1);
    assert.equal(staged.length, 1);
    assert.equal(staged[0].summary.status, "ready_for_review");
    assert.equal(staged[0].summary.unmatchedRows, 1);
    assert.deepEqual(staged[0].summary.previewRows, [
      ["VENDOR-100", "12"],
      ["UNKNOWN", "3"]
    ]);
    assert.equal(staged[0].rows[0].changeRequired, true);
    assert.equal(staged[0].rows[0].proposedQuantity, 999999);
  });
});

test("stages changed headers as needs mapping", async () => {
  await withStagingHarness(async ({ staged, stageSheetAttachment }) => {
    const result = await stageSheetAttachment({
      settings: stagingSettings,
      attachment: {
        filename: "inventory.csv",
        contentType: "text/csv",
        content: Buffer.from("Part Number,Qty Available\nVENDOR-100,12\n")
      },
      message: { uid: "gmail-2", messageId: "message-2" }
    });

    assert.equal(result.errors, 1);
    assert.equal(staged[0].summary.status, "needs_mapping");
    assert.deepEqual(staged[0].summary.availableHeaders, [
      "Part Number",
      "Qty Available"
    ]);
    assert.deepEqual(staged[0].summary.previewRows, [["VENDOR-100", "12"]]);
  });
});

test("does not apply a row removed from a sheet review", async () => {
  const productUpdatesPath = require.resolve(
    "./vendorAutoInventoryProductUpdates.service"
  );
  const importsPath = require.resolve("./vendorAutoInventoryImports.service");
  const paths = [
    servicePath,
    catalogPath,
    auditsPath,
    productsPath,
    productUpdatesPath,
    importsPath
  ];
  const originals = new Map(paths.map((path) => [path, require.cache[path]]));
  const statuses = [];
  const managedUpdates = [];
  let quantityWrites = 0;

  require.cache[catalogPath] = {
    id: catalogPath,
    filename: catalogPath,
    loaded: true,
    exports: {
      getActiveCatalogVendorProductsByVendorId: async () => [
        {
          id: "vendor-product-1",
          product_id: "product-1",
          product_sku: "DPP-100",
          quantity: 0
        }
      ]
    }
  };
  require.cache[auditsPath] = {
    id: auditsPath,
    filename: auditsPath,
    loaded: true,
    exports: {
      getAuditRecord: async () => ({
        id: "sheet-1",
        vendorId: "vendor-1",
        status: "approved",
        appliedCount: 0,
        mapping: { inventoryMode: "numerical" }
      }),
      getProposalRows: async () => [
        {
          rowNumber: 2,
          vendorProductId: "vendor-product-1",
          productId: "product-1",
          productSku: "DPP-100",
          sheetSku: "VENDOR-100",
          currentQuantity: 0,
          proposedQuantity: 999999,
          selected: false
        }
      ],
      setStatus: async (_auditId, status) => {
        statuses.push(status);
      }
    }
  };
  require.cache[productsPath] = {
    id: productsPath,
    filename: productsPath,
    loaded: true,
    exports: {
      setVendorProductQuantity: async () => {
        quantityWrites += 1;
      }
    }
  };
  require.cache[productUpdatesPath] = {
    id: productUpdatesPath,
    filename: productUpdatesPath,
    loaded: true,
    exports: {
      replaceVendorProductUpdatesForVendor: async (input) => {
        managedUpdates.push(input);
      }
    }
  };
  require.cache[importsPath] = {
    id: importsPath,
    filename: importsPath,
    loaded: true,
    exports: { recordImport: async () => ({ id: "legacy-1" }) }
  };
  delete require.cache[servicePath];

  try {
    const service = require(servicePath);
    const result = await service.applyStagedInventoryAudit("sheet-1");

    assert.equal(quantityWrites, 0);
    assert.equal(result.applied, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(managedUpdates[0].updates, []);
    assert.deepEqual(statuses, ["applying", "applied"]);
  } finally {
    for (const path of paths) restoreModule(path, originals.get(path));
  }
});
