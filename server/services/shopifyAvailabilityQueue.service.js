const { getSql } = require("../db/neon");

const defaultDelaySeconds = 30;
const defaultProcessLimit = 100;
const leaseSeconds = 240;
const maximumRetryDelaySeconds = 60 * 60;

let schemaReady;

function normalizeSku(value) {
  return String(value || "").trim();
}

function normalizeSource(value) {
  return String(value || "").trim().slice(0, 200);
}

function assertSku(sku) {
  if (!normalizeSku(sku)) {
    const error = new Error("Product SKU is required.");
    error.statusCode = 400;
    throw error;
  }
}

function getRetryDelaySeconds(attemptCount) {
  const safeAttemptCount = Math.max(Number.parseInt(attemptCount, 10) || 0, 0);

  return Math.min(60 * 2 ** safeAttemptCount, maximumRetryDelaySeconds);
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS shopify_availability_sync_queue (
          sku TEXT PRIMARY KEY,
          process_after TIMESTAMPTZ NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          revision BIGINT NOT NULL DEFAULT 1,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS shopify_availability_sync_queue_due_idx
        ON shopify_availability_sync_queue (process_after)
      `;
    })();
  }

  return schemaReady;
}

async function enqueueAvailabilitySync({
  sku,
  source = "",
  delaySeconds = defaultDelaySeconds
}) {
  assertSku(sku);
  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const safeSource = normalizeSource(source);
  const parsedDelaySeconds = Number.parseInt(delaySeconds, 10);
  const safeDelaySeconds = Math.max(
    Math.min(
      Number.isFinite(parsedDelaySeconds)
        ? parsedDelaySeconds
        : defaultDelaySeconds,
      3600
    ),
    0
  );
  const rows = await sql`
    INSERT INTO shopify_availability_sync_queue (
      sku,
      process_after,
      source
    )
    VALUES (
      ${safeSku},
      now() + (${safeDelaySeconds} * INTERVAL '1 second'),
      ${safeSource}
    )
    ON CONFLICT (sku) DO UPDATE
    SET process_after = EXCLUDED.process_after,
        source = EXCLUDED.source,
        revision = shopify_availability_sync_queue.revision + 1,
        attempt_count = 0,
        locked_until = NULL,
        last_error = '',
        updated_at = now()
    RETURNING sku, process_after, revision
  `;

  return rows[0] || null;
}

async function removeAvailabilitySync(sku) {
  assertSku(sku);
  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const rows = await sql`
    DELETE FROM shopify_availability_sync_queue
    WHERE sku = ${safeSku}
    RETURNING sku
  `;

  return rows.length > 0;
}

async function enqueueNightlyReconciliation() {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO shopify_availability_sync_queue (
      sku,
      process_after,
      source
    )
    SELECT DISTINCT
      product.sku,
      now(),
      'nightly-reconciliation'
    FROM catalog_products AS product
    LEFT JOIN product_shopify_availability_state AS state
      ON lower(state.sku) = lower(product.sku)
    WHERE lower(COALESCE(product.state, 'Active')) = 'active'
      AND (
        state.availability_status <> 'in_stock'
        OR state.updated_at >= now() - INTERVAL '2 days'
        OR product.is_kit = TRUE
        OR (
          EXISTS (
            SELECT 1
            FROM catalog_vendor_products AS assigned_vendor_product
            INNER JOIN catalog_vendors AS assigned_vendor
              ON assigned_vendor.vendor_id = assigned_vendor_product.vendor_id
            WHERE assigned_vendor_product.product_id = product.product_id
              AND assigned_vendor.status >= 2
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalog_vendor_products AS stocked_vendor_product
            INNER JOIN catalog_vendors AS stocked_vendor
              ON stocked_vendor.vendor_id = stocked_vendor_product.vendor_id
            LEFT JOIN vendor_settings AS stocked_vendor_settings
              ON stocked_vendor_settings.vendor_id = stocked_vendor_product.vendor_id
            WHERE stocked_vendor_product.product_id = product.product_id
              AND stocked_vendor.status >= 2
              AND COALESCE(stocked_vendor_settings.built_to_order, FALSE) = FALSE
              AND stocked_vendor_product.quantity > 0
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalog_warehouse_stock AS warehouse_stock
            WHERE warehouse_stock.product_id = product.product_id
              AND warehouse_stock.qty_available > 0
          )
        )
        OR EXISTS (
          SELECT 1
          FROM catalog_vendor_products AS vendor_product
          INNER JOIN catalog_vendors AS vendor
            ON vendor.vendor_id = vendor_product.vendor_id
          INNER JOIN vendor_settings AS settings
            ON settings.vendor_id = vendor_product.vendor_id
          WHERE vendor_product.product_id = product.product_id
            AND vendor.status >= 2
            AND settings.built_to_order = TRUE
        )
      )
    ON CONFLICT (sku) DO NOTHING
    RETURNING sku
  `;

  return {
    queued: rows.length
  };
}

async function claimDueAvailabilitySyncs(limit = defaultProcessLimit) {
  await initializeSchema();

  const sql = getSql();
  const safeLimit = Math.max(Math.min(Number.parseInt(limit, 10) || 1, 250), 1);

  return sql.query(
    `
      WITH due AS (
        SELECT sku, revision
        FROM shopify_availability_sync_queue
        WHERE process_after <= now()
          AND (locked_until IS NULL OR locked_until <= now())
        ORDER BY process_after, sku
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE shopify_availability_sync_queue AS queue
      SET locked_until = now() + ($2 * INTERVAL '1 second'),
          updated_at = now()
      FROM due
      WHERE queue.sku = due.sku
        AND queue.revision = due.revision
      RETURNING
        queue.sku,
        queue.revision,
        queue.attempt_count,
        queue.source
    `,
    [safeLimit, leaseSeconds]
  );
}

async function completeAvailabilitySyncs(records) {
  const safeRecords = (records || [])
    .map((record) => ({
      sku: normalizeSku(record?.sku),
      revision: Number(record?.revision)
    }))
    .filter((record) => record.sku && Number.isFinite(record.revision));

  if (safeRecords.length === 0) {
    return 0;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql.query(
    `
      WITH completed AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS row(
          sku TEXT,
          revision BIGINT
        )
      )
      DELETE FROM shopify_availability_sync_queue AS queue
      USING completed
      WHERE queue.sku = completed.sku
        AND queue.revision = completed.revision
      RETURNING queue.sku
    `,
    [JSON.stringify(safeRecords)]
  );

  return rows.length;
}

async function retryAvailabilitySyncs(records, errorMessage) {
  const safeErrorMessage = String(errorMessage || "Shopify availability sync failed.")
    .trim()
    .slice(0, 1000);
  const safeRecords = (records || [])
    .map((record) => ({
      sku: normalizeSku(record?.sku),
      revision: Number(record?.revision),
      retry_delay_seconds: getRetryDelaySeconds(record?.attempt_count)
    }))
    .filter((record) => record.sku && Number.isFinite(record.revision));

  if (safeRecords.length === 0) {
    return 0;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql.query(
    `
      WITH failed AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS row(
          sku TEXT,
          revision BIGINT,
          retry_delay_seconds INTEGER
        )
      )
      UPDATE shopify_availability_sync_queue AS queue
      SET process_after = now() + (failed.retry_delay_seconds * INTERVAL '1 second'),
          attempt_count = queue.attempt_count + 1,
          locked_until = NULL,
          last_error = $2,
          updated_at = now()
      FROM failed
      WHERE queue.sku = failed.sku
        AND queue.revision = failed.revision
      RETURNING queue.sku
    `,
    [JSON.stringify(safeRecords), safeErrorMessage]
  );

  return rows.length;
}

async function processDueAvailabilitySyncs({ limit = defaultProcessLimit } = {}) {
  const claimed = await claimDueAvailabilitySyncs(limit);

  if (claimed.length === 0) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      retried: 0
    };
  }

  try {
    const catalogService = require("./catalog.service");
    const result = await catalogService.syncShopifyAvailabilityForSkus(
      claimed.map((record) => record.sku),
      { source: "durable-availability-queue" }
    );
    const failuresBySku = new Map(
      (result.failures || []).map((failure) => [
        normalizeSku(failure?.sku),
        String(failure?.error || "Shopify variant could not be matched.")
      ])
    );
    const completedRecords = claimed.filter(
      (record) => !failuresBySku.has(normalizeSku(record.sku))
    );
    const failedRecords = claimed.filter((record) =>
      failuresBySku.has(normalizeSku(record.sku))
    );
    const unmatchedRecords = failedRecords.filter(
      (record) =>
        failuresBySku.get(normalizeSku(record.sku)) ===
        "No Shopify variants matched this SKU."
    );
    const retryableRecords = failedRecords.filter(
      (record) => !unmatchedRecords.includes(record)
    );
    const completed = await completeAvailabilitySyncs([
      ...completedRecords,
      ...unmatchedRecords
    ]);
    let retried = 0;

    for (const record of retryableRecords) {
      retried += await retryAvailabilitySyncs(
        [record],
        failuresBySku.get(normalizeSku(record.sku))
      );
    }

    return {
      claimed: claimed.length,
      completed,
      failed: failedRecords.length,
      unmatched: unmatchedRecords.length,
      retried,
      shopify: result
    };
  } catch (error) {
    await retryAvailabilitySyncs(
      claimed,
      String(error?.message || error || "Shopify availability sync failed.")
    );
    throw error;
  }
}

module.exports = {
  enqueueAvailabilitySync,
  enqueueNightlyReconciliation,
  getRetryDelaySeconds,
  processDueAvailabilitySyncs,
  removeAvailabilitySync
};
