const { randomUUID } = require("node:crypto");
const catalogService = require("./catalog.service");
const emailService = require("./email.service");
const stockCheckEmailsService = require("./stockCheckEmails.service");
const vendorsService = require("./vendors.service");

function text(value) {
  return String(value || "").trim();
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeDate(value) {
  const date = text(value);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest("Enter a valid date range.");
  }
  return date;
}

function selectProductsForDateRange(products, { fromDate, toDate, includeUndated }) {
  const from = normalizeDate(fromDate);
  const to = normalizeDate(toDate);
  if (from && to && from > to) throw badRequest("The start date must be before the end date.");

  return products.filter((product) => {
    const date = text(product.followUpDate);
    if (!date) return includeUndated === true;
    return (!from || date >= from) && (!to || date <= to);
  });
}

function buildBody(message, products) {
  const introduction = text(message) ||
    "Could you please provide availability and estimated ship dates for these parts?";
  return `${introduction}\n\n${products.map((product) => product.sku).join("\n")}\n\nThank you,\nDiesel Power Products`;
}

async function sendBulkStockCheck(input, sender) {
  const vendorId = text(input?.vendorId);
  const recipientEmail = text(input?.to).toLowerCase();
  if (!vendorId) throw badRequest("Choose a brand with an assigned vendor.");
  if (!recipientEmail) throw badRequest("Choose a vendor contact.");

  const [result, contacts] = await Promise.all([
    catalogService.listStockCheckVendorGroups({ bypassCache: true }),
    vendorsService.listVendorContacts(vendorId)
  ]);
  const group = result.groups.find((item) => item.vendorId === vendorId);
  if (!group) throw badRequest("There are no stock checks for this vendor.");
  if (!contacts.some((contact) => contact.email === recipientEmail)) {
    throw badRequest("Choose an active contact for this vendor.");
  }

  const products = selectProductsForDateRange(group.products, input);
  if (products.length === 0) throw badRequest("There are no stock checks in this date range.");
  if (!Array.isArray(input?.skus)) throw badRequest("The stock-check list is invalid.");
  const expectedSkus = Array.from(new Set(input.skus.map((sku) => text(sku).toUpperCase()))).sort();
  const currentSkus = products.map((product) => product.sku.toUpperCase()).sort();
  if (JSON.stringify(expectedSkus) !== JSON.stringify(currentSkus)) {
    const error = new Error("Stock checks changed. Refresh the brand view before sending.");
    error.statusCode = 409;
    throw error;
  }

  const subject = text(input?.subject) || `Stock check request - ${group.vendorName}`;
  const body = buildBody(input?.message, products);
  const messageId = `<stockbridge-bulk-${randomUUID()}@dieselpowerproducts.com>`;
  const delivery = await emailService.sendVendorStockCheckEmail({
    to: recipientEmail,
    subject,
    body,
    messageId
  });
  await stockCheckEmailsService.recordVendorEmails({
    skus: products.map((product) => product.sku),
    vendorId,
    vendorName: group.vendorName,
    recipientEmail,
    subject,
    messageId: delivery.messageId || messageId
  }, sender);

  return {
    ...delivery,
    skus: products.map((product) => product.sku)
  };
}

module.exports = {
  sendBulkStockCheck,
  _test: { buildBody, selectProductsForDateRange }
};
