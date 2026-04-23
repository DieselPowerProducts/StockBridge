const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const DEFAULT_API_VERSION = "2025-10";
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

let accessTokenCache = {
  token: "",
  expiresAt: 0
};

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

function getShopifyConfig() {
  return {
    apiVersion: String(process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
    clientId: getRequiredEnv("SHOPIFY_CLIENT_ID"),
    clientSecret: getRequiredEnv("SHOPIFY_CLIENT_SECRET"),
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

function quoteSearchValue(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function assertLookupInput({ orderNumber, customerEmail }) {
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

async function fetchShopifyAccessToken() {
  if (accessTokenCache.token && accessTokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MS) {
    return accessTokenCache.token;
  }

  const { clientId, clientSecret, storeDomain } = getShopifyConfig();
  const response = await fetchFromShopify(
    `https://${storeDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
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
  accessTokenCache = {
    token: payload.access_token,
    expiresAt:
      Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 0)
  };

  return accessTokenCache.token;
}

async function shopifyGraphQL(query, variables) {
  const { apiVersion, storeDomain } = getShopifyConfig();
  const accessToken = await fetchShopifyAccessToken();
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

  if (!response.ok) {
    throw createHttpError(
      502,
      payload?.errors?.[0]?.message || "Shopify request failed."
    );
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw createHttpError(502, payload.errors[0].message || "Shopify request failed.");
  }

  return payload?.data;
}

function formatAdminOrderUrl(storeDomain, legacyResourceId) {
  return `https://${storeDomain}/admin/orders/${encodeURIComponent(legacyResourceId)}`;
}

function formatOrderResult(node, storeDomain) {
  return {
    adminUrl: formatAdminOrderUrl(storeDomain, node.legacyResourceId),
    createdAt: node.createdAt,
    customerEmail: node.email || "",
    id: node.id,
    legacyResourceId: String(node.legacyResourceId || ""),
    orderNumber: node.name || ""
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
            email
            createdAt
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

async function resolveOrder({ orderNumber, customerEmail }) {
  assertLookupInput({ orderNumber, customerEmail });

  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const normalizedEmail = normalizeEmail(customerEmail);
  const { storeDomain } = getShopifyConfig();
  const searchQueries = [
    `email:${quoteSearchValue(normalizedEmail)} name:${quoteSearchValue(normalizedOrderNumber)}`,
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

    const exactMatches = Array.from(candidates.values()).filter(
      (node) =>
        normalizeEmail(node.email) === normalizedEmail &&
        normalizeOrderNumber(node.name) === normalizedOrderNumber
    );

    if (exactMatches.length === 1) {
      return formatOrderResult(exactMatches[0], storeDomain);
    }

    if (exactMatches.length > 1) {
      throw createHttpError(409, "Multiple Shopify orders matched this order number and email.");
    }
  }

  throw createHttpError(404, "No Shopify order matched this order number and customer email.");
}

module.exports = {
  resolveOrder
};
