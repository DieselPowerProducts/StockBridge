// Express currently depends on parseurl, which emits url.parse() deprecation
// warnings under newer Node runtimes and makes successful requests look noisy in
// Vercel's error charts.
process.noDeprecation = true;

const app = require("../server/app");
const { initializeSchema } = require("../server/db/schema");

let schemaReady;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = initializeSchema();
  }

  return schemaReady;
}

module.exports = async function handler(req, res) {
  await ensureSchema();
  return app(req, res);
};
