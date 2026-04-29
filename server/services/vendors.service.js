const catalogService = require("./catalog.service");
const skunexus = require("./skunexus.service");
const vendorAutoInventorySettingsService = require("./vendorAutoInventorySettings.service");
const vendorDefaultContactsService = require("./vendorDefaultContacts.service");
const vendorSettingsService = require("./vendorSettings.service");

const ignoredVendorContactEmails = new Set(["shipping@dieselpowerproducts.com"]);

function normalizeRequiredString(value, message) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function graphqlString(value) {
  return JSON.stringify(String(value || ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatContactName(contact) {
  const firstName = String(contact?.first_name || "").trim();
  const lastName = String(contact?.last_name || "").trim();

  if (firstName && lastName && firstName.toLowerCase() !== lastName.toLowerCase()) {
    return `${firstName} ${lastName}`;
  }

  return firstName || lastName || String(contact?.label || contact?.email || "").trim();
}

function formatVendorContact(contact) {
  return {
    id: String(contact?.id || "").trim(),
    vendorId: String(contact?.vendor_id || "").trim(),
    name: formatContactName(contact),
    email: normalizeEmail(contact?.email),
    phone: String(contact?.phone || "").trim(),
    label: String(contact?.label || contact?.email || "").trim()
  };
}

function isDefaultContact(contact, defaultContact) {
  if (!contact || !defaultContact) {
    return false;
  }

  return (
    (defaultContact.contactId && contact.id === defaultContact.contactId) ||
    (defaultContact.contactEmail && contact.email === defaultContact.contactEmail)
  );
}

async function listVendors(queryParams = {}) {
  return catalogService.listVendors(queryParams);
}

async function listVendorProducts(vendorId, queryParams = {}) {
  return catalogService.listVendorProducts(vendorId, queryParams);
}

async function getVendorAutoInventorySettings(vendorId) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  return vendorAutoInventorySettingsService.getSettings(safeVendorId);
}

async function fetchVendorContacts(vendorId) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const data = await skunexus.query(`
    query V1Queries {
      vendorContact {
        grid(
          filter: { vendor_id: { operator: eq, value: [${graphqlString(safeVendorId)}] } }
          sort: { email: ASC }
          limit: { size: 100, page: 1 }
        ) {
          rows {
            id
            vendor_id
            first_name
            last_name
            label
            email
            phone
            status
          }
        }
      }
    }
  `);

  return (data?.vendorContact?.grid?.rows || [])
    .filter((contact) => Number(contact?.status || 0) >= 2)
    .map(formatVendorContact)
    .filter((contact) => contact.id && contact.email)
    .filter((contact) => !ignoredVendorContactEmails.has(contact.email));
}

async function listVendorContacts(vendorId) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const [contacts, defaultContact] = await Promise.all([
    fetchVendorContacts(safeVendorId),
    vendorDefaultContactsService.getDefaultContact(safeVendorId)
  ]);

  return contacts.map((contact) => ({
    ...contact,
    isDefault: isDefaultContact(contact, defaultContact)
  }));
}

async function setVendorDefaultContact(vendorId, contactId) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const safeContactId = normalizeRequiredString(contactId, "Vendor contact is required.");
  const contacts = await fetchVendorContacts(safeVendorId);
  const contact = contacts.find((item) => item.id === safeContactId);

  if (!contact) {
    const error = new Error("Choose a valid vendor contact.");
    error.statusCode = 400;
    throw error;
  }

  await vendorDefaultContactsService.setDefaultContact({
    vendorId: safeVendorId,
    contactId: contact.id,
    contactEmail: contact.email,
    contactName: contact.name
  });

  return {
    ...contact,
    isDefault: true
  };
}

async function updateVendorSettings(vendorId, settings) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");

  await vendorSettingsService.setVendorSettings({
    vendorId: safeVendorId,
    builtToOrder: settings?.builtToOrder,
    buildTime: settings?.buildTime
  });

  return catalogService.getVendorDetails(safeVendorId);
}

async function updateVendorAutoInventorySettings(vendorId, settings) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");

  await catalogService.getVendorDetails(safeVendorId);
  return vendorAutoInventorySettingsService.saveSettings(safeVendorId, settings);
}

module.exports = {
  getVendorAutoInventorySettings,
  listVendorContacts,
  listVendors,
  listVendorProducts,
  setVendorDefaultContact,
  updateVendorAutoInventorySettings,
  updateVendorSettings
};
