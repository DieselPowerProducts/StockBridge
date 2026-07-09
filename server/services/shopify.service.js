const crypto = require("crypto");
const { loadLocalEnv } = require("../config/env");
const { getSql } = require("../db/neon");
const shopifyAvailabilityStateService = require("./shopifyAvailabilityState.service");

loadLocalEnv();

const DEFAULT_API_VERSION = "2025-10";
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;
const DEFAULT_RESOLVE_CACHE_DAYS = 7;
const MAX_SHOPIFY_GRAPHQL_RETRIES = 5;
const metafieldNamespace = "custom";
const availabilityMetafieldKey = "product_availability";
const availabilityDateMetafieldKey = "product_availability_date";
const availabilityDateConfirmedMetafieldKey = "availability_date_confirmed";
const buildToOrderMessageMetafieldKey = "build_to_order_message";
const quickShipMetafieldKey = "quick_ship";
const availabilityValues = {
  in_stock: "In Stock",
  out_of_stock: "Out of Stock",
  backordered: "Backorder",
  built_to_order: "Built to Order"
};
const availabilityStatuses = new Set(Object.keys(availabilityValues));
const shopifyCredentialProfiles = {
  availability: {
    clientIdEnv: "SHOPIFY_CLIENT_ID2",
    clientSecretEnv: "SHOPIFY_CLIENT_SECRET2"
  },
  orders: {
    clientIdEnv: "SHOPIFY_CLIENT_ID",
    clientSecretEnv: "SHOPIFY_CLIENT_SECRET"
  }
};
const shopifyOrdersProfile = "orders";
const shopifyAvailabilityProfile = "availability";

const accessTokenCache = new Map();
let resolveCacheSchemaReady;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw createHttpError(500, `${name} is not configured.`);
  }

  return value;
}

function normalizeStoreDomain(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    throw createHttpError(500, "SHOPIFY_STORE_DOMAIN is not configured.");
  }

  try {
    const normalizedUrl = new URL(
      /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
    );
    const hostname = normalizedUrl.hostname.toLowerCase();

    if (hostname === "admin.shopify.com") {
      throw createHttpError(
        500,
        "SHOPIFY_STORE_DOMAIN must be your store's .myshopify.com domain, not the Shopify admin URL."
      );
    }

    if (!hostname.endsWith(".myshopify.com")) {
      throw createHttpError(
        500,
        "SHOPIFY_STORE_DOMAIN must be your store's .myshopify.com domain."
      );
    }

    return hostname;
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    throw createHttpError(
      500,
      "SHOPIFY_STORE_DOMAIN is invalid. Use a value like your-store.myshopify.com."
    );
  }
}

function getShopifyConfig(profile = shopifyOrdersProfile) {
  const credentialProfile =
    shopifyCredentialProfiles[profile] || shopifyCredentialProfiles.orders;

  return {
    apiVersion: String(process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
    clientId: getRequiredEnv(credentialProfile.clientIdEnv),
    clientSecret: getRequiredEnv(credentialProfile.clientSecretEnv),
    storeDomain: normalizeStoreDomain(getRequiredEnv("SHOPIFY_STORE_DOMAIN"))
  };
}

function normalizeOrderNumber(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSku(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeMatchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAvailabilityStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "available" || normalized === "instock") {
    return "in_stock";
  }

  if (normalized === "outofstock") {
    return "out_of_stock";
  }

  if (normalized === "backorder") {
    return "backordered";
  }

  if (normalized === "builttoorder") {
    return "built_to_order";
  }

  if (availabilityStatuses.has(normalized)) {
    return normalized;
  }

  throw createHttpError(400, "Shopify availability status is invalid.");
}

function normalizeDateText(value) {
  const dateText = String(value || "").trim();

  if (!dateText) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw createHttpError(400, "Availability date must use YYYY-MM-DD format.");
  }

  const date = new Date(`${dateText}T00:00:00Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
    throw createHttpError(400, "Availability date is invalid.");
  }

  return dateText;
}

function formatAvailabilityDateTime(value) {
  const dateText = normalizeDateText(value);

  if (!dateText) {
    return "";
  }

  return `${dateText}T13:00:00`;
}

function normalizeBuildToOrderMessage(value) {
  return String(value || "").trim();
}

function normalizeOptionalAvailabilityStatus(value) {
  try {
    return normalizeAvailabilityStatus(value);
  } catch (error) {
    return "";
  }
}

function parseBuildToOrderLeadTimeFromMessage(value) {
  const message = normalizeBuildToOrderMessage(value);
  const match = message.match(
    /^This product will ship in\s+(.+?)\s+from the manufacturer\.?$/i
  );

  return match ? match[1].trim() : "";
}

function formatUserErrors(userErrors) {
  return (userErrors || [])
    .map((error) => {
      const field = Array.isArray(error?.field) ? error.field.join(".") : "";
      const message = String(error?.message || "").trim();

      return [field, message].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
}

function assertNoUserErrors(userErrors, fallbackMessage) {
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw createHttpError(502, formatUserErrors(userErrors) || fallbackMessage);
  }
}

function getResolveCacheDays() {
  const rawValue = Number.parseInt(
    String(process.env.SHOPIFY_ORDER_RESOLVE_CACHE_DAYS || ""),
    10
  );

  if (Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }

  return DEFAULT_RESOLVE_CACHE_DAYS;
}

function normalizeLookupCreatedAt(value) {
  if (!value) {
    return "";
  }

  const createdAt = new Date(String(value));

  if (Number.isNaN(createdAt.getTime())) {
    return "";
  }

  return createdAt.toISOString();
}

function getResolveCacheContext({
  createdAt,
  normalizedEmail,
  normalizedOrderNumber,
  normalizedSkus,
  storeDomain
}) {
  return {
    createdAt: normalizeLookupCreatedAt(createdAt),
    customerEmail: normalizedEmail,
    orderNumber: normalizedOrderNumber,
    skus: [...normalizedSkus].sort(),
    storeDomain
  };
}

function getResolveCacheKey(context) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex");
}

async function ensureResolveCacheSchema() {
  if (!resolveCacheSchemaReady) {
    const sql = getSql();

    resolveCacheSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS shopify_order_resolve_cache (
          cache_key TEXT PRIMARY KEY,
          order_number TEXT NOT NULL,
          customer_email TEXT NOT NULL,
          lookup_created_at TEXT NOT NULL DEFAULT '',
          skus_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          order_json JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS shopify_order_resolve_cache_expires_idx
        ON shopify_order_resolve_cache (expires_at)
      `;
    })();
  }

  return resolveCacheSchemaReady;
}

