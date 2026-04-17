const authService = require("../services/auth.service");

async function signInWithGoogle(req, res, next) {
  try {
    const user = await authService.verifyGoogleCredential(req.body.credential);
    authService.setSessionCookie(req, res, user);
    res.send({ user });
  } catch (err) {
    next(err);
  }
}

function getSession(req, res) {
  const user = authService.getCurrentUser(req);

  if (!user) {
    res.status(401).send({ message: "Sign in to continue." });
    return;
  }

  res.send({ user });
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
