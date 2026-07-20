const catalogService = require("./catalog.service");

const DISTRIBUTOR_ALIASES = Object.freeze({
  keystone: ["keystone automotive", "keystone"],
  meyer: ["meyer distributing", "meyer"],
  premier_apg: ["premier performance", "apg wholesale"],
  turn14: ["turn 14 distribution", "turn14 distribution", "turn 14", "turn14"],
  xdp: ["xtreme diesel power", "xdp"]
});

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateRequest(body) {
  const sku = normalizeSku(body?.sku);
  const prices = Array.isArray(body?.prices) ? body.prices : [];
  if (!sku) {
    const error = new Error("Product SKU is required.");
    error.statusCode = 400;
    throw error;
  }
  if (prices.length < 1 || prices.length > 5) {
    const error = new Error("Provide between 1 and 5 wholesale distributor prices.");
    error.statusCode = 400;
    throw error;
  }

  return {
    sku,
    prices: prices.map((item, index) => ({
      requestIndex: index,
      distributorKey: normalizeName(item?.distributorKey).replace(/ /g, "_"),
      distributorName: String(item?.distributorName || "").trim(),
      newProductCost: Number(item?.newProductCost),
      sourceUrl: String(item?.sourceUrl || "").trim()
    }))
  };
}

function vendorMatchesProposal(vendor, proposal) {
  const aliases = DISTRIBUTOR_ALIASES[proposal.distributorKey] || [];
  const vendorName = normalizeName(vendor.name);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeName(alias);
    return vendorName === normalizedAlias || vendorName.includes(normalizedAlias);
  });
}

function resolveProposal(vendors, proposal) {
  const base = {
    requestIndex: proposal.requestIndex,
    distributorKey: proposal.distributorKey,
    distributorName: proposal.distributorName,
    newProductCost: proposal.newProductCost,
    sourceUrl: proposal.sourceUrl
  };
  if (!DISTRIBUTOR_ALIASES[proposal.distributorKey]) {
    return { ...base, status: "unsupported_distributor", message: "Distributor is not supported." };
  }
  if (!Number.isFinite(proposal.newProductCost) || proposal.newProductCost <= 0) {
    return { ...base, status: "invalid_cost", message: "New product cost must be greater than $0." };
  }
  if (!isHttpUrl(proposal.sourceUrl)) {
    return { ...base, status: "invalid_source_url", message: "A valid source URL is required." };
  }

  const matches = vendors.filter((vendor) => vendorMatchesProposal(vendor, proposal));
  if (matches.length === 0) {
    return { ...base, status: "vendor_not_assigned", message: "This WD is not assigned to the SKU in StockBridge." };
  }
  if (matches.length > 1) {
    return { ...base, status: "ambiguous_vendor", message: "More than one assigned StockBridge vendor matched this WD." };
  }

  const vendor = matches[0];
  return {
    ...base,
    status: "ready",
    message: "Ready to stage.",
    vendorId: vendor.id,
    vendorProductId: vendor.vendorProductId,
    vendorName: vendor.name,
    vendorSku: vendor.vendorSku,
    currentProductCost: vendor.productCost,
    currentNewProductCost: vendor.newProductCost,
    currentPriceSourceUrl: vendor.priceSourceUrl || "",
    currentPriceReceivedAt: vendor.priceReceivedAt || null
  };
}

async function previewPrices(body) {
  const request = validateRequest(body);
  const product = await catalogService.getProductDetails(request.sku);
  const vendors = (product.vendors || []).filter((vendor) => vendor.stockSource === "vendor");
  const results = request.prices.map((proposal) => resolveProposal(vendors, proposal));
  const readyTargets = new Map();
  for (const result of results) {
    if (result.status === "ready") {
      readyTargets.set(result.vendorProductId, (readyTargets.get(result.vendorProductId) || 0) + 1);
    }
  }
  for (const result of results) {
    if (result.status === "ready" && readyTargets.get(result.vendorProductId) > 1) {
      result.status = "duplicate_vendor";
      result.message = "Multiple submitted WD rows resolve to the same StockBridge vendor.";
    }
  }
  return { sku: request.sku, productName: product.name || "", results };
}

async function stagePrices(body) {
  const preview = await previewPrices(body);
  const results = [];
  for (const item of preview.results) {
    if (item.status !== "ready") {
      results.push(item);
      continue;
    }
    const staged = await catalogService.stageCatalogVendorProductPrice(item.vendorProductId, {
      pendingPrice: item.newProductCost,
      sourceUrl: item.sourceUrl
    });
    results.push(staged
      ? { ...item, status: "staged", message: "New product cost staged in StockBridge.", priceReceivedAt: staged.pending_price_updated_at }
      : { ...item, status: "vendor_product_missing", message: "Vendor product no longer exists." });
  }
  return {
    sku: preview.sku,
    productName: preview.productName,
    stagedCount: results.filter((item) => item.status === "staged").length,
    results
  };
}

module.exports = {
  DISTRIBUTOR_ALIASES,
  normalizeName,
  previewPrices,
  resolveProposal,
  stagePrices,
  validateRequest
};