async function getCachedResolvedOrder(cacheKey) {
  await ensureResolveCacheSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT order_json
    FROM shopify_order_resolve_cache
    WHERE cache_key = ${cacheKey}
      AND expires_at > now()
    LIMIT 1
  `;
  const cachedOrder = rows[0]?.order_json;

  if (!cachedOrder) {
    return null;
  }

  return typeof cachedOrder === "string" ? JSON.parse(cachedOrder) : cachedOrder;
}

async function cacheResolvedOrder(cacheKey, context, order) {
  await ensureResolveCacheSchema();

  const sql = getSql();
  const expiresAt = new Date(
    Date.now() + getResolveCacheDays() * 24 * 60 * 60 * 1000
  ).toISOString();

  await sql`
    INSERT INTO shopify_order_resolve_cache (
      cache_key,
      order_number,
      customer_email,
      lookup_created_at,
      skus_json,
      order_json,
      expires_at
    )
    VALUES (
      ${cacheKey},
      ${context.orderNumber},
      ${context.customerEmail},
      ${context.createdAt},
      ${JSON.stringify(context.skus)},
      ${JSON.stringify(order)},
      ${expiresAt}
    )
    ON CONFLICT (cache_key) DO UPDATE SET
      order_number = EXCLUDED.order_number,
      customer_email = EXCLUDED.customer_email,
      lookup_created_at = EXCLUDED.lookup_created_at,
      skus_json = EXCLUDED.skus_json,
      order_json = EXCLUDED.order_json,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
  `;
}

function getCandidateEmails(node) {
  return Array.from(
    new Set([normalizeEmail(node?.email), normalizeEmail(node?.customer?.email)].filter(Boolean))
  );
}

function getCandidateSkus(node) {
  return Array.from(
    new Set(
      (Array.isArray(node?.lineItems?.nodes) ? node.lineItems.nodes : [])
        .map((lineItem) => normalizeSku(lineItem?.sku))
        .filter(Boolean)
    )
  );
}

function quoteSearchValue(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function assertLookupInput({ orderNumber, customerEmail, createdAt, skus }) {
  if (!normalizeOrderNumber(orderNumber)) {
    throw createHttpError(400, "Order number is required.");
  }

  const normalizedEmail = normalizeEmail(customerEmail);

  if (!normalizedEmail) {
    throw createHttpError(400, "Customer email is required.");
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw createHttpError(400, "Customer email is invalid.");
  }

  if (createdAt && Number.isNaN(Date.parse(String(createdAt)))) {
    throw createHttpError(400, "Created date is invalid.");
  }

  if (skus !== undefined && !Array.isArray(skus)) {
    throw createHttpError(400, "SKUs must be an array.");
  }
}

async function fetchFromShopify(url, init, contextLabel) {
  try {
    return await fetch(url, init);
  } catch (error) {
    console.error(`[shopify] ${contextLabel} failed`, error);
    throw createHttpError(
      502,
      "Unable to reach Shopify. Check SHOPIFY_STORE_DOMAIN and your network connection."
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAccessTokenCacheKey({ clientId, storeDomain }) {
  return `${storeDomain}:${clientId}`;
}

async function fetchShopifyAccessToken(profile = shopifyOrdersProfile) {
  const config = getShopifyConfig(profile);
  const cacheKey = getAccessTokenCacheKey(config);
  const cachedToken = accessTokenCache.get(cacheKey);

  if (
    cachedToken?.token &&
    cachedToken.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MS
  ) {
    return cachedToken.token;
  }

  const response = await fetchFromShopify(
    `https://${config.storeDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret
      }).toString()
    },
    "access token request"
  );

  let payload = null;

  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    throw createHttpError(
      502,
      payload?.error_description ||
        payload?.error ||
        "Unable to authenticate with Shopify."
    );
  }

  const expiresInSeconds = Number(payload.expires_in || 0);
  const nextCachedToken = {
    token: payload.access_token,
    expiresAt:
      Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 0)
  };
  accessTokenCache.set(cacheKey, nextCachedToken);

  return nextCachedToken.token;
}

function getShopifyErrorMessages(payload) {
  if (!Array.isArray(payload?.errors)) {
    return [];
  }

  return payload.errors.map((error) =>
    typeof error === "string" ? error : String(error?.message || error?.extensions?.code || "")
  );
}

function getShopifyRetryDelayMs(response, payload, attempt) {
  const messages = getShopifyErrorMessages(payload);
  const isThrottled =
    response.status === 429 ||
    messages.some((message) => /throttl|rate limit/i.test(message));

  if (!isThrottled || attempt >= MAX_SHOPIFY_GRAPHQL_RETRIES) {
    return 0;
  }

  const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return Math.min(1000 * 2 ** attempt, 10000);
}

function getShopifyThrottlePauseMs(payload) {
  const throttleStatus = payload?.extensions?.cost?.throttleStatus;
  const currentlyAvailable = Number(throttleStatus?.currentlyAvailable);
  const restoreRate = Number(throttleStatus?.restoreRate);

  if (
    !Number.isFinite(currentlyAvailable) ||
    !Number.isFinite(restoreRate) ||
    restoreRate <= 0 ||
    currentlyAvailable >= 100
  ) {
    return 0;
  }

  return Math.min(
    Math.ceil(((100 - currentlyAvailable) / restoreRate) * 1000),
    5000
  );
}

