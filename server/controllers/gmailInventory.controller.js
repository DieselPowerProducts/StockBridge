const gmailInventoryService = require("../services/gmailInventory.service");

function startOAuth(req, res, next) {
  try {
    res.redirect(gmailInventoryService.getAuthorizationUrl(req.user));
  } catch (error) {
    next(error);
  }
}

async function completeOAuth(req, res, next) {
  try {
    const result = await gmailInventoryService.completeOAuth({
      code: req.query.code,
      state: req.query.state
    });

    res
      .status(200)
      .type("text")
      .send(`${result.email} is connected to StockBridge. You can close this tab.`);
  } catch (error) {
    next(error);
  }
}

async function receivePush(req, res, next) {
  try {
    const result = await gmailInventoryService.processPushNotification({
      authorizationHeader:
        req.headers.authorization || req.headers.Authorization,
      body: req.body
    });

    console.log("Gmail inventory notification processed.", result);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

async function getStatus(req, res, next) {
  try {
    res.send(await gmailInventoryService.getConnectionStatus());
  } catch (error) {
    next(error);
  }
}

module.exports = {
  completeOAuth,
  getStatus,
  receivePush,
  startOAuth
};
