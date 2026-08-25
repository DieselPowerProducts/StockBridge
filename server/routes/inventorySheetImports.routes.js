const express = require("express");
const controller = require("../controllers/inventorySheetImports.controller");

const router = express.Router();

router.get("/inventory-sheet-imports", controller.listImports);
router.get("/inventory-sheet-imports/:importId", controller.getImport);
router.post("/inventory-sheet-imports/:importId/approve", controller.approveImport);
router.post("/inventory-sheet-imports/:importId/reject", controller.rejectImport);
router.post("/inventory-sheet-imports/:importId/retry", controller.retryImport);
router.put("/inventory-sheet-imports/:importId/mapping", controller.updateMapping);
router.put(
  "/inventory-sheet-imports/:importId/rows/:rowNumber",
  controller.updateRowSelection
);

module.exports = router;
