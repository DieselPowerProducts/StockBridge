const { getSql } = require("../db/neon");

const availabilityStatuses = new Set([
  "in_stock",
  "out_of_stock",
  "backordered",
  "built_to_order"
]);

let schemaReady;

function normalizeSku(value) {
  return String(value || "").trim();
}

function normalizeAvailabilityStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return availabilityStatuses.has(normalized) ? normalized : "";
}

function normalizeBuildToOrderLeadTime(value) {
  const safeValue = String(value || "").trim();

  if (safeValue.length > 120) {
    const error = new Error("Built to order lead time must be 120 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }

  return safeValue;
}

function assertSku(sku) {
  if (!normalizeSku(sku)) {
    const error = new Error("Product SKU is required.");
    error.statusCode = 400;
    throw error;
  }
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS product_shopify_availability_state (
          sku TEXT PRIMARY KEY,
          availability_status TEXT NOT NULL,
          build_to_order_lead_time TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE product_shopify_availability_state
        ADD COLUMN IF NOT EXISTS build_to_order_lead_time TEXT NOT NULL DEFAULT ''
      `;
    })();
  }

  return schemaReady;
}

async function getAvailabilityStatusForSku(sku) {
  assertSku(sku);
  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const rows = await sql`
    SELECT availability_status
    FROM product_shopify_availability_state
    WHERE sku = ${safeSku}
    LIMIT 1
  `;

  return normalizeAvailabilityStatus(rows[0]?.availability_status);
}

async function getBuildToOrderLeadTimeForSku(sku) {
  assertSku(sku);
  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const rows = await sql`
    SELECT build_to_order_lead_time
    FROM product_shopify_availability_state
    WHERE sku = ${safeSku}
    LIMIT 1
  `;

  return String(rows[0]?.build_to_order_lead_time || "").trim();
}

async function getBuildToOrderLeadTimesForSkus(skus) {
  const safeSkus = Array.from(
    new Set((skus || []).map(normalizeSku).filter(Boolean))
  );

  if (safeSkus.length === 0) {
    return new Map();
  }

  await initializeSchema();

  const sql = getSql();
  const skuJson = JSON.stringify(safeSkus);
  const rows = await sql.query(
    `
      SELECT sku, build_to_order_lead_time
      FROM product_shopify_availability_state
      WHERE sku IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
    `,
    [skuJson]
  );

  return new Map(
    rows
      .map((row) => [
        normalizeSku(row?.sku),
        String(row?.build_to_order_lead_time || "").trim()
      ])
      .filter(([sku, leadTime]) => sku && leadTime)
  );
}

async function getAvailabilityStatusesForSkus(skus) {
  const safeSkus = Array.from(
    new Set((skus || []).map(normalizeSku).filter(Boolean))
  );

  if (safeSkus.length === 0) {
    return new Map();
  }

  await initializeSchema();

  const sql = getSql();
  const skuJson = JSON.stringify(safeSkus);
  const rows = await sql.query(
    `
      SELECT sku, availability_status
      FROM product_shopify_availability_state
      WHERE sku IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
    `,
    [skuJson]
  );

  return new Map(
    rows
      .map((row) => [
        normalizeSku(row?.sku),
        normalizeAvailabilityStatus(row?.availability_status)
      ])
      .filter(([sku, availability]) => sku && availability)
  );
}

async function setAvailabilityStatus({
  sku,
  availability,
  buildToOrderLeadTime
}) {
  assertSku(sku);
  const safeAvailability = normalizeAvailabilityStatus(availability);
  const shouldUpdateLeadTime = buildToOrderLeadTime !== undefined;
  const safeBuildToOrderLeadTime = shouldUpdateLeadTime
    ? normalizeBuildToOrderLeadTime(buildToOrderLeadTime)
    : "";

  if (!safeAvailability) {
    const error = new Error("Shopify availability status is invalid.");
    error.statusCode = 400;
    throw error;
  }

  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const rows = await sql`
    INSERT INTO product_shopify_availability_state (
      sku,
      availability_status,
      build_to_order_lead_time
    )
    VALUES (
      ${safeSku},
      ${safeAvailability},
      ${safeBuildToOrderLeadTime}
    )
    ON CONFLICT (sku) DO UPDATE
    SET availability_status = EXCLUDED.availability_status,
        build_to_order_lead_time =
          CASE
            WHEN ${shouldUpdateLeadTime}
            THEN EXCLUDED.build_to_order_lead_time
            ELSE product_shopify_availability_state.build_to_order_lead_time
          END,
        updated_at = now()
    RETURNING availability_status
  `;

  return normalizeAvailabilityStatus(rows[0]?.availability_status);
}

async function setAvailabilityStatuses(records) {
  const safeRecords = (records || [])
    .map((record) => {
      const sku = normalizeSku(record?.sku);
      const availabilityStatus = normalizeAvailabilityStatus(
        record?.availability
      );
      const shouldUpdateLeadTime = record?.buildToOrderLeadTime !== undefined;
      const buildToOrderLeadTime = shouldUpdateLeadTime
        ? normalizeBuildToOrderLeadTime(record.buildToOrderLeadTime)
        : "";

      return {
        sku,
        availability_status: availabilityStatus,
        build_to_order_lead_time: buildToOrderLeadTime,
        should_update_lead_time: shouldUpdateLeadTime
      };
    })
    .filter((record) => record.sku && record.availability_status);

  if (safeRecords.length === 0) {
    return [];
  }

  await initializeSchema();

  const sql = getSql();
  const upsertRecords = async (nextRecords, shouldUpdateLeadTime) => {
    if (nextRecords.length === 0) {
      return [];
    }

    return sql.query(
      `
        WITH input_rows AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS row(
            sku TEXT,
            availability_status TEXT,
            build_to_order_lead_time TEXT
          )
        )
        INSERT INTO product_shopify_availability_state (
          sku,
          availability_status,
          build_to_order_lead_time
        )
        SELECT
          sku,
          availability_status,
          build_to_order_lead_time
        FROM input_rows
        ON CONFLICT (sku) DO UPDATE
        SET availability_status = EXCLUDED.availability_status,
            build_to_order_lead_time =
              CASE
                WHEN $2::boolean
                THEN EXCLUDED.build_to_order_lead_time
                ELSE product_shopify_availability_state.build_to_order_lead_time
              END,
            updated_at = now()
        RETURNING sku, availability_status
      `,
      [
        JSON.stringify(
          nextRecords.map((record) => ({
            sku: record.sku,
            availability_status: record.availability_status,
            build_to_order_lead_time: record.build_to_order_lead_time
          }))
        ),
        shouldUpdateLeadTime
      ]
    );
  };
  const rows = [
    ...(await upsertRecords(
      safeRecords.filter((record) => record.should_update_lead_time),
      true
    )),
    ...(await upsertRecords(
      safeRecords.filter((record) => !record.should_update_lead_time),
      false
    ))
  ];

  return rows.map((row) => ({
    sku: normalizeSku(row?.sku),
    availability: normalizeAvailabilityStatus(row?.availability_status)
  }));
}

async function setBuildToOrderLeadTime({ sku, buildToOrderLeadTime }) {
  assertSku(sku);
  const safeBuildToOrderLeadTime =
    normalizeBuildToOrderLeadTime(buildToOrderLeadTime);

  await initializeSchema();

  const sql = getSql();
  const safeSku = normalizeSku(sku);
  const rows = await sql`
    INSERT INTO product_shopify_availability_state (
      sku,
      availability_status,
      build_to_order_lead_time
    )
    VALUES (${safeSku}, 'built_to_order', ${safeBuildToOrderLeadTime})
    ON CONFLICT (sku) DO UPDATE
    SET build_to_order_lead_time = EXCLUDED.build_to_order_lead_time,
        updated_at = now()
    RETURNING build_to_order_lead_time
  `;

  return String(rows[0]?.build_to_order_lead_time || "").trim();
}

module.exports = {
  getAvailabilityStatusForSku,
  getAvailabilityStatusesForSkus,
  getBuildToOrderLeadTimeForSku,
  getBuildToOrderLeadTimesForSkus,
  setAvailabilityStatus,
  setAvailabilityStatuses,
  setBuildToOrderLeadTime
};
