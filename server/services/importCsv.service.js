const fs = require("fs");
const csv = require("csv-parser");
const database = require("../db/database");

function parseBackordersCsv(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => {
        results.push({
          sku: data["Variant SKU"]?.trim(),
          vendor: data.Vendor?.trim()
        });
      })
      .on("error", reject)
      .on("end", () => resolve(results));
  });
}

async function importBackorders(items) {
  let imported = 0;

  for (const item of items) {
    if (!item.sku) {
      continue;
    }

    await database.run(
      `
        INSERT INTO backorders (sku, vendor)
        VALUES (?, ?)
        ON CONFLICT(sku) DO UPDATE SET
          vendor = excluded.vendor,
          updated_at = CURRENT_TIMESTAMP
      `,
      [item.sku, item.vendor]
    );

    imported += 1;
  }

  return imported;
}

function removeUploadedFile(filePath) {
  fs.unlink(filePath, () => {});
}

module.exports = {
  parseBackordersCsv,
  importBackorders,
  removeUploadedFile
};
