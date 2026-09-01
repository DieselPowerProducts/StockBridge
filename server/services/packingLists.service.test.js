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
    parsePurchaseOrderInput([
      "0000001, 0000002",
      "0000001\n0000003",
      "0075835 / 0080586 / 0095082 / 0091310"
    ]),
    [
      "0000001",
      "0000002",
      "0000003",
      "0075835",
      "0080586",
      "0095082",
      "0091310"
    ]
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

test("classifies warehouse, backorder, and missing tracking work", () => {
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
  assert.equal(groups.undecided.length, 0);
});

test("classifies only completely unassigned items as undecided", () => {
  const part = {
    sku: "ABC-123",
    name: "Part",
    receivedQuantity: 1,
    sources: [{ poNumber: "0000001", quantity: 1, receivedDates: [] }]
  };
  const order = {
    id: "order-1",
    label: "1001",
    state: "open",
    created_at: "2026-08-01 10:00:00",
    customer_name: "Customer",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: 1,
        relatedProduct: { sku: "ABC-123", name: "Part" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: { rows: [] }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.undecided.length, 1);
  assert.match(groups.undecided[0].items[0].reason, /not been assigned/i);
});

test("uses ordered quantity when an unassigned item's decidable quantity is null", () => {
  const part = {
    sku: "MAH-MS20601",
    name: "Part",
    receivedQuantity: 1,
    sources: [{ poNumber: "0102368", quantity: 1, receivedDates: [] }]
  };
  const order = {
    id: "order-954272",
    label: "954272",
    state: "Open",
    created_at: "2026-08-30 06:11:04",
    customer_name: "Colton Langdon",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "MAH-MS20601", name: "Part" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: { rows: [] }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.undecided.length, 1);
  assert.equal(groups.undecided[0].orderNumber, "954272");
});

test("does not let an unrelated fulfillment hide an undecided item", () => {
  const part = {
    sku: "SYN-8550-11",
    name: "Part",
    receivedQuantity: 22,
    sources: [{ poNumber: "0095037", quantity: 22, receivedDates: [] }]
  };
  const order = {
    id: "order-927055",
    label: "927055",
    state: "In Fulfillment",
    created_at: "2026-07-07 10:00:00",
    customer_name: "Luke Shuman",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "SYN-8550-11", name: "Part" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: {
      rows: [
        {
          id: "other-item-fulfillment",
          current_state: "dispatch",
          items: [
            {
              quantity: 1,
              product: { sku: "OTHER-SKU" }
            }
          ],
          fulfillFrom: { id: "warehouse", label: "DPP Warehouse" }
        }
      ]
    },
    dropShipFulfillmentsGrid: { rows: [] }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.undecided.length, 1);
  assert.equal(groups.undecided[0].orderNumber, "927055");
});

test("uses drop-ship item details when order decisions are omitted", () => {
  const part = {
    sku: "SYN-8515-11",
    name: "Part",
    receivedQuantity: 4,
    sources: [{ poNumber: "0074128", quantity: 4, receivedDates: [] }]
  };
  const order = {
    id: "order-950605",
    label: "950605",
    state: "In Fulfillment",
    created_at: "2026-08-23 20:03:07",
    customer_name: "Jared Johnson",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "SYN-8515-11", name: "Part" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: "drop-1",
          current_state: "pending",
          fulfillFrom: { id: "synergy", label: "Synergy Manufacturing" },
          relatedPurchaseOrder: { label: "0104061", tracking_code: [] },
          items: [
            {
              quantity: 1,
              product: { sku: "SYN-8515-11" }
            }
          ]
        }
      ]
    }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.missingTracking.length, 1);
  assert.equal(groups.missingTracking[0].orderNumber, "950605");
  assert.equal(groups.undecided.length, 0);
});

test("uses an in-store fulfillment item as warehouse work", () => {
  const part = {
    sku: "SYN-8550-11",
    name: "Part",
    receivedQuantity: 22,
    sources: [{ poNumber: "0095037", quantity: 22, receivedDates: [] }]
  };
  const order = {
    id: "order-927055",
    label: "927055",
    state: "In Fulfillment",
    created_at: "2026-07-07 16:07:08",
    customer_name: "Luke Shuman",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "SYN-8550-11", name: "Part" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: {
      rows: [
        {
          id: "in-store-1",
          label: "0188996",
          current_state: "ready",
          fulfillFrom: { id: "warehouse", label: "DPP Warehouse" },
          items: [
            {
              quantity: 1,
              product: { sku: "SYN-8550-11" }
            }
          ]
        }
      ]
    },
    dropShipFulfillmentsGrid: { rows: [] }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.warehouse.length, 1);
  assert.equal(groups.warehouse[0].orderNumber, "927055");
  assert.equal(groups.warehouse[0].items[0].fulfillmentState, "ready");
  assert.equal(groups.undecided.length, 0);
});

