const { run } = require("./database");

async function initializeSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS backorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE,
      vendor TEXT,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'Pending',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = {
  initializeSchema
};
