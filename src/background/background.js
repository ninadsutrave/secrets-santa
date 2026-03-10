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

const cachedTokens = {};
const rejectedTokensByHost = {}; // { host: Map<token, expiresAt> }
const validationCache = {}; // { host: { token: string, expires: number } }
const validationInFlight = {}; // { host: { token: string, promise: Promise } }

const REJECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes — rejected tokens expire so transient errors don't blacklist permanently

function normalizeHost(host) {
  return String(host || "").toLowerCase().trim();
}

/* Returns true only if the token is in the rejection cache AND its TTL has not expired. */
function isTokenRejected(h, candidate) {
  const map = rejectedTokensByHost[h];
  if (!map) return false;
  const expiresAt = map.get(candidate);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    map.delete(candidate);
    return false;
  }
  return true;
}

/* Adds a token to the per-host rejection cache with a TTL. */
function addTokenRejection(h, candidate) {
  if (!rejectedTokensByHost[h]) rejectedTokensByHost[h] = new Map();
  rejectedTokensByHost[h].set(candidate, Date.now() + REJECTION_TTL_MS);
}

/* Persists the latest X-Consul-Token so popup requests can reuse it. */
function updateToken(token, host) {
  if (!token || typeof token !== "string") return;
  const h = String(host || "").toLowerCase();
  if (!h) return;
  if (token === cachedTokens[h]) return;
  cachedTokens[h] = token;
  STORAGE.setTokenForHost(h, token);
}

function clearToken(host) {
  const h = normalizeHost(host);
  if (!h) return;
  delete cachedTokens[h];
  STORAGE.clearTokenForHost(h);
  if (rejectedTokensByHost[h]) delete rejectedTokensByHost[h];
  if (validationCache[h]) delete validationCache[h];
  if (validationInFlight[h]) delete validationInFlight[h];
}

function isAclNotFound(errorText) {
  return String(errorText || "").toLowerCase().includes("acl not found");
}

function isPermissionDenied(errorText) {
  return String(errorText || "").toLowerCase().includes("permission denied");
}

// Validates a Consul token against the /v1/acl/token/self endpoint.
// Returns "valid" | "invalid" | "unreachable".
// Callers MUST distinguish "unreachable" from "invalid":
//   - "valid":       token confirmed good — store it.
//   - "invalid":     server explicitly rejected token — discard it.
//   - "unreachable": network/CORS error — token state unknown, DO NOT clear it.
async function validateToken(host, token) {
  try {
    const h = String(host || "").toLowerCase();
    const t = String(token || "");
    if (!h || !t) return "invalid";

    // 1. Check validation cache (only populated on confirmed "valid" results)
    if (validationCache[h] && validationCache[h].token === t && validationCache[h].expires > Date.now()) {
      return "valid";
    }

    // 2. Coalesce concurrent validations for the same host+token
    if (validationInFlight[h] && validationInFlight[h].token === t) {
      return validationInFlight[h].promise;
    }

    const domainLike = /^[a-z0-9.-]+(:\d+)?$/i;
    if (!domainLike.test(h)) return "invalid";

    const promise = (async () => {
      // Returns "valid" | "invalid" | "unreachable".
      // "unreachable" means a network/CORS error — the token's validity is unknown, try the other scheme.
      // "invalid" means the server responded and explicitly rejected the token — don't bother retrying.
      const doCheck = async (scheme) => {
        try {
          const url = `${scheme}://${h}/v1/acl/token/self`;
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t }
          });
          if (res.ok) return "valid";
          const policy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
          if ((res.status === 401 || res.status === 403) && policy === "deny") {
            try {
              const errorText = String(await res.text()).toLowerCase();
              if (errorText.includes("acl not found")) {
                return "invalid";
              }
            } catch { }
            // 401/403 with deny policy but not "acl not found" — token exists but has limited permissions.
            return "valid";
          }
          return "invalid";
        } catch {
          // Network error, CORS failure, or server unreachable — don't treat as an explicit rejection.
          return "unreachable";
        }
      };

      // Only fall back to HTTP when HTTPS is unreachable (network error), not when the token is explicitly rejected.
      let result = await doCheck("https");
      if (result === "unreachable") result = await doCheck("http");

      if (result === "valid") {
        validationCache[h] = { token: t, expires: Date.now() + 300000 }; // Cache for 5 mins
      }
      delete validationInFlight[h];
      return result; // "valid" | "invalid" | "unreachable"
    })();

    validationInFlight[h] = { token: t, promise };
    return promise;
  } catch {
    return "unreachable"; // Unexpected error — don't treat as an explicit token rejection
  }
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
    if (tokenHeader?.value) {
      try {
        const host = new URL(details.url).host;
        const candidate = String(tokenHeader.value || "");
        const h = String(host || "").toLowerCase();
        if (isTokenRejected(h, candidate)) return;
        validateToken(host, candidate)
          .then((status) => {
            if (status === "valid") {
              updateToken(candidate, host);
            } else if (status === "invalid") {
              // Server explicitly rejected this token — evict it.
              if (cachedTokens[h] && cachedTokens[h] === candidate) clearToken(h);
              addTokenRejection(h, candidate);
            }
            // "unreachable": server down / network error — don't alter stored state.
          })
          .catch(() => { });
      } catch { }
    }
  },
  { urls: CONSTANTS.WEB_REQUEST_URLS },
  (() => {
    // Firefox can sometimes be picky about "extraHeaders" if not specifically needed for hidden headers.
    // Chrome needs it for some sensitive headers. We'll use it only where strictly necessary or if not Firefox.
    const isFirefox = typeof browser !== "undefined" || (typeof navigator !== "undefined" && /Firefox/.test(navigator.userAgent));
    const specs = ["requestHeaders"];
    if (!isFirefox) specs.push("extraHeaders");
    return specs;
  })()
);

