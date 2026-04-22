const authService = require("../services/auth.service");
const usersService = require("../services/users.service");

async function signInWithGoogle(req, res, next) {
  try {
    const user = await authService.verifyGoogleCredential(req.body.credential);
    await usersService.upsertUser(user);
    authService.setSessionCookie(req, res, user);
    res.send({ user });
  } catch (err) {
    next(err);
  }
}

async function getSession(req, res, next) {
  try {
    const user = authService.getCurrentUser(req);

    if (!user) {
      res.status(401).send({ message: "Sign in to continue." });
      return;
    }

    await usersService.upsertUser(user);
    res.send({ user });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  authService.clearSessionCookie(req, res);
  res.send({ ok: true });
}

module.exports = {
  getSession,
  logout,
  signInWithGoogle
};
