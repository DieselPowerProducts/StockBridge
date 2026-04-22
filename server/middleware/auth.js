const authService = require("../services/auth.service");
const usersService = require("../services/users.service");

function requireAuth(req, res, next) {
  const user = authService.getCurrentUser(req);

  if (!user) {
    res.status(401).send({ message: "Sign in to continue." });
    return;
  }

  req.user = user;
  void usersService.registerAuthenticatedUser(user).catch((error) => {
    console.error("Unable to sync authenticated user.", error);
  });
  next();
}

module.exports = {
  requireAuth
};