async function shopifyGraphQL(
  query,
  variables,
  profile = shopifyOrdersProfile,
  attempt = 0
) {
  const { apiVersion, storeDomain } = getShopifyConfig(profile);
  const accessToken = await fetchShopifyAccessToken(profile);
  const response = await fetchFromShopify(
    `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({ query, variables })
    },
    "GraphQL request"
  );

  let payload = null;

  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  const retryDelayMs = getShopifyRetryDelayMs(response, payload, attempt);

  if (retryDelayMs > 0) {
    await delay(retryDelayMs);
    return shopifyGraphQL(query, variables, profile, attempt + 1);
  }

  if (!response.ok) {
    throw createHttpError(
      502,
      payload?.errors?.[0]?.message || "Shopify request failed."
    );
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw createHttpError(502, payload.errors[0].message || "Shopify request failed.");
  }

  const throttlePauseMs = getShopifyThrottlePauseMs(payload);

  if (throttlePauseMs > 0) {
    await delay(throttlePauseMs);
  }

  return payload?.data;
}

function getProductSearchQuery(sku) {
  return `sku:${quoteSearchValue(sku)}`;
}

function scoreProductVariantMatch(variant, { productName, safeSku }) {
  const product = variant?.product || {};
  const skuScore = normalizeSku(variant?.sku) === safeSku ? 1000 : 0;
  const statusScore = product.status === "ACTIVE" ? 100 : 0;
  const productTitle = normalizeMatchText(product.title);
  const stockBridgeTitle = normalizeMatchText(productName);
  let titleScore = 0;

  if (productTitle && stockBridgeTitle) {
    if (productTitle === stockBridgeTitle) {
      titleScore = 75;
    } else if (
      productTitle.includes(stockBridgeTitle) ||
      stockBridgeTitle.includes(productTitle)
    ) {
      titleScore = 35;
    }
  }

  return skuScore + statusScore + titleScore;
}

async function findProductBySku(sku, { productName = "" } = {}) {
  const safeSku = normalizeSku(sku);

  if (!safeSku) {
    throw createHttpError(400, "Product SKU is required.");
  }

  const data = await shopifyGraphQL(
    `
      query ProductBySku($query: String!) {
        productVariants(first: 25, query: $query) {
          nodes {
            id
            sku
            product {
              id
              handle
              status
              title
            }
          }
        }
      }
    `,
    {
      query: getProductSearchQuery(safeSku)
    },
    shopifyAvailabilityProfile
  );
  const variants = Array.isArray(data?.productVariants?.nodes)
    ? data.productVariants.nodes
    : [];
  const exactVariants = variants.filter((item) => normalizeSku(item?.sku) === safeSku);
  const candidateVariants = exactVariants.length > 0 ? exactVariants : variants;
  const variant = [...candidateVariants].sort(
    (left, right) =>
      scoreProductVariantMatch(right, { productName, safeSku }) -
      scoreProductVariantMatch(left, { productName, safeSku })
  )[0];

  if (!variant?.product?.id) {
    throw createHttpError(404, "No Shopify product matched this SKU.");
  }

  return {
    duplicateSkuMatchCount: exactVariants.length,
    handle: variant.product.handle || "",
    productId: variant.product.id,
    productStatus: variant.product.status || "",
    productTitle: variant.product.title || "",
    matchedVariantId: variant.id || "",
    matchedSku: variant.sku || safeSku
  };
}

async function getProductVariants(productId) {
  const variants = [];
  let after = null;

  while (true) {
    const data = await shopifyGraphQL(
      `
        query ProductVariants($productId: ID!, $after: String) {
          product(id: $productId) {
            id
            variants(first: 250, after: $after) {
              nodes {
                id
                sku
                inventoryPolicy
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        productId,
        after
      },
      shopifyAvailabilityProfile
    );
    const product = data?.product;

    if (!product?.id) {
      throw createHttpError(404, "Shopify product was not found.");
    }

    variants.push(...(product.variants?.nodes || []));

    if (!product.variants?.pageInfo?.hasNextPage) {
      break;
    }

    after = product.variants.pageInfo.endCursor;
  }

  return variants;
}

function normalizeQuickShipValue(value) {
  return Number(value || 0) > 0 ? "1" : "0";
}

function getQuickShipMetafieldsForTarget(target) {
  const quickShipValue = normalizeQuickShipValue(target.quickShip);

  return target.variantIds.map((ownerId) => ({
    key: quickShipMetafieldKey,
    namespace: metafieldNamespace,
    ownerId,
    type: "number_integer",
    value: quickShipValue
  }));
}

async function getQuickShipVariantTargets(records) {
  const targets = [];

  for (const chunk of chunkItems(records, 20)) {
    const variableDefinitions = chunk
      .map((_, index) => `$query${index}: String!`)
      .join(", ");
    const fields = chunk
      .map(
        (_, index) => `
          variant${index}: productVariants(first: 25, query: $query${index}) {
            nodes {
              id
              sku
              quickShip: metafield(namespace: "custom", key: "quick_ship") {
                value
                type
              }
              product {
                id
                handle
                status
                title
              }
            }
          }
        `
      )
      .join("\n");
    const variables = Object.fromEntries(
      chunk.map((record, index) => [
        `query${index}`,
        getProductSearchQuery(record.safeSku)
      ])
    );
    const data = await shopifyGraphQL(
      `
        query QuickShipVariantTargets(${variableDefinitions}) {
          ${fields}
        }
      `,
      variables,
      shopifyAvailabilityProfile
    );

    chunk.forEach((record, index) => {
      const nodes = Array.isArray(data?.[`variant${index}`]?.nodes)
        ? data[`variant${index}`].nodes
        : [];
      const exactVariants = nodes.filter(
        (variant) => normalizeSku(variant?.sku) === record.safeSku
      );

      if (exactVariants.length === 0) {
        targets.push({
          ...record,
          error: "No Shopify variants matched this SKU.",
          ok: false
        });
        return;
      }

      const firstVariant = exactVariants[0] || {};
      const product = firstVariant.product || {};
      const variantIds = exactVariants.map((variant) => variant.id).filter(Boolean);
      const quickShipValues = exactVariants.map((variant) =>
        normalizeQuickShipValue(variant?.quickShip?.value)
      );

      if (variantIds.length === 0) {
        targets.push({
          ...record,
          error: "No Shopify variant IDs matched this SKU.",
          ok: false
        });
        return;
      }

      targets.push({
        ...record,
        duplicateSkuMatchCount: exactVariants.length,
        handle: product.handle || "",
        matchedSku: firstVariant.sku || record.sku,
        productId: product.id || "",
        productTitle: product.title || "",
        productStatus: product.status || "",
        quickShipValues,
        quickShipMetafieldCount: exactVariants.filter((variant) => variant?.quickShip)
          .length,
        variantIds
      });
    });
  }

  return targets;
}

function normalizeAvailabilitySyncRecord(record) {
  const sku = String(record?.sku || "").trim();
  const safeSku = normalizeSku(sku);

  if (!safeSku) {
    return null;
  }

  let availability = "";

  try {
    availability = normalizeAvailabilityStatus(record?.availability);
  } catch (error) {
    return null;
  }

  return {
    availability,
    buildToOrderLeadTime: String(record?.buildToOrderLeadTime || "").trim(),
    buildToOrderMessage: normalizeBuildToOrderMessage(record?.buildToOrderMessage),
    followUpDate: String(record?.followUpDate || "").trim(),
    productName: String(record?.productName || "").trim(),
    safeSku,
    sku
  };
}

function getVariantMetafieldByKey(variant, key) {
  switch (key) {
    case availabilityMetafieldKey:
      return variant?.productAvailability || null;
    case availabilityDateMetafieldKey:
      return variant?.productAvailabilityDate || null;
    case availabilityDateConfirmedMetafieldKey:
      return variant?.availabilityDateConfirmed || null;
    case buildToOrderMessageMetafieldKey:
      return variant?.buildToOrderMessage || null;
    default:
      return null;
  }
}

function metafieldValuesMatch(key, currentValue, expectedValue) {
  const current = String(currentValue || "");
  const expected = String(expectedValue || "");

  if (key === availabilityDateMetafieldKey) {
    return current === expected || current.startsWith(`${expected}+`);
  }

  return current === expected;
}

function getAvailabilityTargetChanges(target) {
  const variantIds = target.variants.map((variant) => variant.id).filter(Boolean);
  const { deleteKeys, metafields, status } = getMetafieldChanges({
    ownerIds: variantIds,
    availability: target.availability,
    buildToOrderMessage: target.buildToOrderMessage,
    followUpDate: target.followUpDate
  });
  const metafieldsToSet = metafields.filter((metafield) => {
    const variant = target.variants.find((item) => item.id === metafield.ownerId);
    const current = getVariantMetafieldByKey(variant, metafield.key);

    return (
      !current ||
      !metafieldValuesMatch(metafield.key, current.value, metafield.value)
    );
  });
  const deleteKeysByOwnerId = new Map();

  for (const variant of target.variants) {
    for (const key of deleteKeys) {
      if (getVariantMetafieldByKey(variant, key)) {
        const keys = deleteKeysByOwnerId.get(variant.id) || [];
        keys.push(key);
        deleteKeysByOwnerId.set(variant.id, keys);
      }
    }
  }

  const inventoryPolicy = getInventoryPolicyForAvailability(status);
  const inventoryPolicyVariants = inventoryPolicy
    ? target.variants.filter((variant) => variant.inventoryPolicy !== inventoryPolicy)
    : [];

  return {
    deleteKeysByOwnerId,
    inventoryPolicy,
    inventoryPolicyVariants,
    metafieldsToSet,
    status
  };
}

async function getAvailabilityVariantTargets(records) {
  const targets = [];

  for (const chunk of chunkItems(records, 20)) {
    const variableDefinitions = chunk
      .map((_, index) => `$query${index}: String!`)
      .join(", ");
    const fields = chunk
      .map(
        (_, index) => `
          variant${index}: productVariants(first: 25, query: $query${index}) {
            nodes {
              id
              sku
              inventoryPolicy
              productAvailability: metafield(namespace: "custom", key: "product_availability") {
                value
              }
              productAvailabilityDate: metafield(namespace: "custom", key: "product_availability_date") {
                value
              }
              availabilityDateConfirmed: metafield(namespace: "custom", key: "availability_date_confirmed") {
                value
              }
              buildToOrderMessage: metafield(namespace: "custom", key: "build_to_order_message") {
                value
              }
              product {
                id
                handle
                status
                title
              }
            }
          }
        `
      )
      .join("\n");
    const variables = Object.fromEntries(
      chunk.map((record, index) => [
        `query${index}`,
        getProductSearchQuery(record.safeSku)
      ])
    );
    const data = await shopifyGraphQL(
      `
        query AvailabilityVariantTargets(${variableDefinitions}) {
          ${fields}
        }
      `,
      variables,
      shopifyAvailabilityProfile
    );

    chunk.forEach((record, index) => {
      const nodes = Array.isArray(data?.[`variant${index}`]?.nodes)
        ? data[`variant${index}`].nodes
        : [];
      const exactVariants = nodes.filter(
        (variant) => normalizeSku(variant?.sku) === record.safeSku
      );

      if (exactVariants.length === 0) {
        targets.push({
          ...record,
          error: "No Shopify variants matched this SKU.",
          ok: false
        });
        return;
      }

      const firstVariant = exactVariants[0] || {};
      const product = firstVariant.product || {};

      targets.push({
        ...record,
        duplicateSkuMatchCount: exactVariants.length,
        handle: product.handle || "",
        matchedSku: firstVariant.sku || record.sku,
        productId: product.id || "",
        productStatus: product.status || "",
        productTitle: product.title || "",
        variants: exactVariants
      });
    });
  }

  return targets;
}

async function getQuickShipMetafieldStates(records) {
  const safeRecords = (records || [])
    .map((record) => ({
      parentProductId: String(record?.parentProductId || "").trim(),
      productName: String(record?.productName || "").trim(),
      quickShip: Number(record?.quickShip || 0) > 0 ? 1 : 0,
      safeSku: normalizeSku(record?.sku),
      sku: String(record?.sku || "").trim()
    }))
    .filter((record) => record.sku && record.safeSku);
  const targets = await getQuickShipVariantTargets(safeRecords);

  return {
    requested: safeRecords.length,
    results: targets.map((target) => {
      if (target.ok === false) {
        return target;
      }

      const expectedValue = normalizeQuickShipValue(target.quickShip);
      const hasAllMetafields =
        Number(target.quickShipMetafieldCount || 0) === target.variantIds.length;
      const matchesExpected =
        hasAllMetafields &&
        target.quickShipValues.every((value) => value === expectedValue);

      return {
        ...target,
        currentQuickShipValues: target.quickShipValues,
        matchesExpected,
        ok: true,
        quickShip: Number(expectedValue)
      };
    })
  };
}

async function saveQuickShipTarget(target) {
  const quickShipValue = normalizeQuickShipValue(target.quickShip);
  const savedMetafields = await setMetafields(getQuickShipMetafieldsForTarget(target));

  return {
    ...target,
    ok: true,
    quickShip: Number(quickShipValue),
    savedMetafields,
    updatedMetafieldOwnerCount: target.variantIds.length
  };
}

async function saveQuickShipTargetBatch(targets) {
  try {
    const savedMetafields = await setMetafields(
      targets.flatMap(getQuickShipMetafieldsForTarget)
    );

    return targets.map((target) => {
      const quickShipValue = normalizeQuickShipValue(target.quickShip);

      return {
        ...target,
        ok: true,
        quickShip: Number(quickShipValue),
        savedMetafields,
        updatedMetafieldOwnerCount: target.variantIds.length
      };
    });
  } catch (batchError) {
    const results = [];

    for (const target of targets) {
      try {
        results.push(await saveQuickShipTarget(target));
      } catch (error) {
        results.push({
          ...target,
          error: String(
            error?.message ||
              batchError?.message ||
              error ||
              "Unable to update Shopify."
          ),
          ok: false
        });
      }
    }

    return results;
  }
}

async function updateQuickShipMetafields(records) {
  const safeRecords = (records || [])
    .map((record) => ({
      parentProductId: String(record?.parentProductId || "").trim(),
      productName: String(record?.productName || "").trim(),
      quickShip: Number(record?.quickShip || 0) > 0 ? 1 : 0,
      safeSku: normalizeSku(record?.sku),
      sku: String(record?.sku || "").trim()
    }))
    .filter((record) => record.sku && record.safeSku);
  const targets = await getQuickShipVariantTargets(safeRecords);
  const failedTargetResults = targets.filter((target) => target.ok === false);
  const validTargets = targets.filter((target) => target.ok !== false);
  const savedTargetResults = [];

  for (const targetBatch of chunkItems(validTargets, 25)) {
    savedTargetResults.push(...(await saveQuickShipTargetBatch(targetBatch)));
  }

  const results = [...failedTargetResults, ...savedTargetResults];

  return {
    requested: safeRecords.length,
    updated: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
  };
}

async function setMetafields(metafields) {
  if (metafields.length === 0) {
    return [];
  }

  const savedMetafields = [];

  for (const chunk of chunkItems(metafields, 25)) {
    const data = await shopifyGraphQL(
      `
        mutation SetProductMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `,
      {
        metafields: chunk
      },
      shopifyAvailabilityProfile
    );
    const payload = data?.metafieldsSet || {};

    assertNoUserErrors(payload.userErrors, "Shopify metafields could not be saved.");
    savedMetafields.push(...(payload.metafields || []));
  }

  return savedMetafields;
}

async function deleteMetafields(ownerIds, keys) {
  const metafields = ownerIds.flatMap((ownerId) =>
    keys.map((key) => ({
      ownerId,
      namespace: metafieldNamespace,
      key
    }))
  );

  if (metafields.length === 0) {
    return [];
  }

  const deletedMetafields = [];

  for (const chunk of chunkItems(metafields, 25)) {
    const data = await shopifyGraphQL(
      `
        mutation DeleteProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              ownerId
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        metafields: chunk
      },
      shopifyAvailabilityProfile
    );
    const payload = data?.metafieldsDelete || {};

    assertNoUserErrors(payload.userErrors, "Shopify metafields could not be cleared.");
    deletedMetafields.push(...(payload.deletedMetafields || []));
  }

  return deletedMetafields;
}

async function deleteMetafieldIdentifiers(metafields) {
  if (metafields.length === 0) {
    return [];
  }

  const deletedMetafields = [];

  for (const chunk of chunkItems(metafields, 25)) {
    const data = await shopifyGraphQL(
      `
        mutation DeleteProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              ownerId
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        metafields: chunk
      },
      shopifyAvailabilityProfile
    );
    const payload = data?.metafieldsDelete || {};

    assertNoUserErrors(payload.userErrors, "Shopify metafields could not be cleared.");
    deletedMetafields.push(...(payload.deletedMetafields || []));
  }

  return deletedMetafields;
}

async function getVariantAvailabilityMetafields(variantIds) {
  const metafieldsByVariantId = {};

  for (const chunk of chunkItems(variantIds, 100)) {
    const data = await shopifyGraphQL(
      `
        query VariantAvailabilityMetafields($variantIds: [ID!]!) {
          nodes(ids: $variantIds) {
            id
            ... on ProductVariant {
              productAvailability: metafield(
                namespace: "custom"
                key: "product_availability"
              ) {
                id
                key
                namespace
                type
                value
              }
              productAvailabilityDate: metafield(
                namespace: "custom"
                key: "product_availability_date"
              ) {
                id
                key
                namespace
                type
                value
              }
              availabilityDateConfirmed: metafield(
                namespace: "custom"
                key: "availability_date_confirmed"
              ) {
                id
                key
                namespace
                type
                value
              }
              buildToOrderMessage: metafield(
                namespace: "custom"
                key: "build_to_order_message"
              ) {
                id
                key
                namespace
                type
                value
              }
            }
          }
        }
      `,
      {
        variantIds: chunk
      },
      shopifyAvailabilityProfile
    );

    for (const node of data?.nodes || []) {
      if (!node?.id) {
        continue;
      }

      metafieldsByVariantId[node.id] = {
        [availabilityMetafieldKey]: node.productAvailability || null,
        [availabilityDateMetafieldKey]: node.productAvailabilityDate || null,
        [availabilityDateConfirmedMetafieldKey]:
          node.availabilityDateConfirmed || null,
        [buildToOrderMessageMetafieldKey]: node.buildToOrderMessage || null
      };
    }
  }

  return metafieldsByVariantId;
}

async function getWarehouseQtyAvailableForSku(sku) {
  const safeSku = normalizeSku(sku);

  if (!safeSku) {
    return 0;
  }

  const sql = getSql();
  const rows = await sql`
    SELECT COALESCE(SUM(ws.qty_available), 0)::float AS qty_available
    FROM catalog_products p
    JOIN catalog_warehouse_stock ws ON ws.product_id = p.product_id
    WHERE UPPER(p.sku) = ${safeSku}
  `;

  return Math.max(Number(rows[0]?.qty_available || 0), 0);
}

async function getVariantAvailabilityStatePage({ after = "", first = 250 } = {}) {
  const pageSize = Math.max(
    1,
    Math.min(250, Number.parseInt(String(first || 250), 10) || 250)
  );
  const data = await shopifyGraphQL(
    `
      query VariantAvailabilityStatePage($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          nodes {
            id
            sku
            productAvailability: metafield(
              namespace: "custom"
              key: "product_availability"
            ) {
              value
            }
            buildToOrderMessage: metafield(
              namespace: "custom"
              key: "build_to_order_message"
            ) {
              value
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: pageSize,
      after: after || null
    },
    shopifyAvailabilityProfile
  );
  const variants = Array.isArray(data?.productVariants?.nodes)
    ? data.productVariants.nodes
    : [];
  const pageInfo = data?.productVariants?.pageInfo || {};

  return {
    variants,
    pageInfo: {
      hasNextPage: Boolean(pageInfo.hasNextPage),
      endCursor: pageInfo.endCursor || ""
    }
  };
}

function mergeVariantAvailabilityRecords(variants) {
  const recordsBySku = new Map();
  const skipped = [];
  const conflictSkus = new Set();

  for (const variant of variants) {
    const sku = normalizeSku(variant?.sku);

    if (!sku) {
      skipped.push({
        reason: "missing_sku",
        variantId: variant?.id || ""
      });
      continue;
    }

    const availability = normalizeOptionalAvailabilityStatus(
      variant?.productAvailability?.value
    );

    if (!availability) {
      skipped.push({
        reason: "missing_or_unknown_availability",
        sku,
        value: String(variant?.productAvailability?.value || "")
      });
      continue;
    }

    const buildToOrderLeadTime =
      availability === "built_to_order"
        ? parseBuildToOrderLeadTimeFromMessage(
            variant?.buildToOrderMessage?.value
          )
        : undefined;
    const nextRecord = {
      sku,
      availability,
      buildToOrderLeadTime
    };
    const currentRecord = recordsBySku.get(sku);

    if (!currentRecord) {
      recordsBySku.set(sku, nextRecord);
      continue;
    }

    if (
      currentRecord.availability === nextRecord.availability &&
      String(currentRecord.buildToOrderLeadTime || "") ===
        String(nextRecord.buildToOrderLeadTime || "")
    ) {
      continue;
    }

    conflictSkus.add(sku);
    skipped.push({
      reason: "duplicate_sku_conflict",
      sku,
      value: String(variant?.productAvailability?.value || "")
    });
  }

  for (const sku of conflictSkus) {
    recordsBySku.delete(sku);
  }

  return {
    records: Array.from(recordsBySku.values()),
    skipped
  };
}

function countAvailabilityRecords(records) {
  return records.reduce(
    (counts, record) => ({
      ...counts,
      [record.availability]: (counts[record.availability] || 0) + 1
    }),
    {}
  );
}

async function syncAvailabilityStateFromShopifyPage({
  after = "",
  first = 250
} = {}) {
  const { variants, pageInfo } = await getVariantAvailabilityStatePage({
    after,
    first
  });
  const { records, skipped } = mergeVariantAvailabilityRecords(variants);
  const savedRecords =
    await shopifyAvailabilityStateService.setAvailabilityStatuses(records);

  try {
    require("./catalog.service").clearCaches();
  } catch (error) {
    console.error("Unable to clear catalog caches after Shopify availability sync.", error);
  }

  return {
    availabilityCounts: countAvailabilityRecords(records),
    hasNextPage: pageInfo.hasNextPage,
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : "",
    scannedVariantCount: variants.length,
    skippedCount: skipped.length,
    skippedSamples: skipped.slice(0, 25),
    updatedCount: savedRecords.length
  };
}

function metafieldValueMatches(expectedMetafield, verifiedMetafield) {
  if (!verifiedMetafield) {
    return false;
  }

  const expectedValue = String(expectedMetafield.value);
  const verifiedValue = String(verifiedMetafield.value);

  if (expectedMetafield.type === "date_time") {
    return verifiedValue === expectedValue || verifiedValue.startsWith(expectedValue);
  }

  return verifiedValue === expectedValue;
}

function verifyMetafieldChanges({
  deleteKeys,
  metafields,
  ownerIds,
  verifiedMetafieldsByOwnerId
}) {
  const mismatches = [];

  for (const metafield of metafields) {
    const verified =
      verifiedMetafieldsByOwnerId[metafield.ownerId]?.[metafield.key] || null;

    if (!metafieldValueMatches(metafield, verified)) {
      mismatches.push(
        `${metafield.ownerId} ${metafield.key} expected ${metafield.value}, got ${
          verified ? verified.value : "blank"
        }`
      );
    }
  }

  for (const ownerId of ownerIds) {
    for (const key of deleteKeys) {
      if (verifiedMetafieldsByOwnerId[ownerId]?.[key]) {
        mismatches.push(`${ownerId} ${key} was not cleared`);
      }
    }
  }

  if (mismatches.length > 0) {
    throw createHttpError(
      502,
      `Shopify saved the request, but read-back did not match: ${mismatches.join(
        "; "
      )}`
    );
  }
}

async function updateVariantInventoryPolicy(productId, variants, inventoryPolicy) {
  if (!inventoryPolicy || variants.length === 0) {
    return [];
  }

  const updatedVariants = [];

  for (let index = 0; index < variants.length; index += 250) {
    const chunk = variants.slice(index, index + 250);
    const data = await shopifyGraphQL(
      `
        mutation UpdateProductVariantInventoryPolicy(
          $productId: ID!,
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkUpdate(
            productId: $productId,
            variants: $variants,
            allowPartialUpdates: false
          ) {
            productVariants {
              id
              inventoryPolicy
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        productId,
        variants: chunk.map((variant) => ({
          id: variant.id,
          inventoryPolicy
        }))
      },
      shopifyAvailabilityProfile
    );
    const payload = data?.productVariantsBulkUpdate || {};

    assertNoUserErrors(
      payload.userErrors,
      "Shopify variant inventory policy could not be saved."
    );
    updatedVariants.push(...(payload.productVariants || []));
  }

  return updatedVariants;
}

function getMetafieldChanges({
  ownerIds,
  availability,
  buildToOrderMessage,
  followUpDate
}) {
  const status = normalizeAvailabilityStatus(availability);
  const safeBuildToOrderMessage = normalizeBuildToOrderMessage(
    buildToOrderMessage
  );
  const safeFollowUpDate = normalizeDateText(followUpDate);
  const metafields = ownerIds.map((ownerId) => ({
    ownerId,
    namespace: metafieldNamespace,
    key: availabilityMetafieldKey,
    type: "single_line_text_field",
    value: availabilityValues[status]
  }));
  const deleteKeys = [];

  if (status === "backordered") {
    if (safeFollowUpDate) {
      metafields.push(
        ...ownerIds.flatMap((ownerId) => [
          {
            ownerId,
            namespace: metafieldNamespace,
            key: availabilityDateMetafieldKey,
            type: "date_time",
            value: formatAvailabilityDateTime(safeFollowUpDate)
          },
          {
            ownerId,
            namespace: metafieldNamespace,
            key: availabilityDateConfirmedMetafieldKey,
            type: "boolean",
            value: "true"
          }
        ])
      );
    } else {
      deleteKeys.push(
        availabilityDateMetafieldKey,
        availabilityDateConfirmedMetafieldKey
      );
    }
  } else if (status === "out_of_stock") {
    if (safeFollowUpDate) {
      metafields.push(
        ...ownerIds.map((ownerId) => ({
          ownerId,
          namespace: metafieldNamespace,
          key: availabilityDateMetafieldKey,
          type: "date_time",
          value: formatAvailabilityDateTime(safeFollowUpDate)
        }))
      );
    } else {
      deleteKeys.push(availabilityDateMetafieldKey);
    }

    metafields.push(
      ...ownerIds.map((ownerId) => ({
        ownerId,
        namespace: metafieldNamespace,
        key: availabilityDateConfirmedMetafieldKey,
        type: "boolean",
        value: "false"
      }))
    );
    deleteKeys.push(buildToOrderMessageMetafieldKey);
  } else if (status === "built_to_order") {
    deleteKeys.push(
      availabilityDateMetafieldKey,
      availabilityDateConfirmedMetafieldKey
    );

    if (safeBuildToOrderMessage) {
      metafields.push(
        ...ownerIds.map((ownerId) => ({
          ownerId,
          namespace: metafieldNamespace,
          key: buildToOrderMessageMetafieldKey,
          type: "single_line_text_field",
          value: safeBuildToOrderMessage
        }))
      );
    } else {
      deleteKeys.push(buildToOrderMessageMetafieldKey);
    }
  } else {
    deleteKeys.push(
      availabilityDateMetafieldKey,
      availabilityDateConfirmedMetafieldKey,
      buildToOrderMessageMetafieldKey
    );
  }

  if (status !== "built_to_order") {
    deleteKeys.push(buildToOrderMessageMetafieldKey);
  }

  return {
    deleteKeys: Array.from(new Set(deleteKeys)),
    metafields,
    status
  };
}

function getInventoryPolicyForAvailability(status) {
  if (status === "out_of_stock") {
    return "DENY";
  }

  if (status === "backordered" || status === "built_to_order") {
    return "CONTINUE";
  }

  return "";
}

async function updateAvailabilityInventoryPolicies(targetChanges) {
  const updatedVariants = [];
  const groups = new Map();

  for (const { changes, target } of targetChanges) {
    if (!changes.inventoryPolicy || changes.inventoryPolicyVariants.length === 0) {
      continue;
    }

    for (const variant of changes.inventoryPolicyVariants) {
      const productId = variant?.product?.id || target.productId;
      const groupKey = `${productId}:${changes.inventoryPolicy}`;
      const group = groups.get(groupKey) || {
        inventoryPolicy: changes.inventoryPolicy,
        productId,
        variants: []
      };

      group.variants.push(variant);
      groups.set(groupKey, group);
    }
  }

  for (const group of groups.values()) {
    if (!group.productId) {
      continue;
    }

    updatedVariants.push(
      ...(await updateVariantInventoryPolicy(
        group.productId,
        group.variants,
        group.inventoryPolicy
      ))
    );
  }

  return updatedVariants;
}

async function syncVariantAvailabilityMetafields(records, options = {}) {
  const safeRecords = (records || [])
    .map(normalizeAvailabilitySyncRecord)
    .filter(Boolean);

  if (safeRecords.length === 0) {
    return {
      failed: 0,
      matched: 0,
      requested: 0,
      updated: 0,
      unchanged: 0
    };
  }

  const targets = await getAvailabilityVariantTargets(safeRecords);
  const failedTargets = targets.filter((target) => target.ok === false);
  const matchedTargets = targets.filter((target) => target.ok !== false);
  const targetChanges = matchedTargets.map((target) => ({
    target,
    changes: getAvailabilityTargetChanges(target)
  }));
  const changedTargets = targetChanges.filter(
    ({ changes }) =>
      changes.metafieldsToSet.length > 0 ||
      changes.deleteKeysByOwnerId.size > 0 ||
      changes.inventoryPolicyVariants.length > 0
  );

  if (!options.dryRun && changedTargets.length > 0) {
    const metafieldsToSet = changedTargets.flatMap(
      ({ changes }) => changes.metafieldsToSet
    );
    const metafieldsToDelete = changedTargets.flatMap(({ changes }) =>
      Array.from(changes.deleteKeysByOwnerId.entries()).flatMap(([ownerId, keys]) =>
        keys.map((key) => ({
          ownerId,
          namespace: metafieldNamespace,
          key
        }))
      )
    );

    await setMetafields(metafieldsToSet);
    await deleteMetafieldIdentifiers(metafieldsToDelete);
    await updateAvailabilityInventoryPolicies(changedTargets);
  }

  if (!options.dryRun && matchedTargets.length > 0) {
    await shopifyAvailabilityStateService.setAvailabilityStatuses(
      matchedTargets.map((target) => ({
        sku: target.sku,
        availability: target.availability,
        buildToOrderLeadTime:
          target.availability === "built_to_order"
            ? target.buildToOrderLeadTime
            : undefined
      }))
    );
  }

  return {
    failed: failedTargets.length,
    failures: failedTargets.map((target) => ({
      error: target.error,
      sku: target.sku
    })),
    failureSamples: failedTargets.slice(0, 25).map((target) => ({
      error: target.error,
      sku: target.sku
    })),
    matched: matchedTargets.length,
    requested: safeRecords.length,
    source: options.source || "",
    updated: changedTargets.length,
    unchanged: matchedTargets.length - changedTargets.length
  };
}

async function updateProductAvailability({
  sku,
  availability,
  buildToOrderLeadTime,
  buildToOrderMessage,
  followUpDate,
  productName
}) {
  const requestedStatus = normalizeAvailabilityStatus(availability);

  if (requestedStatus === "backordered") {
    const warehouseQtyAvailable = await getWarehouseQtyAvailableForSku(sku);

    if (warehouseQtyAvailable > 0) {
      throw createHttpError(
        400,
        `This product has ${warehouseQtyAvailable} in DPP Warehouse, so it cannot be set to Backordered.`
      );
    }
  }

  const safeSku = normalizeSku(sku);
  const productMatch = await findProductBySku(safeSku, { productName });
  const variants = await getProductVariants(productMatch.productId);
  const variantsToUpdate = variants.filter(
    (variant) => normalizeSku(variant?.sku) === safeSku
  );
  const variantIds = variantsToUpdate.map((variant) => variant.id).filter(Boolean);

  if (variantIds.length === 0) {
    throw createHttpError(404, "No Shopify variants matched this SKU.");
  }

  const { deleteKeys, metafields, status } = getMetafieldChanges({
    ownerIds: variantIds,
    availability: requestedStatus,
    buildToOrderMessage,
    followUpDate
  });
  const inventoryPolicy = getInventoryPolicyForAvailability(status);

  const savedMetafields = await setMetafields(metafields);
  const deletedMetafields = await deleteMetafields(variantIds, deleteKeys);
  const verifiedMetafieldsByVariantId = await getVariantAvailabilityMetafields(
    variantIds
  );
  verifyMetafieldChanges({
    deleteKeys,
    metafields,
    ownerIds: variantIds,
    verifiedMetafieldsByOwnerId: verifiedMetafieldsByVariantId
  });
  const updatedVariants = inventoryPolicy
    ? await updateVariantInventoryPolicy(
        productMatch.productId,
        variantsToUpdate,
        inventoryPolicy
      )
    : [];
  const savedAvailabilityStatus =
    await shopifyAvailabilityStateService.setAvailabilityStatus({
      sku,
      availability: status,
      buildToOrderLeadTime:
        status === "built_to_order" ? buildToOrderLeadTime : undefined
    });
  try {
    require("./catalog.service").clearCaches();
  } catch (error) {
    console.error("Unable to clear catalog caches after Shopify availability update.", error);
  }

  return {
    availability: savedAvailabilityStatus || status,
    availabilityText: availabilityValues[status],
    deletedMetafields,
    duplicateSkuMatchCount: productMatch.duplicateSkuMatchCount,
    handle: productMatch.handle,
    matchedSku: productMatch.matchedSku,
    matchedVariantId: productMatch.matchedVariantId,
    productId: productMatch.productId,
    productStatus: productMatch.productStatus,
    productTitle: productMatch.productTitle,
    savedMetafields,
    updatedInventoryPolicyCount: updatedVariants.length,
    updatedMetafieldOwnerCount: variantIds.length,
    verifiedMetafieldsByVariantId
  };
}

function formatAdminOrderUrl(storeDomain, legacyResourceId) {
  return `https://${storeDomain}/admin/orders/${encodeURIComponent(legacyResourceId)}`;
}

function formatOrderResult(node, storeDomain) {
  return {
    adminUrl: formatAdminOrderUrl(storeDomain, node.legacyResourceId),
    createdAt: node.createdAt,
    customerEmail: node.email || node.customer?.email || "",
    id: node.id,
    legacyResourceId: String(node.legacyResourceId || ""),
    orderNumber: node.name || "",
    shopifyOrderNumber: Number(node.number || 0)
  };
}

async function searchOrders(query) {
  const data = await shopifyGraphQL(
    `
      query SearchOrders($first: Int!, $query: String!) {
        orders(first: $first, query: $query, reverse: true, sortKey: CREATED_AT) {
          nodes {
            id
            legacyResourceId
            name
            number
            email
            createdAt
            customer {
              email
            }
            lineItems(first: 25) {
              nodes {
                sku
              }
            }
          }
        }
      }
    `,
    {
      first: 25,
      query
    }
  );

  return Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];
}

function scoreCandidate(node, { normalizedEmail, lookupCreatedAt, normalizedSkus }) {
  let score = 0;

  if (getCandidateEmails(node).includes(normalizedEmail)) {
    score += 60;
  }

  const candidateSkus = getCandidateSkus(node);
  const sharedSkuCount = normalizedSkus.filter((sku) => candidateSkus.includes(sku)).length;

  if (sharedSkuCount > 0) {
    score += sharedSkuCount * 25;
  }

  if (lookupCreatedAt) {
    const lookupTime = Date.parse(lookupCreatedAt);
    const candidateTime = Date.parse(String(node?.createdAt || ""));

    if (!Number.isNaN(lookupTime) && !Number.isNaN(candidateTime)) {
      const minutesApart = Math.abs(lookupTime - candidateTime) / 60000;

      if (minutesApart <= 5) {
        score += 40;
      } else if (minutesApart <= 30) {
        score += 30;
      } else if (minutesApart <= 120) {
        score += 18;
      } else if (minutesApart <= 1440) {
        score += 8;
      }
    }
  }

  return score;
}

function pickBestCandidate(candidates, rankingContext) {
  if (candidates.length <= 1) {
    return candidates[0] || null;
  }

  const rankedCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, rankingContext)
    }))
    .sort((left, right) => right.score - left.score);

  if (rankedCandidates[0].score <= 0) {
    return null;
  }

  if (!rankedCandidates[1] || rankedCandidates[0].score > rankedCandidates[1].score) {
    return rankedCandidates[0].candidate;
  }

  return null;
}

