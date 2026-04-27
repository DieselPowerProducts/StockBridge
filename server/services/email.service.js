const nodemailer = require("nodemailer");
const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

let transporter;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getBooleanEnv(value, fallback) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function assertRequiredText(value, message) {
  const normalized = normalizeText(value);

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function getMailConfig() {
  const user = normalizeText(process.env.GMAIL_USER);
  const pass = normalizeText(process.env.GMAIL_APP_PASSWORD);
  const missing = [
    ["GMAIL_USER", user],
    ["GMAIL_APP_PASSWORD", pass]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const error = new Error(`Missing Gmail configuration: ${missing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }

  const port = Number.parseInt(process.env.GMAIL_SMTP_PORT || "465", 10);

  return {
    host: normalizeText(process.env.GMAIL_SMTP_HOST) || "smtp.gmail.com",
    port: Number.isFinite(port) ? port : 465,
    secure: getBooleanEnv(process.env.GMAIL_SMTP_SECURE, port === 465),
    user,
    pass,
    fromEmail: normalizeText(process.env.GMAIL_FROM_EMAIL) || user,
    fromName: normalizeText(process.env.GMAIL_FROM_NAME) || "StockBridge"
  };
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const config = getMailConfig();

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return transporter;
}

async function sendVendorStockCheckEmail({ to, subject, body }, sender = {}) {
  const safeTo = normalizeEmail(to);
  const safeSubject = assertRequiredText(subject, "Email subject is required.");
  const safeBody = assertRequiredText(body, "Email message is required.");

  if (!isValidEmail(safeTo)) {
    const error = new Error("A valid recipient email is required.");
    error.statusCode = 400;
    throw error;
  }

  const config = getMailConfig();
  const result = await getTransporter().sendMail({
    from: `${config.fromName} <${config.fromEmail}>`,
    to: safeTo,
    replyTo: isValidEmail(sender?.email) ? normalizeEmail(sender.email) : undefined,
    subject: safeSubject,
    text: safeBody,
    html: textToHtml(safeBody)
  });

  return {
    messageId: result.messageId || "",
    accepted: result.accepted || []
  };
}

module.exports = {
  sendVendorStockCheckEmail
};
