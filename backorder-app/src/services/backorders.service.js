const database = require("../db/database");

async function listBackorders({ page = 1, limit = 50, search = "" }) {
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const offset = (safePage - 1) * safeLimit;
  const searchPattern = `%${search}%`;

  const data = await database.all(
    `
      SELECT * FROM backorders
      WHERE sku LIKE ?
      LIMIT ? OFFSET ?
    `,
    [searchPattern, safeLimit, offset]
  );

  const countRow = await database.get(
    "SELECT COUNT(*) as count FROM backorders WHERE sku LIKE ?",
    [searchPattern]
  );

  return {
    data,
    total: countRow.count
  };
}

async function updateStatus(id, status) {
  return database.run(
    "UPDATE backorders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status, id]
  );
}

module.exports = {
  listBackorders,
  updateStatus
};
