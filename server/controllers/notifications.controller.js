const notificationsService = require("../services/notifications.service");

async function listNotifications(req, res, next) {
  try {
    const result = await notificationsService.getNotificationsForUser(req.user.sub);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

async function markNotificationRead(req, res, next) {
  try {
    const result = await notificationsService.markNotificationRead(
      req.params.id,
      req.user.sub
    );
    res.send({ updated: result.changes });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  markNotificationRead
};
