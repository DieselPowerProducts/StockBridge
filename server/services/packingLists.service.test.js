const assert = require("node:assert/strict");
const test = require("node:test");

const {
  _test: {
    buildPackingParts,
    classifyOrders,
    parsePurchaseOrderInput,
    parseReceiptEntries
  }
} = require("./packingLists.service");

test("normalizes pasted purchase order lists", () => {
  assert.deepEqual(
    parsePurchaseOrderInput(["0000001, 0000002", "0000001\n0000003"]),
    ["0000001", "0000002", "0000003"]
  );
});

test("parses receipt history and keeps only valid positive quantities", () => {
  assert.deepEqual(
    parseReceiptEntries([
      {
        custom_field_id: "date_received",
        value: JSON.stringify([
          { qty: 2, date: "08/11/2026 09:18 am" },
          { qty: 0, date: "08/12/2026 09:18 am" },
          { qty: 1, date: "not a date" }
        ])
      }
    ]),
    [
      {
        date: "08/11/2026 09:18 am",
        dateKey: "2026-08-11",
        quantity: 2
      }
    ]
  );
});

test("aggregates duplicate received SKUs across purchase orders", () => {
  const result = buildPackingParts(
    [
      {
        id: "po-1",
        label: "0000001",
        vendor: { name: "Vendor" },
        lineItems: {
          rows: [
            {
              product: { sku: "ABC-123", name: "Part" },
              customValues: [
                {
                  custom_field_id: "date_received",
                  value: '[{"qty":2,"date":"08/10/2026 09:00 am"}]'
                }
              ]
            }
          ]
        }
      },
      {
        id: "po-2",
        label: "0000002",
        vendor: { name: "Vendor" },
        lineItems: {
          rows: [
            {
              product: { sku: "abc-123", name: "Part" },
              customValues: [
                {
                  custom_field_id: "date_received",
                  value: '[{"qty":3,"date":"08/12/2026 10:00 am"}]'
                }
              ]
            }
          ]
        }
      }
    ],
    "2026-08-08",
    "2026-08-19"
  );

  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0].receivedQuantity, 5);
  assert.deepEqual(
    result.parts[0].sources.map((source) => source.poNumber),
    ["0000001", "0000002"]
  );
});

test("classifies warehouse, backorder, missing tracking, and unsent work", () => {
  const part = {
    sku: "ABC-123",
    name: "Part",
    receivedQuantity: 4,
    sources: [{ poNumber: "0000001", quantity: 4, receivedDates: [] }]
  };
  const baseOrder = {
    id: "order-1",
    label: "1001",
    state: "open",
    created_at: "2026-08-01 10:00:00",
    customer_name: "Customer",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: 0,
        relatedProduct: { sku: "ABC-123", name: "Part" },
        decidedItems: [
          {
            decisions: [
              { relatedFulfillment: { id: "warehouse-1" } },
              { relatedFulfillment: { id: "drop-1" } }
            ]
          }
        ]
      }
    ],
    shipmentFulfillmentsGrid: {
      rows: [
        {
          id: "warehouse-1",
          current_state: "pack",
          fulfillFrom: { label: "DPP Warehouse" }
        }
      ]
    },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: "drop-1",
          current_state: "dispatch",
          relatedPurchaseOrder: { tracking_code: "" }
        }
      ]
    }
  };
  const groups = classifyOrders(
    [baseOrder],
    [part],
    [
      {
        order_id: "order-1",
        missing_qty: 1,
        relatedProduct: { sku: "ABC-123" }
      }
    ]
  );

  assert.equal(groups.warehouse.length, 1);
  assert.equal(groups.backordered.length, 1);
  assert.equal(groups.missingTracking.length, 1);
  assert.equal(groups.notSent.length, 0);
});
