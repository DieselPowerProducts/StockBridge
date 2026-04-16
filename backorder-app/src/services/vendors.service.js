const database = require("../db/database");

function listVendors() {
  return database.all(`
    SELECT
      vendor,
      COUNT(*) as productCount,
      SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) as availableCount,
      SUM(CASE WHEN status = 'Backordered' THEN 1 ELSE 0 END) as backorderedCount
    FROM backorders
    WHERE vendor IS NOT NULL AND TRIM(vendor) != ''
    GROUP BY vendor
    ORDER BY vendor COLLATE NOCASE
  `);
}

function listVendorBackorders(vendor) {
  return database.all(
    `
      SELECT id, sku, vendor, status, updated_at
      FROM backorders
      WHERE vendor = ?
      ORDER BY sku COLLATE NOCASE
    `,
    [vendor]
  );
}

module.exports = {
  listVendors,
  listVendorBackorders
};
