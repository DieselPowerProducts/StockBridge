const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./catalog.service");

test("shows BTO vendor products in Stock Check only with a follow-up", () => {
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: true,
      followUpDate: ""
    }),
    false
  );
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: true,
      followUpDate: "2026-07-24"
    }),
    true
  );
});

test("keeps non-vendor BTO and non-BTO products eligible", () => {
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Built to Order",
      hasBuiltToOrderVendor: false,
      followUpDate: ""
    }),
    true
  );
  assert.equal(
    _test.shouldIncludeBuiltToOrderProductInStockCheck({
      availability: "Backorder",
      hasBuiltToOrderVendor: true,
      followUpDate: ""
    }),
    true
  );
});

test("keeps stock authoritative over optional Shopify availability modifiers", () => {
  assert.equal(
    _test.mapProductAvailabilityToShopifyStatus(
      { availability: "Available" },
      "in_stock",
      "built_to_order"
    ),
    "in_stock"
  );
  assert.equal(
    _test.mapProductAvailabilityToShopifyStatus(
      { availability: "Backorder" },
      "in_stock",
      "built_to_order"
    ),
    "built_to_order"
  );
  assert.equal(
    _test.mapProductAvailabilityToShopifyStatus(
      { availability: "Backorder" },
      "backordered",
      "discontinued"
    ),
    "discontinued"
  );
});

test("uses backorder when an unavailable product has no lower modifier", () => {
  assert.equal(
    _test.mapProductAvailabilityToShopifyStatus(
      { availability: "Backorder" },
      "backordered",
      ""
    ),
    "backordered"
  );
});

test("keeps a product stocked when another active vendor or warehouse has stock", () => {
  const vendorAvailability = _test.buildProductVendorAvailability([
    { product_id: "product-1", vendor_id: "vendor-zero", quantity: 0, status: 2 },
    { product_id: "product-1", vendor_id: "vendor-stocked", quantity: 9, status: 2 }
  ]);
  const productsBySku = new Map([
    [
      "SKU-1",
      {
        id: "product-1",
        sku: "SKU-1",
        qty_available: 0,
        is_kit: false,
        relatedProduct: []
      }
    ]
  ]);

  assert.equal(
    _test.getEffectiveQtyAvailable(
      "SKU-1",
      productsBySku,
      new Map(),
      new Set(),
      vendorAvailability
    ),
    9
  );

  vendorAvailability.vendorQuantityByProductId.set("product-1", 0);
  productsBySku.get("SKU-1").qty_available = 4;
  assert.equal(
    _test.getEffectiveQtyAvailable(
      "SKU-1",
      productsBySku,
      new Map(),
      new Set(),
      vendorAvailability
    ),
    4
  );
});

test("calculates kit inventory from components instead of parent vendor stock", () => {
  const productsBySku = new Map([
    [
      "KIT-1",
      {
        id: "kit-1",
        sku: "KIT-1",
        qty_available: 0,
        is_kit: true,
        relatedProduct: [
          { sku: "CHILD-IN", qty: 1 },
          { sku: "CHILD-OUT", qty: 1 }
        ]
      }
    ],
    [
      "CHILD-IN",
      {
        id: "child-in",
        sku: "CHILD-IN",
        qty_available: 0,
        is_kit: false,
        relatedProduct: []
      }
    ],
    [
      "CHILD-OUT",
      {
        id: "child-out",
        sku: "CHILD-OUT",
        qty_available: 0,
        is_kit: false,
        relatedProduct: []
      }
    ]
  ]);
  const productVendorAvailability = {
    builtToOrderBuildTimeByProductId: new Map(),
    collectiveQuantityByProductId: new Map(),
    productIdsWithActiveVendors: new Set(["kit-1", "child-in", "child-out"]),
    productIdsWithBuiltToOrderVendors: new Set(),
    vendorQuantityByProductId: new Map([
      ["kit-1", 999999],
      ["child-in", 999999],
      ["child-out", 0]
    ])
  };

  assert.equal(
    _test.getEffectiveQtyAvailable(
      "KIT-1",
      productsBySku,
      new Map(),
      new Set(),
      productVendorAvailability
    ),
    0
  );
  assert.equal(
    _test.getEffectiveAvailability(
      "KIT-1",
      productsBySku,
      productVendorAvailability
    ),
    "Backorder"
  );
});

test("backorders a kit when known child stock cannot fulfill one kit", () => {
  const productsBySku = new Map([
    [
      "CASE-12",
      {
        id: "case-12",
        sku: "CASE-12",
        qty_available: 0,
        is_kit: true,
        relatedProduct: [{ sku: "SINGLE", qty: 12 }]
      }
    ],
    [
      "SINGLE",
      {
        id: "single",
        sku: "SINGLE",
        qty_available: 3,
        is_kit: false,
        relatedProduct: []
      }
    ]
  ]);
  const productVendorAvailability = {
    builtToOrderBuildTimeByProductId: new Map(),
    collectiveQuantityByProductId: new Map(),
    productIdsWithActiveVendors: new Set(),
    productIdsWithBuiltToOrderVendors: new Set(),
    vendorQuantityByProductId: new Map()
  };

  assert.equal(
    _test.getEffectiveQtyAvailable(
      "CASE-12",
      productsBySku,
      new Map(),
      new Set(),
      productVendorAvailability
    ),
    0
  );
  assert.equal(
    _test.getEffectiveAvailability(
      "CASE-12",
      productsBySku,
      productVendorAvailability
    ),
    "Backorder"
  );
});

test("keeps a kit available when an unassigned component has no stock source", () => {
  const productsBySku = new Map([
    [
      "KIT-UNKNOWN",
      {
        id: "kit-unknown",
        sku: "KIT-UNKNOWN",
        qty_available: 0,
        is_kit: true,
        relatedProduct: [{ sku: "UNASSIGNED", qty: 2 }]
      }
    ],
    [
      "UNASSIGNED",
      {
        id: "unassigned",
        sku: "UNASSIGNED",
        qty_available: 0,
        is_kit: false,
        relatedProduct: []
      }
    ]
  ]);
  const productVendorAvailability = {
    builtToOrderBuildTimeByProductId: new Map(),
    collectiveQuantityByProductId: new Map(),
    productIdsWithActiveVendors: new Set(),
    productIdsWithBuiltToOrderVendors: new Set(),
    vendorQuantityByProductId: new Map()
  };

  assert.equal(
    _test.getEffectiveAvailability(
      "KIT-UNKNOWN",
      productsBySku,
      productVendorAvailability
    ),
    "Available"
  );
});