async function resolveOrder({ orderNumber, customerEmail, createdAt, skus }) {
  assertLookupInput({ orderNumber, customerEmail, createdAt, skus });

  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const normalizedEmail = normalizeEmail(customerEmail);
  const normalizedSkus = Array.from(
    new Set((Array.isArray(skus) ? skus : []).map((sku) => normalizeSku(sku)).filter(Boolean))
  );
  const { storeDomain } = getShopifyConfig();
  const cacheContext = getResolveCacheContext({
    createdAt,
    normalizedEmail,
    normalizedOrderNumber,
    normalizedSkus,
    storeDomain
  });
  const cacheKey = getResolveCacheKey(cacheContext);
  let cachedOrder = null;

  try {
    cachedOrder = await getCachedResolvedOrder(cacheKey);
  } catch (error) {
    console.warn("[shopify] Unable to read order resolve cache.", error);
  }

  if (cachedOrder) {
    return cachedOrder;
  }

  const cacheAndReturn = async (order) => {
    try {
      await cacheResolvedOrder(cacheKey, cacheContext, order);
    } catch (error) {
      console.warn("[shopify] Unable to write order resolve cache.", error);
    }

    return order;
  };
  const searchQueries = [
    `name:${normalizedOrderNumber}`,
    `name:${quoteSearchValue(`#${normalizedOrderNumber}`)}`,
    `email:${quoteSearchValue(normalizedEmail)} name:${normalizedOrderNumber}`,
    `email:${quoteSearchValue(normalizedEmail)} name:${quoteSearchValue(`#${normalizedOrderNumber}`)}`,
    `email:${quoteSearchValue(normalizedEmail)}`
  ];

  const candidates = new Map();

  for (const searchQuery of searchQueries) {
    const nodes = await searchOrders(searchQuery);

    for (const node of nodes) {
      const key = String(node.id || "");

      if (key) {
        candidates.set(key, node);
      }
    }

    const allCandidates = Array.from(candidates.values());
    const exactNumberMatches = allCandidates.filter(
      (node) =>
        normalizeOrderNumber(node.name) === normalizedOrderNumber ||
        String(node.number || "") === normalizedOrderNumber
    );
    const exactMatches = exactNumberMatches.filter(
      (node) => getCandidateEmails(node).includes(normalizedEmail)
    );

    if (exactMatches.length === 1) {
      return cacheAndReturn(formatOrderResult(exactMatches[0], storeDomain));
    }

    if (exactMatches.length > 1) {
      const rankedExactMatch = pickBestCandidate(exactMatches, {
        lookupCreatedAt: createdAt,
        normalizedEmail,
        normalizedSkus
      });

      if (rankedExactMatch) {
        return cacheAndReturn(formatOrderResult(rankedExactMatch, storeDomain));
      }

      throw createHttpError(409, "Multiple Shopify orders matched this order number and email.");
    }

    if (exactNumberMatches.length === 1) {
      return cacheAndReturn(formatOrderResult(exactNumberMatches[0], storeDomain));
    }

    if (exactNumberMatches.length > 1) {
      const rankedNumberMatch = pickBestCandidate(exactNumberMatches, {
        lookupCreatedAt: createdAt,
        normalizedEmail,
        normalizedSkus
      });

      if (rankedNumberMatch) {
        return cacheAndReturn(formatOrderResult(rankedNumberMatch, storeDomain));
      }

      throw createHttpError(
        409,
        "Multiple Shopify orders matched this order number. Refine the lookup."
      );
    }
  }

  throw createHttpError(404, "No Shopify order matched this order number and customer email.");
}

module.exports = {
  getQuickShipMetafieldStates,
  resolveOrder,
  syncAvailabilityStateFromShopifyPage,
  syncVariantAvailabilityMetafields,
  updateProductAvailability,
  updateQuickShipMetafields
};
