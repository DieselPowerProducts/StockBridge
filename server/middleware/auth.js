const authService = require("../services/auth.service");

function requireAuth(req, res, next) {
  const user = authService.getCurrentUser(req);

  if (!user) {
    res.status(401).send({ message: "Sign in to continue." });
    return;
  }

  req.user = user;
  next();
}

module.exports = {
  requireAuth
};
