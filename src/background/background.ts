/* Background service worker:
   - Captures X-Consul-Token from Consul UI requests
   - Lists direct keys via /v1/kv/<prefix>?keys&separator=/
   - Fetches key values via /v1/kv/<fullKey>
   - Handles commands (keyboard shortcut) */

// importScripts will be stripped by build script; shared modules are concatenated before this file.
declare function importScripts(...urls: string[]): void;
importScripts(
  "../shared/constants.js",
  "../shared/storage.js",
  "../shared/consul.js"
);

const { CONSTANTS, STORAGE, CONSUL } = (globalThis as any).SECRETS_SANTA;

const cachedTokens: Record<string, string> = {};
const rejectedTokensByHost: Record<string, Set<string>> = {};
const validationCache: Record<string, { token: string; expires: number }> = {};
const validationInFlight: Record<string, { token: string; promise: Promise<boolean> }> = {};

function updateToken(token: string, host: string) {
  if (!token || typeof token !== "string") return;
  const h = String(host || "").toLowerCase();
  if (!h) return;
  if (token === cachedTokens[h]) return;
  cachedTokens[h] = token;
  STORAGE.setTokenForHost(h, token);
}

function clearToken(host: string) {
  const h = normalizeHost(host);
  if (!h) return;
  delete cachedTokens[h];
  STORAGE.clearTokenForHost(h);
  if (rejectedTokensByHost[h]) delete rejectedTokensByHost[h];
  if (validationCache[h]) delete validationCache[h];
  if (validationInFlight[h]) delete validationInFlight[h];
}

function normalizeHost(host: string) {
  return String(host || "").toLowerCase().trim();
}

function isAclNotFound(errorText: any) {
  return String(errorText || "").toLowerCase().includes("acl not found");
}

function isPermissionDenied(errorText: any) {
  return String(errorText || "").toLowerCase().includes("permission denied");
}

async function validateToken(host: string, token: string): Promise<boolean> {
  try {
    const h = String(host || "").toLowerCase();
    const t = String(token || "");
    if (!h || !t) return false;

    if (validationCache[h] && validationCache[h].token === t && validationCache[h].expires > Date.now()) {
      return true;
    }

    if (validationInFlight[h] && validationInFlight[h].token === t) {
      return validationInFlight[h].promise;
    }

    const domainLike = /^[a-z0-9.-]+(:\d+)?$/i;
    if (!domainLike.test(h)) return false;

    const promise = (async () => {
      const doCheck = async (scheme: "http" | "https") => {
        try {
          const url = `${scheme}://${h}/v1/acl/token/self`;
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t }
          } as any);
          if ((res as any).ok) return true;
          const policy = String((res as any).headers.get("x-consul-default-acl-policy") || "").toLowerCase();
          if (((res as any).status === 401 || (res as any).status === 403) && policy === "deny") {
            try {
              const errorText = String(await (res as any).text()).toLowerCase();
              if (errorText.includes("acl not found")) {
                return false;
              }
            } catch { }
            return true;
          }
          return false;
        } catch {
          return false;
        }
      };

      let result = await doCheck("https");
      if (!result) result = await doCheck("http");

      if (result) {
        validationCache[h] = { token: t, expires: Date.now() + 300000 };
      }
      delete validationInFlight[h];
      return result;
    })();

    validationInFlight[h] = { token: t, promise };
    return promise;
  } catch {
    return false;
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details: any) => {
    const initiator = String(details?.initiator || "");
    if (initiator.startsWith(`chrome-extension://${chrome.runtime.id}`)) return;
    if (typeof details?.tabId === "number" && details.tabId < 0) return;

    const headers = details.requestHeaders || [];
    const tokenHeader = headers.find(
      (h: any) => String(h?.name || "").toLowerCase() === CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST_LOWER
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
          .catch(() => { });
      } catch { }
    }
  },
  { urls: CONSTANTS.WEB_REQUEST_URLS },
  (() => {
    const isFirefox = typeof (globalThis as any).browser !== "undefined" || (typeof navigator !== "undefined" && /Firefox/.test(navigator.userAgent));
    const specs = ["requestHeaders"];
    if (!isFirefox) (specs as any).push("extraHeaders");
    return specs as any;
  })()
);