chrome.commands.onCommand.addListener((command) => {
  if (command === CONSTANTS.COMMANDS.OPEN_UI) {
    chrome.action.openPopup();
  }
});

async function getActiveToken(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return "";

  // If a validation is in flight, wait for it
  if (validationInFlight[h]) {
    await validationInFlight[h].promise;
  }

  if (cachedTokens[h]) return cachedTokens[h];
  return new Promise((resolve) => STORAGE.getTokenForHost(h, (t) => resolve(t || "")));
}

/* Fetches a single KV value and decodes base64 payload returned by Consul. */
async function fetchKeyValue({ scheme, host, dc, fullKey, token }) {
  const url = CONSUL.buildKvValueUrl({ scheme, host, dc, fullKey });
  const doFetch = async (t) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers });
  };

  let res = await doFetch(token);
  let errorText = "";

  if (!res.ok) {
    try {
      if (res.status === 403 || res.status === 401) {
        errorText = String(await res.text()).slice(0, 360);
      }
    } catch {
      errorText = "";
    }

    const defaultAclPolicy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
    if (res.status === 401 || res.status === 403) {
      try {
        const latest = await getActiveToken(host);
        if (latest && latest !== token) {
          const retryWithLatest = await doFetch(latest);
          if (retryWithLatest.ok) {
            res = retryWithLatest;
            errorText = "";
          }
        }
      } catch { }
    }
    if (token && (res.status === 401 || res.status === 403) && defaultAclPolicy === "deny") {
      if (isAclNotFound(errorText) || isPermissionDenied(errorText) || !errorText) {
        const retry = await doFetch("");
        if (retry.ok) {
          clearToken(host);
          res = retry;
          errorText = "";
        }
      }
    }

    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && isAclNotFound(errorText)) {
        clearToken(host);
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
async function listDirectKeys({ scheme, host, dc, prefix, token }) {
  const url = CONSUL.buildKvListKeysUrl({ scheme, host, dc, prefix });
  const doFetch = async (t) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers });
  };

  let res = await doFetch(token);
  let errorText = "";

  if (!res.ok) {
    // Read the body exactly once — a Response body can only be consumed once.
    // All retry branches below replace `res` with fresh responses, so errorText
    // from the original failure is preserved until a retry explicitly clears it.
    try {
      errorText = String(await res.text()).slice(0, 360);
    } catch {
      errorText = "";
    }

    const defaultAclPolicy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
    if (res.status === 401 || res.status === 403) {
      try {
        const latest = await getActiveToken(host);
        if (latest && latest !== token) {
          const retryWithLatest = await doFetch(latest);
          if (retryWithLatest.ok) {
            res = retryWithLatest;
            errorText = "";
          }
        }
      } catch { }
    }
    // Avoid retrying without a token when policy is "deny" (common in org-hosted Consul) to prevent confusing 404s.
    if (token && (res.status === 401 || res.status === 403) && defaultAclPolicy !== "deny") {
      if (isAclNotFound(errorText) || isPermissionDenied(errorText) || !errorText) {
        const retry = await doFetch("");
        if (retry.ok) {
          clearToken(host);
          res = retry;
          errorText = "";
        }
      }
    }

    if (!res.ok) {
      const defaultAclPolicyFinal = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
      if (res.status === 404) {
        const notFoundMsg =
          defaultAclPolicyFinal === "deny"
            ? (token ? "Santa can't find these secrets. Check the folder path or datacenter, or interact with the Consul UI to refresh your session." : "Santa couldn't grab your Consul session. Please interact with the Consul UI while logged in and try again.")
            : "Santa can't find these secrets. Check the folder path or datacenter, or interact with the Consul UI and try again.";
        return { ok: false, status: 404, errorText: notFoundMsg };
      }
      if (!token && defaultAclPolicyFinal === "deny" && !errorText) {
        errorText =
          "Santa couldn't grab your Consul session. Please open the Consul UI, make sure you're logged in, then try again.";
      }
      if ((res.status === 401 || res.status === 403) && isAclNotFound(errorText)) {
        clearToken(host);
      } else if ((res.status === 401 || res.status === 403) && isPermissionDenied(errorText)) {
        clearToken(host);
      }
      return { ok: false, status: res.status, errorText };
    }
  }

  const json = await res.json();
  if (!Array.isArray(json)) return { ok: false, status: 0, errorText: "Santa got an unexpected response from Consul. Please try reloading." };

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

