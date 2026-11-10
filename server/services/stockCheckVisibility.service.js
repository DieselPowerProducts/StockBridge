const { getSql } = require('../db/neon');

let schemaReady;

function normalizeSku(sku) {
  return String(sku || '').trim().toUpperCase();
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = getSql().query(`
      CREATE TABLE IF NOT EXISTS stock_check_hidden_products (
        sku TEXT PRIMARY KEY,
        hidden_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function getHiddenSkuSet() {
  await initializeSchema();
  const rows = await getSql().query('SELECT sku FROM stock_check_hidden_products');
  return new Set(rows.map((row) => normalizeSku(row.sku)));
}

async function isHidden(sku) {
  const normalized = normalizeSku(sku);
  if (!normalized) return false;
  await initializeSchema();
  const rows = await getSql().query(
    'SELECT 1 FROM stock_check_hidden_products WHERE sku = $1 LIMIT 1',
    [normalized]
  );
  return rows.length > 0;
}

async function setHidden(sku, hidden) {
  const normalized = normalizeSku(sku);
  if (!normalized) {
    const error = new Error('Product SKU is required.');
    error.statusCode = 400;
    throw error;
  }
  if (typeof hidden !== 'boolean') {
    const error = new Error('Hidden must be a boolean.');
    error.statusCode = 400;
    throw error;
  }
  await initializeSchema();
  if (hidden) {
    await getSql().query(
      'INSERT INTO stock_check_hidden_products (sku) VALUES ($1) ON CONFLICT (sku) DO NOTHING',
      [normalized]
    );
  } else {
    await getSql().query('DELETE FROM stock_check_hidden_products WHERE sku = $1', [normalized]);
  }
  return { sku: normalized, hiddenFromStockCheck: hidden };
}

module.exports = { getHiddenSkuSet, isHidden, setHidden };
