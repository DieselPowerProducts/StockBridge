const express = require("express");
const notificationsController = require("../controllers/notifications.controller");

const router = express.Router();

router.get("/notifications", notificationsController.listNotifications);
router.post("/notifications/:id/read", notificationsController.markNotificationRead);

module.exports = router;
