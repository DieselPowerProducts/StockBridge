const backordersService = require("../services/backorders.service");

async function listBackorders(req, res, next) {
  try {
    const result = await backordersService.listBackorders(req.query);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const result = await backordersService.updateStatus(req.params.id, req.body.status);
    res.send({ updated: result.changes });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listBackorders,
  updateStatus
};