test("prefers active warehouse work over returned vendor work and excludes cancellations", () => {
  const parts = ["PPE-338052210", "PPE-338052220"].map((sku) => ({
    sku,
    name: sku,
    receivedQuantity: 1,
    sources: [{ poNumber: "0045736", quantity: 1, receivedDates: [] }]
  }));
  const order = {
    id: "order-887940",
    label: "887940",
    state: "In Fulfillment",
    created_at: "2026-04-14 21:12:08",
    customer_name: "Michael Biddle",
    items: [
      {
        id: "item-210",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "PPE-338052210", name: "210" },
        decidedItems: [
          {
            name: "Shipment",
            decisions: [
              {
                qty: 1,
                label: "Warehouse: DPP Warehouse, Location: C-3",
                relatedFulfillment: { id: "warehouse-1", state: "pack" }
              }
            ]
          }
        ]
      },
      {
        id: "item-220",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "PPE-338052220", name: "220" },
        decidedItems: []
      }
    ],
    shipmentFulfillmentsGrid: {
      rows: [
        {
          id: "warehouse-1",
          current_state: "pack",
          fulfillFrom: { id: "warehouse", label: "DPP Warehouse" },
          items: [
            { quantity: 1, product: { sku: "PPE-338052210" } }
          ]
        }
      ]
    },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: "returned-210",
          current_state: "return_to_decision",
          fulfillFrom: { id: "ppe", label: "PPE" },
          relatedPurchaseOrder: { tracking_code: [] },
          items: [
            { quantity: 1, product: { sku: "PPE-338052210" } }
          ]
        },
        {
          id: "returned-220",
          current_state: "return_to_decision",
          fulfillFrom: { id: "ppe", label: "PPE" },
          relatedPurchaseOrder: { tracking_code: [] },
          items: [
            { quantity: 1, product: { sku: "PPE-338052220" } }
          ]
        }
      ]
    },
    cancellationFulfillmentsGrid: {
      rows: [
        {
          id: "cancelled-220",
          current_state: "cancelled",
          items: [
            { quantity: 1, product: { sku: "PPE-338052220" } }
          ]
        }
      ]
    }
  };
  const backorders = parts.map((part) => ({
    order_id: order.id,
    missing_qty: 1,
    relatedProduct: { sku: part.sku }
  }));
  const vendorProducts = parts.map((part) => ({
    vendor_id: "ppe",
    quantity: 0,
    product: { sku: part.sku }
  }));

  const groups = classifyOrders([order], parts, backorders, vendorProducts);

  assert.equal(groups.warehouse.length, 1);
  assert.deepEqual(
    groups.warehouse[0].items.map((item) => item.sku),
    ["PPE-338052210"]
  );
  assert.equal(groups.backordered.length, 0);
  assert.equal(groups.missingTracking.length, 0);
  assert.equal(groups.undecided.length, 0);
});

test("excludes tracked vendor work and fully finalized items", () => {
  const part = {
    sku: "ABC-123",
    name: "Part",
    receivedQuantity: 1,
    sources: [{ poNumber: "0000001", quantity: 1, receivedDates: [] }]
  };
  const makeOrder = (id, fulfillmentId, state, trackingCode) => ({
    id,
    label: id,
    state: "in_fulfillment",
    created_at: "2026-08-01 10:00:00",
    customer_name: "Customer",
    items: [
      {
        id: `item-${id}`,
        qty: 1,
        decidable_qty: 0,
        relatedProduct: { sku: "ABC-123", name: "Part" },
        decidedItems: [
          {
            decisions: [
              {
                qty: 1,
                relatedFulfillment: { id: fulfillmentId }
              }
            ]
          }
        ]
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: fulfillmentId,
          current_state: state,
          fulfillFrom: { id: "assigned-vendor", label: "Assigned Vendor" },
          relatedPurchaseOrder: { tracking_code: trackingCode }
        }
      ]
    }
  });

  const groups = classifyOrders(
    [
      makeOrder("tracked", "drop-1", "dispatch", "1Z123"),
      makeOrder("finalized", "drop-2", "finalized", "1Z456")
    ],
    [part],
    [
      {
        order_id: "finalized",
        missing_qty: 1,
        relatedProduct: { sku: "ABC-123" }
      }
    ],
    [
      {
        vendor_id: "assigned-vendor",
        quantity: 0,
        product: { sku: "ABC-123" }
      }
    ]
  );

  assert.deepEqual(groups, {
    warehouse: [],
    backordered: [],
    missingTracking: [],
    undecided: []
  });
});

