const packingListsService = require("../services/packingLists.service");

async function createReport(req, res, next) {
  try {
    res.send(await packingListsService.createPackingListReport(req.body));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createReport
};
