const inventoryAuditService = require("../services/inventoryAudit.service");

async function listInventoryAudits(req, res, next) {
  try {
    res.send(await inventoryAuditService.listInventoryAudits(req.query));
  } catch (error) {
    next(error);
  }
}

async function deleteInventoryAudit(req, res, next) {
  try {
    res.send(
      await inventoryAuditService.deleteInventoryAudit(req.params.auditId)
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  deleteInventoryAudit,
  listInventoryAudits
};