test("uses the assigned vendor availability for backorder classification", () => {
  const part = {
    sku: "MAH-F33726",
    name: "Part",
    receivedQuantity: 1,
    sources: [{ poNumber: "0102368", quantity: 1, receivedDates: [] }]
  };
  const order = {
    id: "order-950546",
    label: "950546",
    state: "In Fulfillment",
    created_at: "2026-08-23 18:06:05",
    customer_name: "Nathan Martin",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "MAH-F33726", name: "Part" },
        decidedItems: [
          {
            decisions: [
              {
                qty: 1,
                relatedFulfillment: { id: "drop-1" }
              }
            ]
          }
        ]
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: "drop-1",
          current_state: "pending",
          fulfillFrom: { id: "mahle", label: "Mahle Aftermarket" },
          relatedPurchaseOrder: { tracking_code: [] }
        }
      ]
    }
  };
  const vendorProducts = [
    {
      vendor_id: "mahle",
      quantity: 0,
      product: { sku: "MAH-F33726" }
    },
    {
      vendor_id: "other-vendor",
      quantity: 999999,
      product: { sku: "MAH-F33726" }
    }
  ];

  const groups = classifyOrders([order], [part], [], vendorProducts);

  assert.equal(groups.backordered.length, 1);
  assert.match(groups.backordered[0].items[0].reason, /Mahle Aftermarket/);
  assert.equal(groups.missingTracking.length, 0);
});

test("does not use another vendor's zero stock for vendor backorder", () => {
  const part = {
    sku: "ABC-123",
    name: "Part",
    receivedQuantity: 1,
    sources: [{ poNumber: "0000001", quantity: 1, receivedDates: [] }]
  };
  const order = {
    id: "order-1",
    label: "1001",
    state: "In Fulfillment",
    created_at: "2026-08-23 18:06:05",
    customer_name: "Customer",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "ABC-123", name: "Part" },
        decidedItems: [
          {
            decisions: [
              { qty: 1, relatedFulfillment: { id: "drop-1" } }
            ]
          }
        ]
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: {
      rows: [
        {
          id: "drop-1",
          current_state: "pending",
          fulfillFrom: { id: "assigned-vendor", label: "Assigned Vendor" },
          relatedPurchaseOrder: { tracking_code: [] }
        }
      ]
    }
  };

  const groups = classifyOrders(
    [order],
    [part],
    [
      {
        order_id: "order-1",
        missing_qty: 1,
        relatedProduct: { sku: "ABC-123" }
      }
    ],
    [
      {
        vendor_id: "assigned-vendor",
        quantity: 4,
        product: { sku: "ABC-123" }
      },
      {
        vendor_id: "other-vendor",
        quantity: 0,
        product: { sku: "ABC-123" }
      }
    ]
  );

  assert.equal(groups.backordered.length, 0);
  assert.equal(groups.missingTracking.length, 1);
});

test("uses the order decision when the warehouse fulfillment grid omits a row", () => {
  const part = {
    sku: "MAH-GS33656",
    name: "Part",
    receivedQuantity: 3,
    sources: [{ poNumber: "0102368", quantity: 3, receivedDates: [] }]
  };
  const order = {
    id: "order-953353",
    label: "953353",
    state: "In Fulfillment",
    created_at: "2026-08-28 13:38:06",
    customer_name: "REX GODFREY",
    items: [
      {
        id: "item-1",
        qty: 1,
        decidable_qty: null,
        relatedProduct: { sku: "MAH-GS33656", name: "Part" },
        decidedItems: [
          {
            name: "Shipment",
            decisions: [
              {
                qty: 1,
                label: "Warehouse: DPP Warehouse, Location: S-H1",
                relatedFulfillment: {
                  id: "warehouse-1",
                  label: "0187811",
                  state: "pick"
                }
              }
            ]
          }
        ]
      }
    ],
    shipmentFulfillmentsGrid: { rows: [] },
    dropShipFulfillmentsGrid: { rows: [] }
  };

  const groups = classifyOrders([order], [part], []);

  assert.equal(groups.warehouse.length, 1);
  assert.equal(groups.warehouse[0].orderNumber, "953353");
  assert.equal(groups.warehouse[0].items[0].fulfillmentState, "pick");
  assert.match(groups.warehouse[0].items[0].reason, /DPP Warehouse/);
});
