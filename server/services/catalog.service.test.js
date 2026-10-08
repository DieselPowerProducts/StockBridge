const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./catalog.service");

test("groups stock checks by active vendor and retains unassigned SKUs", () => {
  const products = [
    { id: "1", sku: "PPE-1", followUpDate: "2026-10-08" },
    { id: "2", sku: "NONE-1", followUpDate: "" }
  ];
  const vendorRows = [
    { product_id: "1", vendor_id: "b", vendor_name: "PPE", status: 2 },
    { product_id: "1", vendor_id: "a", vendor_name: "Alt Vendor", status: 2 },
    { product_id: "1", vendor_id: "b", vendor_name: "PPE", status: 2 },
    { product_id: "1", vendor_id: "old", vendor_name: "Inactive", status: 1 }
  ];
  const groups = _test.buildStockCheckVendorGroups(products, vendorRows, new Set(["PPE-1"]));
  assert.deepEqual(groups.map((group) => [group.vendorName, group.products.map((p) => p.sku)]), [
    ["Alt Vendor", ["PPE-1"]],
    ["PPE", ["PPE-1"]],
    ["Unassigned", ["NONE-1"]]
  ]);
  assert.equal(groups[1].products[0].vendorEmailSent, true);
});

test("BTO cleanup preserves dates and scopes to active non-overridden assignments", async (t) => {
  const neon = require("../db/neon");
  const servicePath = require.resolve("./catalog.service");
  const originalModule = require.cache[servicePath];
  const statements = [];
  const fakeSql = async (strings, ...values) => {
    const query = strings.join("?");
    statements.push({ query, values });
    return query.includes("UPDATE product_follow_ups AS follow_up") ? [{ sku: "BTO-1" }] : [];
  };
  t.mock.method(neon, "getSql", () => fakeSql);
  t.mock.method(require("./vendorSettings.service"), "initializeSchema", async () => {});
  t.mock.method(require("./followUps.service"), "initializeSchema", async () => {});
  const restore = t.mock.method(
    require("./shopifyAvailabilityState.service"),
    "restoreBuiltToOrderAfterNoEta",
    async () => []
  );
  delete require.cache[servicePath];
  try {
    const service = require(servicePath);
    assert.deepEqual(await service.clearBuiltToOrderNoEtas({ vendorId: "v1" }), ["BTO-1"]);
    assert.deepEqual(restore.mock.calls[0].arguments, [["BTO-1"]]);
    const cleanup = statements.find(({ query }) => query.includes("UPDATE product_follow_ups AS follow_up"));
    assert.match(cleanup.query, /vp.status = 1 AND v.status >= 2/);
    assert.match(cleanup.query, /vp.built_to_order_disabled = FALSE/);
    assert.match(cleanup.query, /settings.built_to_order = TRUE/);
    assert.match(cleanup.query, /SET no_eta = FALSE, updated_at = now\(\)/);
    assert.doesNotMatch(cleanup.query, /SET follow_up_date/);
    assert.deepEqual(cleanup.values, [null, null, "v1", "v1"]);
    await service.setVendorProductBuiltToOrder("vp1", false);
    const override = statements.find(({ query }) => query.includes("SET built_to_order_disabled"));
    assert.deepEqual(override.values, [true, "vp1"]);
  } finally {
    require.cache[servicePath] = originalModule;
  }
});

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

test("recognizes only active vendor-product assignments", () => {
  assert.equal(_test.isActiveVendorProduct({ status: 1 }), true);
  assert.equal(_test.isActiveVendorProduct({ status: 2 }), false);
  assert.equal(_test.isActiveVendorProduct({ status: 0 }), false);
  assert.equal(_test.isActiveVendorProduct({ status: null }), false);
});

test("uses a product BTO time before the assigned vendor default", () => {
  assert.equal(
    _test.getOwnBuildToOrderLeadTime(
      { id: "product-1", sku: "MBRP-1" },
      {
        builtToOrderBuildTimeByProductId: new Map([
          ["product-1", "3-4 Weeks"]
        ])
      },
      new Map([["MBRP-1", "5-6 Weeks"]])
    ),
    "5-6 Weeks"
  );
});

test("excludes Shopify Collective products from Stock Check", () => {
  const productVendorAvailability = _test.buildProductVendorAvailability(
    [
      {
        product_id: "collective-vendor-product",
        vendor_name: "DPP Collective",
        status: 1,
        quantity: 0
      }
    ],
    [{ product_id: "collective-product", inventory_quantity: 0 }]
  );

  assert.equal(
    _test.shouldIncludeNonCollectiveProductInStockCheck(
      { id: "collective-product" },
      productVendorAvailability
    ),
    false
  );
  assert.equal(
    _test.shouldIncludeNonCollectiveProductInStockCheck(
      { id: "collective-vendor-product" },
      productVendorAvailability
    ),
    false
  );
  assert.equal(
    _test.shouldIncludeNonCollectiveProductInStockCheck(
      { id: "standard-product" },
      productVendorAvailability
    ),
    true
  );
});

test("excludes discontinued products from Stock Check", () => {
  const availabilityBySku = new Map([
    ["DISCONTINUED-SKU", "discontinued"],
    ["BACKORDERED-SKU", "backordered"]
  ]);

  assert.equal(
    _test.shouldIncludeNonDiscontinuedProductInStockCheck(
      { sku: "DISCONTINUED-SKU" },
      availabilityBySku
    ),
    false
  );
  assert.equal(
    _test.shouldIncludeNonDiscontinuedProductInStockCheck(
      { sku: "BACKORDERED-SKU" },
      availabilityBySku
    ),
    true
  );
  assert.equal(
    _test.shouldIncludeNonDiscontinuedProductInStockCheck(
      { sku: "UNTRACKED-SKU" },
      availabilityBySku
    ),
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
    "backordered"
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
