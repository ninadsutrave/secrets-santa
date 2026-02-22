/* Background service worker:
   - Captures X-Consul-Token from Consul UI requests
   - Lists direct keys via /v1/kv/<prefix>?keys&separator=/
   - Fetches key values via /v1/kv/<fullKey>
   - Handles commands (keyboard shortcut) */

importScripts(
  "../shared/constants.js",
  "../shared/storage.js",
  "../shared/consul.js"
);

const { CONSTANTS, STORAGE, CONSUL } = globalThis.SECRETS_SANTA;

let cachedToken = "";

STORAGE.getToken((token) => {
  if (typeof token === "string") cachedToken = token;
});

/* Persists the latest X-Consul-Token so popup requests can reuse it. */
function updateToken(token) {
  if (!token || typeof token !== "string") return;
  if (token === cachedToken) return;
  cachedToken = token;
  STORAGE.setToken(token);
}

function clearToken() {
  cachedToken = "";
  STORAGE.clearToken();
}

function isAclNotFound(errorText) {
  return String(errorText || "").toLowerCase().includes("acl not found");
}

function isPermissionDenied(errorText) {
  return String(errorText || "").toLowerCase().includes("permission denied");
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const initiator = String(details?.initiator || "");
    if (initiator.startsWith(`chrome-extension://${chrome.runtime.id}`)) return;
    if (typeof details?.tabId === "number" && details.tabId < 0) return;

    const headers = details.requestHeaders || [];
    const tokenHeader = headers.find(
      (h) => String(h?.name || "").toLowerCase() === CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST_LOWER
    );
    if (tokenHeader?.value) updateToken(tokenHeader.value);
  },
  { urls: CONSTANTS.WEB_REQUEST_URLS },
  ["requestHeaders", "extraHeaders"]
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== CONSTANTS.COMMANDS.OPEN_UI) return;
  const url = chrome.runtime.getURL("src/popup/popup.html");
  chrome.tabs.create({ url });
});

function getActiveToken() {
  if (cachedToken) return Promise.resolve(cachedToken);
  return new Promise((resolve) => STORAGE.getToken((t) => resolve(t || "")));
}

/* Fetches a single KV value and decodes base64 payload returned by Consul. */
async function fetchKeyValue({ host, dc, fullKey, token }) {
  const url = CONSUL.buildKvValueUrl({ host, dc, fullKey });
  const doFetch = async (t) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers });
  };

  let res = await doFetch(token);
  let errorText = "";

  if (!res.ok) {
    try {
      if (res.status === 403 || res.status === 401) {
        errorText = String(await res.text()).slice(0, 280);
      }
    } catch {
      errorText = "";
    }

    const defaultAclPolicy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
    if (token && (res.status === 401 || res.status === 403) && defaultAclPolicy === "deny") {
      if (isAclNotFound(errorText) || isPermissionDenied(errorText) || !errorText) {
        const retry = await doFetch("");
        if (retry.ok) {
          clearToken();
          res = retry;
          errorText = "";
        }
      }
    }

    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && isAclNotFound(errorText)) {
        clearToken();
      }
      return { ok: false, status: res.status, errorText };
    }
  }

  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) return { ok: false, status: 0 };
  const item = json[0];
  const value = item?.Value ? CONSUL.decodeBase64Utf8(item.Value) : "";
  return { ok: true, value };
}

/* Lists direct leaf keys under a prefix and counts folders (non-recursive). */
async function listDirectKeys({ host, dc, prefix, token }) {
  const url = CONSUL.buildKvListKeysUrl({ host, dc, prefix });
  const doFetch = async (t) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers });
  };

  let res = await doFetch(token);
  let errorText = "";

  if (!res.ok) {
    try {
      errorText = String(await res.text()).slice(0, 360);
    } catch {
      errorText = "";
    }

    const defaultAclPolicy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
    if (token && (res.status === 401 || res.status === 403) && defaultAclPolicy === "deny") {
      if (isAclNotFound(errorText) || isPermissionDenied(errorText) || !errorText) {
        const retry = await doFetch("");
        if (retry.ok) {
          clearToken();
          res = retry;
          errorText = "";
        }
      }
    }

    if (!res.ok) {
      if (!token && defaultAclPolicy === "deny" && !errorText) {
        errorText =
          "No Consul token captured yet. Open the Consul UI (logged in) and try again so Santa can reuse your token.";
      }
      if ((res.status === 401 || res.status === 403) && isAclNotFound(errorText)) {
        clearToken();
      }
      return { ok: false, status: res.status, errorText };
    }
  }

  const json = await res.json();
  if (!Array.isArray(json)) return { ok: false, status: 0, errorText: "Unexpected response." };

  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const base = p.replace(/^\//, "");
  const keys = [];
  let folders = 0;

  json.forEach((full) => {
    if (typeof full !== "string") return;
    if (!full.startsWith(base)) return;
    const remainder = full.slice(base.length);
    if (!remainder) return;
    if (remainder.endsWith("/")) {
      folders += 1;
      return;
    }
    if (remainder.includes("/")) return;
    keys.push(remainder);
  });

  return { ok: true, keys, folders };
}

