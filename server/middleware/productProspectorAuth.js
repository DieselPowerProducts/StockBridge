const crypto = require("crypto");

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(value) {
  const authorization = String(value || "").trim();
  const separatorIndex = authorization.indexOf(" ");

  if (separatorIndex < 1) {
    return "";
  }

  const scheme = authorization.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== "bearer") {
    return "";
  }

  return authorization.slice(separatorIndex + 1).trim();
}

function requireProductProspectorApiKey(req, res, next) {
  const configuredKey = String(process.env.PRODUCT_PROSPECTOR_API_KEY || "").trim();
  if (!configuredKey) {
    res.status(503).send({ message: "Product Prospector integration is not configured." });
    return;
  }

  const authorization = String(req.get("authorization") || "");
  const providedKey = readBearerToken(authorization);
  if (!providedKey || !safeEqual(configuredKey, providedKey)) {
    res.status(401).send({ message: "Invalid Product Prospector API key." });
    return;
  }

  next();
}

module.exports = { readBearerToken, requireProductProspectorApiKey, safeEqual };
