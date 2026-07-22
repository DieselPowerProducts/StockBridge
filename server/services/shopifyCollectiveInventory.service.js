const { getSql } = require("../db/neon");
const shopifyAvailabilityStateService = require("./shopifyAvailabilityState.service");
const shopifyService = require("./shopify.service");
const skunexus = require("./skunexus.service");

const enabledVendorStockQuantity = 999999;
const disabledVendorStockQuantity = 0;
const skuNexusUpdateConcurrency = 8;

let schemaReady;

function normalizeSku(value) {
  return String(value || "").trim();
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS shopify_collective_inventory_state (
          sku TEXT PRIMARY KEY,
          shopify_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          shopify_variant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          inventory_quantity INTEGER NOT NULL DEFAULT 0,
          inventory_policy TEXT NOT NULL DEFAULT 'DENY',
          availability_status TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS shopify_collective_inventory_state_active_sku_idx
        ON shopify_collective_inventory_state (is_active, upper(sku))
      `;
    })();
  }

  return schemaReady;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = {
          ok: true,
          value: await mapper(items[index], index)
        };
      } catch (error) {
        results[index] = {
          ok: false,
          error
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function upsertCollectiveInventoryState(records, syncStamp) {
  await initializeSchema();
  const sql = getSql();

  await sql.query(
    `
      WITH input_rows AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS row(
          sku TEXT,
          shopify_product_ids JSONB,
          shopify_variant_ids JSONB,
          inventory_quantity INTEGER,
          inventory_policy TEXT,
          availability_status TEXT
        )
      )
      INSERT INTO shopify_collective_inventory_state (
        sku,
        shopify_product_ids,
        shopify_variant_ids,
        inventory_quantity,
        inventory_policy,
        availability_status,
        is_active,
        last_seen_at
      )
      SELECT
        sku,
        shopify_product_ids,
        shopify_variant_ids,
        inventory_quantity,
        inventory_policy,
        availability_status,
        TRUE,
        $2::timestamptz
      FROM input_rows
      ON CONFLICT (sku) DO UPDATE
      SET shopify_product_ids = EXCLUDED.shopify_product_ids,
          shopify_variant_ids = EXCLUDED.shopify_variant_ids,
          inventory_quantity = EXCLUDED.inventory_quantity,
          inventory_policy = EXCLUDED.inventory_policy,
          availability_status = EXCLUDED.availability_status,
          is_active = TRUE,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = now()
    `,
    [
      JSON.stringify(
        records.map((record) => ({
          sku: normalizeSku(record.sku),
          shopify_product_ids: record.productIds || [],
          shopify_variant_ids: record.variantIds || [],
          inventory_quantity: Number(record.inventoryQuantity || 0),
          inventory_policy: record.inventoryPolicy,
          availability_status: record.availability
        }))
      ),
      syncStamp
    ]
  );
  await sql`
    UPDATE shopify_collective_inventory_state
    SET is_active = FALSE,
        updated_at = now()
    WHERE is_active = TRUE
    AND last_seen_at < ${syncStamp}
  `;
}

async function getCatalogMatches(records) {
  const skus = records.map((record) => normalizeSku(record.sku)).filter(Boolean);

  if (skus.length === 0) {
    return [];
  }

  const sql = getSql();
  const rows = await sql.query(
    `
      SELECT product_id, sku
      FROM catalog_products
      WHERE upper(sku) IN (
        SELECT upper(jsonb_array_elements_text($1::jsonb))
      )
      AND lower(COALESCE(state, 'active')) = 'active'
    `,
    [JSON.stringify(skus)]
  );
  const recordBySku = new Map(
    records.map((record) => [normalizeSku(record.sku).toUpperCase(), record])
  );

  return rows
    .map((row) => ({
      ...row,
      collective: recordBySku.get(normalizeSku(row.sku).toUpperCase())
    }))
    .filter((row) => row.collective);
}

async function getVendorProducts(productIds) {
  if (productIds.length === 0) {
    return [];
  }

  const sql = getSql();

  return sql.query(
    `
      SELECT
        vp.vendor_product_id,
        vp.vendor_id,
        vp.product_id,
        vp.sku AS vendor_sku,
        vp.label,
        vp.quantity,
        vp.status,
        vp.price,
        p.sku AS product_sku
      FROM catalog_vendor_products vp
      JOIN catalog_products p ON p.product_id = vp.product_id
      WHERE vp.product_id IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
    `,
    [JSON.stringify(productIds)]
  );
}

async function updateSkuNexusVendorProduct(vendorProduct, quantity) {
  const productSku = normalizeSku(
    vendorProduct.vendor_sku || vendorProduct.product_sku || vendorProduct.label
  );
  const payload = cleanPayload({
    product_id: vendorProduct.product_id,
    sku: productSku,
    label: vendorProduct.label || productSku,
    quantity,
    price:
      vendorProduct.price === null || vendorProduct.price === undefined
        ? undefined
        : Number(vendorProduct.price),
    status:
      vendorProduct.status === null || vendorProduct.status === undefined
        ? undefined
        : Number(vendorProduct.status)
  });

  await skunexus.rest(
    `/vendors/${encodeURIComponent(vendorProduct.vendor_id)}/products/${encodeURIComponent(
      vendorProduct.vendor_product_id
    )}`,
    {
      method: "PUT",
      body: payload
    }
  );

  return {
    vendorProductId: vendorProduct.vendor_product_id,
    quantity
  };
}

async function updateLocalVendorQuantities(updates) {
  const sql = getSql();

  for (const quantity of [disabledVendorStockQuantity, enabledVendorStockQuantity]) {
    const vendorProductIds = updates
      .filter((update) => update.quantity === quantity)
      .map((update) => update.vendorProductId);

    if (vendorProductIds.length === 0) {
      continue;
    }

    await sql.query(
      `
        UPDATE catalog_vendor_products
        SET quantity = $2,
            last_synced_at = now()
        WHERE vendor_product_id IN (
          SELECT jsonb_array_elements_text($1::jsonb)
        )
      `,
      [JSON.stringify(vendorProductIds), quantity]
    );
  }
}

async function getStatesForProductIds(productIds) {
  const safeProductIds = Array.from(
    new Set((productIds || []).map((value) => String(value || "").trim()).filter(Boolean))
  );

  if (safeProductIds.length === 0) {
    return [];
  }

  await initializeSchema();
  const sql = getSql();

  return sql.query(
    `
      SELECT
        p.product_id,
        p.sku,
        state.inventory_quantity,
        state.inventory_policy,
        state.availability_status,
        state.last_seen_at
      FROM catalog_products p
      JOIN shopify_collective_inventory_state state
        ON upper(state.sku) = upper(p.sku)
      WHERE p.product_id IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
      AND state.is_active = TRUE
    `,
    [JSON.stringify(safeProductIds)]
  );
}

async function syncCollectiveInventory({ reason = "manual", dryRun = false } = {}) {
  const syncStamp = new Date().toISOString();
  const records = await shopifyService.getTrackedCollectiveInventory();

  if (records.length === 0) {
    throw new Error(
      "Shopify returned no active, tracked Collective inventory. The existing Collective state was left unchanged."
    );
  }

  const catalogMatches = await getCatalogMatches(records);
  const matchedSkuKeys = new Set(
    catalogMatches.map((row) => normalizeSku(row.collective.sku).toUpperCase())
  );
  const unmatched = records.filter(
    (record) => !matchedSkuKeys.has(normalizeSku(record.sku).toUpperCase())
  );
  const matchedRecords = records.filter((record) =>
    matchedSkuKeys.has(normalizeSku(record.sku).toUpperCase())
  );
  const vendorProducts = await getVendorProducts(
    catalogMatches.map((row) => row.product_id)
  );
  const collectiveByProductId = new Map(
    catalogMatches.map((row) => [row.product_id, row.collective])
  );
  const vendorUpdates = vendorProducts
    .map((vendorProduct) => {
      const collective = collectiveByProductId.get(vendorProduct.product_id);
      const quantity = Number(collective?.inventoryQuantity || 0) > 0
        ? enabledVendorStockQuantity
        : disabledVendorStockQuantity;

      return {
        ...vendorProduct,
        desiredQuantity: quantity
      };
    })
    .filter(
      (vendorProduct) =>
        (Number(vendorProduct.quantity || 0) > 0) !==
        (vendorProduct.desiredQuantity > 0)
    );
  const currentAvailabilityBySku =
    await shopifyAvailabilityStateService.getAvailabilityStatusesForSkus(
      catalogMatches.map((row) => row.sku)
    );
  const availabilityUpdates = catalogMatches
    .map((row) => ({
      sku: row.sku,
      availability: row.collective.availability
    }))
    .filter(
      (record) => currentAvailabilityBySku.get(record.sku) !== record.availability
    );
  let vendorUpdateResults = [];
  let shopifyMetafields = {
    requested: matchedRecords.filter((record) => record.availabilityMetafieldMismatch)
      .length,
    updated: 0,
    variantMetafields: 0
  };

  if (!dryRun) {
    await upsertCollectiveInventoryState(records, syncStamp);
    await shopifyAvailabilityStateService.setAvailabilityStatuses(availabilityUpdates);
    vendorUpdateResults = await mapWithConcurrency(
      vendorUpdates,
      skuNexusUpdateConcurrency,
      (vendorProduct) =>
        updateSkuNexusVendorProduct(vendorProduct, vendorProduct.desiredQuantity)
    );
    await updateLocalVendorQuantities(
      vendorUpdateResults.filter((result) => result.ok).map((result) => result.value)
    );
    shopifyMetafields = await shopifyService.syncCollectiveAvailabilityMetafields(
      matchedRecords
    );
  } else {
    shopifyMetafields = await shopifyService.syncCollectiveAvailabilityMetafields(
      matchedRecords,
      { dryRun: true }
    );
  }

  const failedVendorUpdates = vendorUpdateResults
    .map((result, index) => ({ result, vendorProduct: vendorUpdates[index] }))
    .filter(({ result }) => !result.ok);

  return {
    reason,
    dryRun,
    syncedAt: syncStamp,
    requested: records.length,
    matched: catalogMatches.length,
    unmatched: unmatched.length,
    unmatchedSkus: unmatched.slice(0, 25).map((record) => record.sku),
    availability: {
      inStock: records.filter((record) => record.availability === "in_stock").length,
      backordered: records.filter((record) => record.availability === "backordered").length,
      outOfStock: records.filter((record) => record.availability === "out_of_stock").length,
      stateUpdates: availabilityUpdates.length
    },
    shopifyMetafields,
    vendorProducts: {
      assigned: vendorProducts.length,
      requestedUpdates: vendorUpdates.length,
      updated: dryRun
        ? 0
        : vendorUpdateResults.filter((result) => result.ok).length,
      failed: dryRun ? 0 : failedVendorUpdates.length,
      failureSamples: failedVendorUpdates.slice(0, 25).map(({ result, vendorProduct }) => ({
        sku: vendorProduct.product_sku,
        vendorProductId: vendorProduct.vendor_product_id,
        error: String(result.error?.message || result.error || "Update failed.")
      }))
    }
  };
}

module.exports = {
  getStatesForProductIds,
  initializeSchema,
  syncCollectiveInventory
};