async function putKeyValue({ scheme, host, dc, fullKey, token, value }) {
  const url = CONSUL.buildKvPutUrl({ scheme, host, dc, fullKey });
  const doFetch = async (t) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "PUT", credentials: "include", headers, body: String(value ?? "") });
  };

  let res = await doFetch(token);
  let errorText = "";

  if (!res.ok) {
    try {
      if (res.status === 403 || res.status === 401) {
        errorText = String(await res.text()).slice(0, 360);
      }
    } catch {
      errorText = "";
    }

    const defaultAclPolicy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
    if (res.status === 401 || res.status === 403) {
      try {
        const latest = await getActiveToken(host);
        if (latest && latest !== token) {
          const retryWithLatest = await doFetch(latest);
          if (retryWithLatest.ok) {
            res = retryWithLatest;
            errorText = "";
          }
        }
      } catch { }
    }
    if (token && (res.status === 401 || res.status === 403) && defaultAclPolicy === "deny") {
      if (isAclNotFound(errorText) || isPermissionDenied(errorText) || !errorText) {
        const retry = await doFetch("");
        if (retry.ok) {
          clearToken(host);
          res = retry;
          errorText = "";
        }
      }
    }

    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && isAclNotFound(errorText)) {
        clearToken(host);
      }
      return { ok: false, status: res.status, errorText };
    }
  }

  return { ok: true };
}

async function applyEnv({ scheme, host, dc, prefix, entries }) {
  const p = String(prefix || "");
  const token = await getActiveToken(host);
  if (token) {
    const status = await validateToken(host, token);
    if (status === "valid") updateToken(token, host);
    else if (status === "invalid") clearToken(host);
    // "unreachable": keep the token, the PUT calls will fail with proper errors if server is down
  }

  const pairs = Array.isArray(entries) ? entries : [];
  const cleaned = pairs
    .map((e) => ({ key: String(e?.key || "").trim(), value: e?.value ?? "" }))
    .filter((e) => Boolean(e.key));

  if (cleaned.length === 0) {
    return { ok: false, error: "Santa couldn't find any keys in the .env file. Please check the file format and try again." };
  }

  const concurrency = 6;
  let applied = 0;
  let failed = 0;
  let firstError = "";

  for (let i = 0; i < cleaned.length; i += concurrency) {
    const batch = cleaned.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async ({ key, value }) => {
        const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
        const fullKey = normalizedKey.startsWith(p) ? normalizedKey : `${p}${normalizedKey}`;
        return putKeyValue({ scheme, host, dc, fullKey, token, value });
      })
    );

    results.forEach((r) => {
      if (!r.ok) {
        failed += 1;
        if (!firstError && r.errorText) firstError = r.errorText;
        return;
      }
      applied += 1;
    });
  }

  if (failed > 0) {
    return { ok: false, applied, failed, error: firstError || "Santa couldn't apply some keys. Check your Consul permissions and try again." };
  }

  return { ok: true, applied, failed: 0 };
}

