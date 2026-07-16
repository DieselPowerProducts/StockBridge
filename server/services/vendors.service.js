const catalogService = require("./catalog.service");
const skunexus = require("./skunexus.service");
const {
  buildSkuExceptionKeys,
  isVendorProductExcepted
} = require("./autoInventorySkuMatcher");
const vendorAutoInventoryImportsService = require("./vendorAutoInventoryImports.service");
const vendorAutoInventoryProductUpdatesService = require("./vendorAutoInventoryProductUpdates.service");
const vendorAutoInventorySettingsService = require("./vendorAutoInventorySettings.service");
const vendorDefaultContactsService = require("./vendorDefaultContacts.service");
const vendorSettingsService = require("./vendorSettings.service");
const shopifyAvailabilityStateService = require("./shopifyAvailabilityState.service");

const ignoredVendorContactEmails = new Set(["shipping@dieselpowerproducts.com"]);
const vendorReconciliationPageSize = 100;

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
  const [settings, lastImportedAt] = await Promise.all([
    vendorAutoInventorySettingsService.getSettings(safeVendorId),
    vendorAutoInventoryImportsService.getLastSuccessfulImportForVendor(safeVendorId)
  ]);

  return {
    ...settings,
    lastImportedAt
  };
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
  const nextBuiltToOrder = settings?.builtToOrder === true;
  const nextBuildTime = String(settings?.buildTime || "").trim();
  const backorderedSkus = nextBuiltToOrder && nextBuildTime
    ? await listBackorderedProductSkus(safeVendorId)
    : [];

  const savedSettings = await vendorSettingsService.setVendorSettings({
    vendorId: safeVendorId,
    builtToOrder: settings?.builtToOrder,
    buildTime: settings?.buildTime
  });

  const btoReconciliation = await reconcileBackorderedProductsForBuiltToOrderVendor({
    vendorId: safeVendorId,
    buildTime: savedSettings.buildTime,
    productSkus: backorderedSkus
  });
  const vendor = await catalogService.getVendorDetails(safeVendorId);

  return {
    ...vendor,
    btoReconciliation
  };
}

async function listBackorderedProductSkus(vendorId) {
  const productSkus = new Set();
  let page = 1;

  while (true) {
    const result = await catalogService.listVendorProducts(vendorId, {
      page,
      limit: vendorReconciliationPageSize
    });

    for (const product of result.data || []) {
      const sku = String(product?.sku || "").trim();

      if (sku && product?.availability === "Backorder") {
        productSkus.add(sku);
      }
    }

    if (result.isLastPage) {
      break;
    }

    page += 1;
  }

  return Array.from(productSkus);
}

async function reconcileBackorderedProductsForBuiltToOrderVendor({
  vendorId,
  buildTime,
  productSkus
}) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");
  const safeBuildTime = String(buildTime || "").trim();
  const safeProductSkus = Array.from(
    new Set((productSkus || []).map((sku) => String(sku || "").trim()).filter(Boolean))
  );

  if (!safeBuildTime || safeProductSkus.length === 0) {
    return {
      converted: 0,
      shopifyFailed: 0,
      shopifyMatched: 0,
      shopifyUpdated: 0
    };
  }

  await shopifyAvailabilityStateService.setAvailabilityStatuses(
    safeProductSkus.map((sku) => ({
      sku,
      availability: "built_to_order",
      buildToOrderLeadTime: safeBuildTime
    }))
  );
  catalogService.clearCaches();

  try {
    const shopifyResult = await catalogService.syncShopifyAvailabilityForSkus(
      safeProductSkus,
      { source: `vendor-bto-settings:${safeVendorId}` }
    );

    return {
      converted: safeProductSkus.length,
      shopifyFailed: Number(shopifyResult.failed || 0),
      shopifyMatched: Number(shopifyResult.matched || 0),
      shopifyUpdated: Number(shopifyResult.updated || 0)
    };
  } catch (error) {
    console.error("Unable to sync reconciled vendor BTO products to Shopify.", error);

    return {
      converted: safeProductSkus.length,
      error: String(error?.message || error || "Shopify availability sync failed."),
      shopifyFailed: safeProductSkus.length,
      shopifyMatched: 0,
      shopifyUpdated: 0
    };
  }
}

async function removeAutoInventoryUpdatesForSkuExceptions(vendorId, settings) {
  if (!settings?.skuExceptions?.length) {
    return 0;
  }

  const vendorProducts =
    await catalogService.getActiveCatalogVendorProductsByVendorId(vendorId);
  const vendorProductIds = vendorProducts.map((row) => row.id).filter(Boolean);

  if (vendorProductIds.length === 0) {
    return 0;
  }

  const [updatesByVendorProductId] = await Promise.all([
    vendorAutoInventoryProductUpdatesService.getUpdatesForVendorProductIds(
      vendorProductIds
    )
  ]);
  const exceptionKeys = buildSkuExceptionKeys(settings.skuExceptions);
  const exceptedVendorProductIds = vendorProducts
    .filter((vendorProduct) => {
      const update = updatesByVendorProductId.get(vendorProduct.id);

      return isVendorProductExcepted(vendorProduct, exceptionKeys, [
        update?.sku,
        update?.sheetSku
      ]);
    })
    .map((vendorProduct) => vendorProduct.id)
    .filter(Boolean);

  return vendorAutoInventoryProductUpdatesService.deleteUpdatesForVendorProductIds(
    exceptedVendorProductIds
  );
}

async function updateVendorAutoInventorySettings(vendorId, settings) {
  const safeVendorId = normalizeRequiredString(vendorId, "Vendor ID is required.");

  await catalogService.getVendorDetails(safeVendorId);
  const savedSettings = await vendorAutoInventorySettingsService.saveSettings(
    safeVendorId,
    settings
  );
  const [, lastImportedAt] = await Promise.all([
    removeAutoInventoryUpdatesForSkuExceptions(safeVendorId, savedSettings),
    vendorAutoInventoryImportsService.getLastSuccessfulImportForVendor(safeVendorId)
  ]);

  return {
    ...savedSettings,
    lastImportedAt
  };
}

module.exports = {
  getVendorAutoInventorySettings,
  listVendorContacts,
  listVendors,
  listVendorProducts,
  reconcileBackorderedProductsForBuiltToOrderVendor,
  setVendorDefaultContact,
  updateVendorAutoInventorySettings,
  updateVendorSettings
};
