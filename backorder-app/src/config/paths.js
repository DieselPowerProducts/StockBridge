const path = require("path");

const rootDir = path.join(__dirname, "..", "..");
const writableDir = process.env.VERCEL
  ? process.env.TMPDIR || "/tmp"
  : rootDir;

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  uploadsDir: path.join(writableDir, "uploads"),
  databasePath: process.env.DATABASE_PATH || path.join(writableDir, "backorders.db")
};