/* Fetches values for a known list of keys under a prefix with limited concurrency. */
async function fetchVisibleValues({ scheme, host, dc, prefix, keys }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const token = await getActiveToken(host);
  if (token) {
    const status = await validateToken(host, token);
    if (status === "valid") updateToken(token, host);
    else if (status === "invalid") clearToken(host);
    // "unreachable": keep the token, individual key fetches will fail with proper errors
  }

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
        const res = await fetchKeyValue({ scheme, host, dc, fullKey, token });
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
      error: "Santa couldn't fetch these key values. Please refresh the page and try again."
    };
  }

  return { keys: results, prefix: `/${p.replace(/\/$/, "")}`, failed, skipped };
}

/* Lists keys for the current prefix and fetches all direct leaf values. */
async function fetchPageValues({ scheme, host, dc, prefix }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const token = await getActiveToken(host);

  const listRes = await listDirectKeys({ scheme, host, dc, prefix: p, token });
  if (!listRes.ok) {
    if (listRes.errorText) return { error: listRes.errorText };
    if (listRes.status === 403) {
      return { error: listRes.errorText || "Santa doesn't have permission to list these keys. Ensure you have key:read access." };
    }
    return { error: `Santa encountered an error listing keys (HTTP ${listRes.status || "?"}).` };
  }

  const keys = Array.isArray(listRes.keys) ? listRes.keys : [];
  if (keys.length === 0) {
    return { keys: {}, prefix: `/${p.replace(/\/$/, "")}`, failed: 0, skipped: Number(listRes.folders || 0) };
  }

  const valuesRes = await fetchVisibleValues({ scheme, host, dc, prefix: p, keys });
  if (valuesRes?.error) return valuesRes;
  return { ...valuesRes, skipped: Number(valuesRes.skipped || 0) + Number(listRes.folders || 0) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === CONSTANTS.MESSAGE_TYPES.SET_TOKEN) {
    const token = String(message?.token || "");
    const host = String(message?.host || "");
    if (token && host) {
      const h = String(host || "").toLowerCase();
      if (isTokenRejected(h, token)) {
        sendResponse({ ok: false, error: "Santa couldn't accept that token — the Consul server says it's invalid. Please log in again." });
        return;
      }
      validateToken(host, token)
        .then((status) => {
          if (status === "valid" || status === "unreachable") {
            // "unreachable": background can't reach the server right now, but this token was
            // sourced from the page (which could reach it), so accept it optimistically.
            updateToken(token, host);
            sendResponse({ ok: true });
          } else {
            // "invalid": server explicitly rejected this token.
            sendResponse({ ok: false, error: "Santa couldn't accept that token — the Consul server says it's invalid. Please log in again." });
            addTokenRejection(h, token);
          }
        })
        .catch(() => sendResponse({ ok: false, error: "Santa couldn't validate your Consul token. Please check your connection and try again." }));
      return true;
    }
    sendResponse({ ok: false });
    return;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.APPLY_ENV) {
    applyEnv(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Santa couldn't apply the .env file. Please check your connection and try again." }));
    return true;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_KEYS) {
    const host = String(message?.host || "");
    getActiveToken(host)
      .then(async (token) => {
        const t = String(token || "");
        if (!t || !host) {
          sendResponse({ token: "" });
          return;
        }
        const h = String(host || "").toLowerCase();
        const status = isTokenRejected(h, t) ? "invalid" : await validateToken(host, t);
        if (status === "valid") {
          updateToken(t, host);
          sendResponse({ token: t });
        } else if (status === "unreachable") {
          // Server is temporarily unreachable — return the token as-is so the popup can
          // proceed and receive a meaningful "can't connect" error rather than "no session".
          sendResponse({ token: t });
        } else {
          // "invalid": explicitly rejected by the server.
          clearToken(host);
          addTokenRejection(h, t);
          sendResponse({ token: "" });
        }
      })
      .catch(() => sendResponse({ error: "Santa couldn't fetch keys. Please check your connection and try again." }));
    return true;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_VISIBLE_VALUES) {
    fetchVisibleValues(message)
      .then(sendResponse)
      .catch(() => sendResponse({ error: "Santa couldn't fetch keys. Please check your connection and try again." }));
    return true;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.FETCH_PAGE_VALUES) {
    fetchPageValues(message)
      .then(sendResponse)
      .catch(() => sendResponse({ error: "Santa couldn't fetch keys. Please check your connection and try again." }));
    return true;
  }
});