/* Fetches values for a known list of keys under a prefix with limited concurrency. */
async function fetchVisibleValues({ host, dc, prefix, keys }) {
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const token = await getActiveToken();
  if (token) updateToken(token);

  if (!Array.isArray(keys) || keys.length === 0) {
    return { keys: {}, prefix: `/${p.replace(/\/$/, "")}`, failed: 0, skipped: 0 };
  }

  const results = {};
  let failed = 0;
  let skipped = 0;
  let firstAuthError = "";

  const concurrency = 10;
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (key) => {
        const safeKey = String(key || "").trim();
        if (!safeKey) return { key: "", ok: false, status: 0 };
        const fullKey = `${p}${safeKey}`;
        const res = await fetchKeyValue({ host, dc, fullKey, token });
        return { key: safeKey, ...res };
      })
    );

    batchResults.forEach((r) => {
      if (!r.key) return;
      if (!r.ok) {
        if (r.status === 404) {
          skipped += 1;
          return;
        }
        if (!firstAuthError && (r.status === 401 || r.status === 403) && r.errorText) {
          firstAuthError = r.errorText;
        }
        failed += 1;
        return;
      }
      results[r.key] = r.value ?? "";
    });
  }

  if (failed === keys.length && keys.length > 0) {
    if (firstAuthError) return { error: firstAuthError };
    return {
      error: "Unable to fetch key values. Make sure Consul requests include X-Consul-Token, then refresh the page and try again."
    };
  }

  return { keys: results, prefix: `/${p.replace(/\/$/, "")}`, failed, skipped };
}

/* Lists keys for the current prefix and fetches all direct leaf values. */
async function fetchPageValues({ host, dc, prefix }) {
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const token = await getActiveToken();

  const listRes = await listDirectKeys({ host, dc, prefix: p, token });
  if (!listRes.ok) {
    if (isAclNotFound(listRes.errorText)) {
      return {
        error: "Consul says: ACL not found. The captured token is invalid/expired. Refresh the Consul UI page so Santa can capture a fresh token, then try again."
      };
    }
    if (listRes.status === 403) {
      return { error: listRes.errorText || "Permission denied while listing keys (key:read required)." };
    }
    return { error: `Failed to list keys (HTTP ${listRes.status || "?"}).` };
  }

  const keys = Array.isArray(listRes.keys) ? listRes.keys : [];
  if (keys.length === 0) {
    return { keys: {}, prefix: `/${p.replace(/\/$/, "")}`, failed: 0, skipped: Number(listRes.folders || 0) };
  }

  const valuesRes = await fetchVisibleValues({ host, dc, prefix: p, keys });
  if (valuesRes?.error) return valuesRes;
  return { ...valuesRes, skipped: Number(valuesRes.skipped || 0) + Number(listRes.folders || 0) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CONSTANTS.MESSAGE_TYPES.SET_TOKEN) {
    const token = String(message?.token || "");
    if (token) updateToken(token);
    sendResponse({ ok: Boolean(token) });
    return;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_KEYS) {
    getActiveToken()
      .then((token) => {
        if (token) updateToken(token);
        sendResponse({ token: token || "" });
      })
      .catch(() => sendResponse({ error: "Failed to fetch keys." }));
    return true;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_VISIBLE_VALUES) {
    fetchVisibleValues(message).then(sendResponse).catch(() => sendResponse({ error: "Failed to fetch keys." }));
    return true;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_PAGE_VALUES) {
    fetchPageValues(message).then(sendResponse).catch(() => sendResponse({ error: "Failed to fetch keys." }));
    return true;
  }
});