chrome.commands.onCommand.addListener((command: string) => {
  if (command === CONSTANTS.COMMANDS.OPEN_UI) {
    chrome.action.openPopup();
  }
});

async function getActiveToken(host: string): Promise<string> {
  const h = String(host || "").toLowerCase();
  if (!h) return "";
  if (validationInFlight[h]) {
    await validationInFlight[h].promise;
  }
  if (cachedTokens[h]) return cachedTokens[h];
  return new Promise((resolve) => STORAGE.getTokenForHost(h, (t: any) => resolve(t || "")));
}

async function fetchKeyValue({ scheme, host, dc, fullKey, token }: any) {
  const url = CONSUL.buildKvValueUrl({ scheme, host, dc, fullKey });
  const doFetch = async (t: string) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers } as any);
  };
  let res: any = await doFetch(token);
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

async function listDirectKeys({ scheme, host, dc, prefix, token }: any) {
  const url = CONSUL.buildKvListKeysUrl({ scheme, host, dc, prefix });
  const doFetch = async (t: string) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "GET", credentials: "include", headers } as any);
  };

  let res: any = await doFetch(token);
  let errorText = "";
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
      } catch { }
    }
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
      if (!token && defaultAclPolicyFinal === "deny" && !errorText && !firstErrorText) {
        errorText =
          "Santa couldn't grab your Consul session. Please interact with the Consul UI while logged in, then try again.";
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
  const keys: string[] = [];
  let folders = 0;

  json.forEach((full: any) => {
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

async function putKeyValue({ scheme, host, dc, fullKey, token, value }: any) {
  const url = CONSUL.buildKvPutUrl({ scheme, host, dc, fullKey });
  const doFetch = async (t: string) => {
    const headers = t ? { [CONSTANTS.HEADERS.CONSUL_TOKEN_REQUEST]: t } : {};
    return fetch(url, { method: "PUT", credentials: "include", headers, body: String(value ?? "") } as any);
  };

  let res: any = await doFetch(token);
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

async function applyEnv({ scheme, host, dc, prefix, entries }: any) {
  const p = String(prefix || "");
  const token = await getActiveToken(host);
  if (token) {
    const valid = await validateToken(host, token);
    if (valid) updateToken(token, host);
    else clearToken(host);
  }

  const pairs = Array.isArray(entries) ? entries : [];
  const cleaned = pairs
    .map((e: any) => ({ key: String(e?.key || "").trim(), value: e?.value ?? "" }))
    .filter((e: any) => Boolean(e.key));

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
      batch.map(async ({ key, value }: any) => {
        const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
        const fullKey = normalizedKey.startsWith(p) ? normalizedKey : `${p}${normalizedKey}`;
        return putKeyValue({ scheme, host, dc, fullKey, token, value });
      })
    );

    results.forEach((r: any) => {
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

async function fetchVisibleValues({ scheme, host, dc, prefix, keys }: any) {
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

  const results: Record<string, string> = {};
  let failed = 0;
  let skipped = 0;
  let firstAuthError = "";

  const concurrency = 10;
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (key: string) => {
        const safeKey = String(key || "").trim();
        if (!safeKey) return { key: "", ok: false, status: 0 };
        const fullKey = `${p}${safeKey}`;
        const res = await fetchKeyValue({ scheme, host, dc, fullKey, token });
        return { key: safeKey, ...res };
      })
    );

    batchResults.forEach((r: any) => {
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

async function fetchPageValues({ scheme, host, dc, prefix }: any) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const token = await getActiveToken(host);

  const listRes = await listDirectKeys({ scheme, host, dc, prefix: p, token });
  if (!listRes.ok) {
    if (listRes.errorText) return { error: listRes.errorText };
    if (isAclNotFound(listRes.errorText)) {
      return {
        error: "Santa noticed your Consul session expired. Please interact with the Consul UI (logged in) and try again."
      };
    }
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

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
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

export {};
