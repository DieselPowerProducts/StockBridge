const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const sessionCookieName = "stockbridge_session";
const sessionMaxAgeSeconds = 60 * 60 * 12;
const googleClient = new OAuth2Client();

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSessionSecret() {
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw createHttpError(500, "SESSION_SECRET is not configured.");
  }

  return sessionSecret;
}

function encodeBase64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload) {
  return encodeBase64Url(
    crypto.createHmac("sha256", getSessionSecret()).update(payload).digest()
  );
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture,
      hd: user.hd,
      iat: now,
      exp: now + sessionMaxAgeSeconds
    })
  );
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature || !constantTimeEquals(signature, signPayload(payload))) {
    return null;
  }

  try {
    const data = JSON.parse(decodeBase64Url(payload));
    const now = Math.floor(Date.now() / 1000);

    if (!data.sub || !data.email || !data.exp || data.exp <= now) {
      return null;
    }

    return {
      sub: data.sub,
      email: data.email,
      name: data.name || data.email,
      picture: data.picture || "",
      hd: data.hd || ""
    };
  } catch (err) {
    return null;
  }
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return "";
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return "";
      }
    }
  }

  return "";
}

function shouldUseSecureCookie(req) {
  return Boolean(
    process.env.VERCEL ||
      process.env.NODE_ENV === "production" ||
      req.headers["x-forwarded-proto"] === "https"
  );
}

function serializeCookie(req, value, maxAgeSeconds) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (shouldUseSecureCookie(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

async function verifyGoogleCredential(credential) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;

  if (!googleClientId) {
    throw createHttpError(500, "GOOGLE_CLIENT_ID is not configured.");
  }

  if (!credential) {
    throw createHttpError(400, "Missing Google credential.");
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    payload = ticket.getPayload();
  } catch (err) {
    throw createHttpError(401, "Unable to verify Google account.");
  }

  if (!payload || !payload.sub || !payload.email || !payload.email_verified) {
    throw createHttpError(401, "Unable to verify Google account.");
  }

  const allowedDomain = (process.env.ALLOWED_GOOGLE_DOMAIN || "")
    .trim()
    .toLowerCase();
  const hostedDomain = (payload.hd || "").toLowerCase();

  if (allowedDomain && hostedDomain !== allowedDomain) {
    throw createHttpError(403, "Use your company Google account to sign in.");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || "",
    hd: payload.hd || ""
  };
}

function getCurrentUser(req) {
  return verifySessionToken(getCookie(req, sessionCookieName));
}

function setSessionCookie(req, res, user) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(req, createSessionToken(user), sessionMaxAgeSeconds)
  );
}

function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", serializeCookie(req, "", 0));
}

module.exports = {
  clearSessionCookie,
  getCurrentUser,
  setSessionCookie,
  verifyGoogleCredential
};
