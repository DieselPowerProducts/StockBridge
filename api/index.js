const app = require("../backorder-app/src/app");
const { initializeSchema } = require("../backorder-app/src/db/schema");

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
