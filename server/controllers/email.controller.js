const emailService = require("../services/email.service");
const emailTemplatesService = require("../services/emailTemplates.service");
const vendorsService = require("../services/vendors.service");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function listTemplates(req, res, next) {
  try {
    const templates = await emailTemplatesService.listTemplates();
    res.send(templates);
  } catch (err) {
    next(err);
  }
}

async function saveTemplate(req, res, next) {
  try {
    const template = await emailTemplatesService.saveTemplate(req.body);
    res.send(template);
  } catch (err) {
    next(err);
  }
}

async function sendVendorStockCheck(req, res, next) {
  try {
    const vendorId = String(req.body?.vendorId || "").trim();
    const to = normalizeEmail(req.body?.to);
    const contacts = await vendorsService.listVendorContacts(vendorId);
    const isVendorContact = contacts.some(
      (contact) => normalizeEmail(contact.email) === to
    );

    if (!isVendorContact) {
      const error = new Error("Choose a valid contact for this vendor.");
      error.statusCode = 400;
      throw error;
    }

    const result = await emailService.sendVendorStockCheckEmail(req.body, req.user);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTemplates,
  saveTemplate,
  sendVendorStockCheck
};
