const { loadLocalEnv } = require("../config/env");

loadLocalEnv();

const defaultBaseUrl = "https://dpp.skunexus.com";
const sessionTtlMs = 15 * 60 * 1000;

let sessionCookie = "";
let sessionCreatedAt = 0;
let loginPromise = null;

function getConfig() {
  const baseUrl = (process.env.SKU_NEXUS_BASE_URL || defaultBaseUrl).replace(
    /\/+$/,
    ""
  );
  const email = process.env.SKU_NEXUS_EMAIL;
  const password = process.env.SKU_NEXUS_PASSWORD;
  const missing = [
    ["SKU_NEXUS_EMAIL", email],
    ["SKU_NEXUS_PASSWORD", password]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const error = new Error(
      `Missing SKU Nexus configuration: ${missing.join(", ")}`
    );
    error.statusCode = 503;
    throw error;
  }

  return {
    baseUrl,
    email,
    password
  };
}

function getJsonHeaders(extraHeaders = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...extraHeaders
  };
}

function getSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    return "";
  }

  return setCookie.split(";")[0];
}

async function readJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("SKU Nexus returned an invalid JSON response.");
  }
}

async function login(force = false) {
  if (
    !force &&
    sessionCookie &&
    Date.now() - sessionCreatedAt < sessionTtlMs
  ) {
    return sessionCookie;
  }

  if (!force && loginPromise) {
    return loginPromise;
  }

  loginPromise = (async () => {
    const { baseUrl, email, password } = getConfig();
    const response = await fetch(`${baseUrl}/api/users/login`, {
      method: "POST",
      headers: getJsonHeaders(),
      body: JSON.stringify({ email, password })
    });
    const payload = await readJson(response);

    if (!response.ok || !payload.success) {
      const error = new Error("SKU Nexus login failed.");
      error.statusCode = 502;
      throw error;
    }

    const cookie = getSessionCookie(response);

    if (!cookie) {
      const error = new Error("SKU Nexus login did not return a session cookie.");
      error.statusCode = 502;
      throw error;
    }

    sessionCookie = cookie;
    sessionCreatedAt = Date.now();

    return sessionCookie;
  })();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

async function query(queryText, { retry = true } = {}) {
  const { baseUrl } = getConfig();
  const cookie = await login();
  const response = await fetch(`${baseUrl}/api/query`, {
    method: "POST",
    headers: getJsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ query: queryText })
  });

  if (response.status === 401 && retry) {
    sessionCookie = "";
    await login(true);
    return query(queryText, { retry: false });
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const error = new Error(`SKU Nexus query failed with status ${response.status}.`);
    error.statusCode = 502;
    throw error;
  }

  if (payload.errors?.length) {
    const error = new Error(
      payload.errors[0]?.message || "SKU Nexus GraphQL query failed."
    );
    error.statusCode = 502;
    throw error;
  }

  return payload.data;
}

async function rest(path, { method = "GET", body, retry = true } = {}) {
  const { baseUrl } = getConfig();
  const cookie = await login();
  const cleanPath = path.startsWith("/api/")
    ? path
    : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  const response = await fetch(`${baseUrl}${cleanPath}`, {
    method,
    headers: getJsonHeaders({ Cookie: cookie }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 401 && retry) {
    sessionCookie = "";
    await login(true);
    return rest(path, { method, body, retry: false });
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const message =
      payload.message ||
      payload.error ||
      payload.errors?.[0]?.message ||
      `SKU Nexus request failed with status ${response.status}.`;
    const error = new Error(message);
    error.statusCode =
      response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }

  return payload;
}

module.exports = {
  query,
  rest
};
