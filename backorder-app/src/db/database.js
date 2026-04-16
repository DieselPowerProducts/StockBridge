const { databasePath } = require("../config/paths");

if (process.env.VERCEL && !process.env.DATABASE_PATH) {
  module.exports = require("./memoryDatabase");
} else {
  const sqlite3 = require("sqlite3").verbose();
  const db = new sqlite3.Database(databasePath);

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          id: this.lastID,
          changes: this.changes
        });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(row);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(rows);
      });
    });
  }

  module.exports = {
    db,
    run,
    get,
    all
  };
}
