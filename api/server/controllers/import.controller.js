const importCsvService = require("../services/importCsv.service");

async function importBackorders(req, res, next) {
  if (!req.file) {
    res.status(400).send({ message: "CSV file is required." });
    return;
  }

  try {
    const items = await importCsvService.parseBackordersCsv(req.file.path);
    const imported = await importCsvService.importBackorders(items);

    res.send({
      message: "Import complete",
      imported
    });
  } catch (err) {
    next(err);
  } finally {
    importCsvService.removeUploadedFile(req.file.path);
  }
}

module.exports = {
  importBackorders
};
