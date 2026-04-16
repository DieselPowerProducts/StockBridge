const fs = require("fs");
const multer = require("multer");
const { uploadsDir } = require("../config/paths");

fs.mkdirSync(uploadsDir, { recursive: true });

module.exports = multer({ dest: uploadsDir });
