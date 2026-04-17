const express = require("express");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.get("/auth/me", authController.getSession);
router.post("/auth/google", authController.signInWithGoogle);
router.post("/auth/logout", authController.logout);

module.exports = router;
