const statusService = require("../services/status.service");

async function getVersion(req, res, next) {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    res.send(statusService.getVersionStatus());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVersion
};
