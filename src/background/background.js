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
const rejectedTokensByHost = {};

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
  const h = String(host || "").toLowerCase();
  if (!h) return;
  delete cachedTokens[h];
  STORAGE.clearTokenForHost(h);
  if (rejectedTokensByHost[h]) delete rejectedTokensByHost[h];
}

function isAclNotFound(errorText) {
  return String(errorText || "").toLowerCase().includes("acl not found");
}

function isPermissionDenied(errorText) {
  return String(errorText || "").toLowerCase().includes("permission denied");
}

async function validateToken(host, token) {
  try {
    const h = String(host || "");
    const t = String(token || "");
    if (!h || !t) return false;
    const doCheck = async (scheme) => {
      const url = `${scheme}://${h}/v1/acl/token/self`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t }
      });
      return res.ok;
    };
    if (await doCheck("https")) return true;
    return await doCheck("http");
  } catch {
    return false;
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
        const rejected = (rejectedTokensByHost[h] && rejectedTokensByHost[h].has(candidate));
        if (rejected) return;
        validateToken(host, candidate)
          .then((valid) => {
            if (valid) {
              updateToken(candidate, host);
            } else {
              if (cachedTokens[h] && cachedTokens[h] === candidate) {
                clearToken(h);
              }
              if (!rejectedTokensByHost[h]) rejectedTokensByHost[h] = new Set();
              rejectedTokensByHost[h].add(candidate);
            }
          })
          .catch(() => {});
      } catch {}
    }
  },
  { urls: CONSTANTS.WEB_REQUEST_URLS },
  ["requestHeaders", "extraHeaders"]
);

chrome.commands.onCommand.addListener((command) => {
  if (command === CONSTANTS.COMMANDS.OPEN_UI) {
    chrome.action.openPopup();
  }
});

function getActiveToken(host) {
  const h = String(host || "").toLowerCase();
  if (h && cachedTokens[h]) return Promise.resolve(cachedTokens[h]);
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
        errorText = String(await res.text()).slice(0, 280);
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
      } catch {}
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
  let firstStatus = res.status;
  let firstErrorText = "";
  try {
    if (!res.ok) {
      firstErrorText = String(await res.text()).slice(0, 360);
    }
  } catch {
    firstErrorText = "";
  }

  if (!res.ok) {
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
      } catch {}
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
            ? "Prefix not found or not visible with current ACLs (404). Ensure the token has key:read on this prefix and datacenter."
            : "Prefix not found (404). Check datacenter/prefix or permissions.";
        return { ok: false, status: 404, errorText: notFoundMsg };
      }
      if (!token && defaultAclPolicyFinal === "deny" && !errorText && !firstErrorText) {
        errorText =
          "No Consul token captured yet. Open the Consul UI (logged in) and try again so Santa can reuse your token.";
      }
      if (!errorText && firstErrorText) {
        errorText = firstErrorText;
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
      } catch {}
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
    const valid = await validateToken(host, token);
    if (valid) updateToken(token, host);
    else clearToken(host);
  }

  const pairs = Array.isArray(entries) ? entries : [];
  const cleaned = pairs
    .map((e) => ({ key: String(e?.key || "").trim(), value: e?.value ?? "" }))
    .filter((e) => Boolean(e.key));

  if (cleaned.length === 0) {
    return { ok: false, error: "No keys found in .env file." };
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
    return { ok: false, applied, failed, error: firstError || "Failed to apply some keys." };
  }

  return { ok: true, applied, failed: 0 };
}

/* Fetches values for a known list of keys under a prefix with limited concurrency. */
async function fetchVisibleValues({ scheme, host, dc, prefix, keys }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const token = await getActiveToken(host);
  if (token) {
    const valid = await validateToken(host, token);
    if (valid) updateToken(token, host);
    else clearToken(host);
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
      error: "Unable to fetch key values. Make sure Consul requests include X-Consul-Token, then refresh the page and try again."
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
      const rejected = (rejectedTokensByHost[h] && rejectedTokensByHost[h].has(token));
      if (rejected) {
        sendResponse({ ok: false, error: "Rejected invalid Consul token." });
        return;
      }
      validateToken(host, token)
        .then((valid) => {
          if (valid) {
            updateToken(token, host);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: "Rejected invalid Consul token." });
            if (!rejectedTokensByHost[h]) rejectedTokensByHost[h] = new Set();
            rejectedTokensByHost[h].add(token);
          }
        })
        .catch(() => sendResponse({ ok: false, error: "Failed to validate token." }));
      return true;
    }
    sendResponse({ ok: false });
    return;
  }

  if (message?.type === CONSTANTS.MESSAGE_TYPES.APPLY_ENV) {
    applyEnv(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Failed to apply .env file." }));
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
        const rejected = (rejectedTokensByHost[h] && rejectedTokensByHost[h].has(t));
        const valid = rejected ? false : await validateToken(host, t);
        if (valid) {
          updateToken(t, host);
          sendResponse({ token: t });
        } else {
          clearToken(host);
          if (t) {
            if (!rejectedTokensByHost[h]) rejectedTokensByHost[h] = new Set();
            rejectedTokensByHost[h].add(t);
          }
          sendResponse({ token: "" });
        }
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
