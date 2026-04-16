const os = require("os");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..", "..");
const writableDir = process.env.TMPDIR || os.tmpdir();

module.exports = {
  rootDir,
  uploadsDir: path.join(writableDir, "uploads"),
  databasePath: path.join(writableDir, "backorders.db")
};
