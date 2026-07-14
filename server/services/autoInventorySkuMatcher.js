function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSkuKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, "-")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getSkuMatchKeys(value) {
  const safeValue = normalizeSkuKey(value);
  const keys = new Set();
  const addKey = (keyValue) => {
    const key = normalizeSkuKey(keyValue);

    if (key) {
      keys.add(key);
    }
  };

  addKey(safeValue);

  const parts = safeValue.split("-").filter(Boolean);

  if (parts.length > 1 && /^[a-z]+$/.test(parts[0])) {
    addKey(parts.slice(1).join("-"));
  }

  return Array.from(keys);
}

function addSkuMatchKeys(keySet, value) {
  for (const key of getSkuMatchKeys(value)) {
    keySet.add(key);
  }
}

function getVendorProductSkuValues(vendorProduct, extraValues = []) {
  return [
    vendorProduct?.product_sku,
    vendorProduct?.sku,
    vendorProduct?.label,
    ...extraValues
  ].filter(Boolean);
}

function buildSkuExceptionKeys(skuExceptions) {
  const keys = new Set();

  for (const sku of skuExceptions || []) {
    addSkuMatchKeys(keys, sku);
  }

  return keys;
}

function isVendorProductExcepted(vendorProduct, exceptionKeys, extraValues = []) {
  if (!exceptionKeys || exceptionKeys.size === 0) {
    return false;
  }

  return getVendorProductSkuValues(vendorProduct, extraValues).some((value) =>
    getSkuMatchKeys(value).some((key) => exceptionKeys.has(key))
  );
}

module.exports = {
  addSkuMatchKeys,
  buildSkuExceptionKeys,
  getSkuMatchKeys,
  getVendorProductSkuValues,
  isVendorProductExcepted,
  normalizeSkuKey
};
