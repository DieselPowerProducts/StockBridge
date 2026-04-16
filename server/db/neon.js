const { neon } = require("@neondatabase/serverless");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

let sql;

function getSql() {
  if (sql) {
    return sql;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    const error = new Error("Missing DATABASE_URL configuration.");
    error.statusCode = 503;
    throw error;
  }

  sql = neon(databaseUrl);

  return sql;
}

module.exports = {
  getSql
};
