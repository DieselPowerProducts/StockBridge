const assert = require("node:assert/strict");
const test = require("node:test");
const service = require("./stockCheckBulkEmails.service");
const { _test } = service;

test("selects dated and undated stock checks in the chosen range", () => {
  const products = [
    { sku: "A", followUpDate: "2026-10-07" },
    { sku: "B", followUpDate: "2026-10-08" },
    { sku: "C", followUpDate: "2026-10-10" },
    { sku: "D", followUpDate: "" }
  ];
  assert.deepEqual(
    _test.selectProductsForDateRange(products, {
      fromDate: "2026-10-08", toDate: "2026-10-09", includeUndated: false
    }).map((product) => product.sku),
    ["B"]
  );
  assert.deepEqual(
    _test.selectProductsForDateRange(products, {
      fromDate: "2026-10-08", toDate: "2026-10-09", includeUndated: true
    }).map((product) => product.sku),
    ["B", "D"]
  );
});

test("puts every selected SKU in the outgoing message", () => {
  assert.match(_test.buildBody("Please check these.", [{ sku: "A" }, { sku: "B" }]),
    /Please check these\.\n\nA\nB\n\nThank you/);
});

test("sends one message and records every selected SKU", async (t) => {
  const catalogService = require("./catalog.service");
  const vendorsService = require("./vendors.service");
  const emailService = require("./email.service");
  const stockCheckEmailsService = require("./stockCheckEmails.service");
  t.mock.method(catalogService, "listStockCheckVendorGroups", async () => ({
    groups: [{
      vendorId: "ppe",
      vendorName: "Pacific Performance Engineering",
      products: [
        { sku: "PPE-1", followUpDate: "2026-10-08" },
        { sku: "PPE-2", followUpDate: "2026-10-09" }
      ]
    }]
  }));
  t.mock.method(vendorsService, "listVendorContacts", async () => [
    { email: "orders@example.com" }
  ]);
  const sent = t.mock.method(emailService, "sendVendorStockCheckEmail", async () => ({
    messageId: "<bulk@example.com>", accepted: ["orders@example.com"]
  }));
  const recorded = t.mock.method(stockCheckEmailsService, "recordVendorEmails", async () => []);

  const input = {
    vendorId: "ppe",
    skus: ["PPE-1", "PPE-2"],
    fromDate: "2026-10-08",
    toDate: "2026-10-09",
    includeUndated: false,
    to: "orders@example.com",
    subject: "PPE stock check",
    message: "Please check these."
  };
  const result = await service.sendBulkStockCheck(input, { email: "cade@example.com" });
  assert.deepEqual(result.skus, ["PPE-1", "PPE-2"]);
  assert.equal(sent.mock.callCount(), 1);
  assert.match(sent.mock.calls[0].arguments[0].body, /PPE-1\nPPE-2/);
  assert.deepEqual(recorded.mock.calls[0].arguments[0].skus, ["PPE-1", "PPE-2"]);

  await assert.rejects(
    service.sendBulkStockCheck({ ...input, skus: ["PPE-1"] }),
    { statusCode: 409 }
  );
  assert.equal(sent.mock.callCount(), 1);
});
