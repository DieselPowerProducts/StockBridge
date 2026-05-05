const authService = require("../services/auth.service");
const usersService = require("../services/users.service");

async function syncAuthenticatedUser(user, context) {
  try {
    await usersService.upsertUser(user);
  } catch (error) {
    console.warn(`Unable to sync authenticated user during ${context}.`, {
      email: user?.email || "",
      error
    });
  }
}

async function signInWithGoogle(req, res, next) {
  try {
    const user = await authService.verifyGoogleCredential(req.body.credential);
    await syncAuthenticatedUser(user, "sign-in");
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

    await syncAuthenticatedUser(user, "session check");
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
