const path = require("path");

const rootDir = path.join(__dirname, "..", "..");

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  uploadsDir: path.join(rootDir, "uploads"),
  databasePath: path.join(rootDir, "backorders.db")
};
