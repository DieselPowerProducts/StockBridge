const { getSql } = require("../db/neon");

let schemaReady;

function normalizeSku(sku) {
  return String(sku || "").trim();
}

function assertSku(sku) {
  if (!normalizeSku(sku)) {
    const error = new Error("SKU is required.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeDate(value) {
  const dateText = String(value || "").trim();

  if (!dateText) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    const error = new Error("Follow-up date must use YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }

  const date = new Date(`${dateText}T00:00:00Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
    const error = new Error("Follow-up date is invalid.");
    error.statusCode = 400;
    throw error;
  }

  return dateText;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS product_follow_ups (
          sku TEXT PRIMARY KEY,
          follow_up_date DATE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS product_follow_ups_date_idx
        ON product_follow_ups (follow_up_date)
      `;
    })();
  }

  return schemaReady;
}

async function getFollowUpsForSkus(skus) {
  const normalizedSkus = Array.from(
    new Set((skus || []).map(normalizeSku).filter(Boolean))
  );

  if (normalizedSkus.length === 0) {
    return new Map();
  }

  await initializeSchema();

  const sql = getSql();
  const skuJson = JSON.stringify(normalizedSkus);
  const rows = await sql`
    SELECT sku, follow_up_date::text AS follow_up_date
    FROM product_follow_ups
    WHERE sku IN (
      SELECT jsonb_array_elements_text(${skuJson}::jsonb)
    )
  `;

  return new Map(
    rows.map((row) => [row.sku, formatDate(row.follow_up_date)])
  );
}

async function getFollowUpForSku(sku) {
  assertSku(sku);

  const followUps = await getFollowUpsForSkus([sku]);

  return followUps.get(normalizeSku(sku)) || "";
}

async function setFollowUp({ sku, followUpDate }) {
  assertSku(sku);
  await initializeSchema();

  const safeSku = normalizeSku(sku);
  const safeDate = normalizeDate(followUpDate);
  const sql = getSql();

  if (!safeDate) {
    await sql`
      DELETE FROM product_follow_ups
      WHERE sku = ${safeSku}
    `;

    return {
      sku: safeSku,
      followUpDate: ""
    };
  }

  const rows = await sql`
    INSERT INTO product_follow_ups (sku, follow_up_date)
    VALUES (${safeSku}, ${safeDate})
    ON CONFLICT (sku) DO UPDATE
    SET follow_up_date = EXCLUDED.follow_up_date,
        updated_at = now()
    RETURNING sku, follow_up_date::text AS follow_up_date
  `;

  return {
    sku: rows[0]?.sku || safeSku,
    followUpDate: formatDate(rows[0]?.follow_up_date || safeDate)
  };
}

module.exports = {
  getFollowUpForSku,
  getFollowUpsForSkus,
  setFollowUp
};
