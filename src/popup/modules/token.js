globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function fetchTokenFromBackground(host) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.FETCH_KEYS, host }, (res) => {
        resolve(String(res?.token || ""));
      });
    });
  }

  async function validateTokenOnTab(tabId, dc, token) {
    try {
      if (!chrome.scripting || !chrome.scripting.executeScript) {
        return false;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [dc, token],
        func: async (dcArg, tokenArg) => {
          try {
            const dc = String(dcArg || "");
            const token = String(tokenArg || "");
            if (!token) return false;
            const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
            const res = await fetch(`/v1/acl/token/self${suffix}`, {
              method: "GET",
              credentials: "include",
              headers: { "X-Consul-Token": token }
            });
            return res.ok;
          } catch {
            return false;
          }
        }
      });
      return Boolean(results?.[0]?.result);
    } catch {
      return false;
    }
  }

  async function captureAndStoreTokenFromConsulStorage(tabId, host, dc) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
          const plausibleToken = (value) => {
            const v = String(value || "").trim();
            if (!v) return "";
            if (uuidLike.test(v)) return v;
            const match = v.match(uuidInText);
            if (match?.[0] && uuidLike.test(match[0])) return match[0];
            if (v.length < 20 || v.length > 256) return "";
            if (/\s/.test(v)) return "";
            return v;
          };
          const keyOk = (k) => {
            const key = String(k || "").toLowerCase();
            if (!key) return false;
            const hasVendor = key.includes("consul") || key.includes("hashicorp") || key.includes("hcp");
            const hasType = key.includes("token") || key.includes("acl");
            if (hasVendor && hasType) return true;
            if (key.includes("consul") && key.includes("secret")) return true;
            return false;
          };
          const candidates = [];
          const findUuidDeep = (obj, depth = 0) => {
            if (!obj || depth > 5) return "";
            if (typeof obj === "string") return plausibleToken(obj);
            if (typeof obj !== "object") return "";
            if (Array.isArray(obj)) {
              for (const item of obj) {
                const found = findUuidDeep(item, depth + 1);
                if (found) return found;
              }
              return "";
            }
            for (const key in obj) {
              const found = findUuidDeep(obj[key], depth + 1);
              if (found) return found;
            }
            return "";
          };
          const tryAdd = (k, v) => {
            if (!keyOk(k)) return;
            const raw = String(v || "").trim();
            if (!raw) return;
            let token = plausibleToken(raw);
            if (!token) {
              try {
                token = findUuidDeep(JSON.parse(raw));
              } catch {
                token = "";
              }
            }
            if (!token) return;
            let score = 0;
            const lowerKey = String(k || "").toLowerCase();
            if (lowerKey.includes("token")) score += 6;
            if (lowerKey.includes("acl")) score += 3;
            candidates.push({ value: token, score });
          };
          for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            tryAdd(k, localStorage.getItem(k));
          }
          for (let i = 0; i < sessionStorage.length; i += 1) {
            const k = sessionStorage.key(i);
            tryAdd(k, sessionStorage.getItem(k));
          }
          candidates.sort((a, b) => b.score - a.score);
          return candidates[0]?.value || "";
        }
      });
      const token = String(results?.[0]?.result || "");
      if (!token) return "";
      const validOnTab = await validateTokenOnTab(tabId, dc, token);
      if (validOnTab) {
        globalThis.SECRETS_SANTA.STORAGE.setTokenForHost(host, token);
        await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.SET_TOKEN, token, host }, () =>
            resolve()
          )
        );
        return token;
      }
      // Fallback: ask background to validate and store
      const ok = await new Promise((resolve) =>
        chrome.runtime.sendMessage(
          { type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.SET_TOKEN, token, host },
          (resp) => resolve(Boolean(resp?.ok))
        )
      );
      if (ok) {
        globalThis.SECRETS_SANTA.STORAGE.setTokenForHost(host, token);
        return token;
      }
      return "";
    } catch {
      return "";
    }
  }

  async function installTokenSniffer(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (window.__ss_listener_installed) return;
          window.addEventListener("SECRETS_SANTA_TOKEN", (e) => {
            try {
              const token = String(e?.detail || "");
              if (!token) return;
              if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ type: "SET_TOKEN", token, host: location.host });
              }
            } catch {}
          });
          window.__ss_listener_installed = true;
        }
      });
    } catch {}
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          if (window.__ss_fetch_wrapped) return;
          const emit = (t) => {
            try {
              window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: t }));
            } catch {}
          };
          const norm = (h) => (h ? String(h) : "");
          const wrapFetch = () => {
            const orig = window.fetch;
            window.fetch = function (input, init) {
              try {
                const resolveUrl = () => {
                  try {
                    if (typeof input === "string") return new URL(input, location.href);
                    if (input && typeof input === "object" && typeof input.url === "string") return new URL(input.url, location.href);
                    return null;
                  } catch {
                    return null;
                  }
                };
                const url = resolveUrl();
                const sameOrigin = url && url.host === location.host;
                const isConsulApi = url && url.pathname.startsWith("/v1/");
                let token = "";
                if (init && init.headers) {
                  if (init.headers instanceof Headers) {
                    token = norm(init.headers.get("X-Consul-Token") || init.headers.get("x-consul-token"));
                  } else if (Array.isArray(init.headers)) {
                    const kv = init.headers.find(([k]) => String(k).toLowerCase() === "x-consul-token");
                    token = kv ? String(kv[1]) : "";
                  } else if (typeof init.headers === "object") {
                    token = norm(init.headers["X-Consul-Token"] || init.headers["x-consul-token"]);
                  }
                }
                if (!token && input && typeof input === "object" && input.headers instanceof Headers) {
                  token = norm(input.headers.get("X-Consul-Token") || input.headers.get("x-consul-token"));
                }
                if (token && sameOrigin && isConsulApi) emit(token);
              } catch {}
              return orig.apply(this, arguments);
            };
          };
          const wrapXHR = () => {
            const origOpen = XMLHttpRequest.prototype.open;
            const origSet = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function () {
              this.__ss_token = this.__ss_token || "";
              try {
                const url = arguments && typeof arguments[1] === "string" ? new URL(arguments[1], location.href) : null;
                this.__ss_url = url && url.host === location.host ? url.pathname : "";
              } catch {
                this.__ss_url = "";
              }
              return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
              try {
                if (String(name).toLowerCase() === "x-consul-token") {
                  this.__ss_token = String(value || "");
                  const isConsulApi = typeof this.__ss_url === "string" && this.__ss_url.startsWith("/v1/");
                  if (this.__ss_token && isConsulApi) emit(this.__ss_token);
                }
              } catch {}
              return origSet.apply(this, arguments);
            };
          };
          wrapFetch();
          wrapXHR();
          window.__ss_fetch_wrapped = true;
        }
      });
    } catch {}
  }

  async function primeTokenCaptureOnTab(tabId, dc, prefix) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [dc, prefix],
        func: (dcArg, prefixArg) => {
          try {
            const dc = String(dcArg || "");
            const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
            const p = String(prefixArg || "");
            const kvPath = p ? `/v1/kv/${encodeURI(p)}` : "/v1/kv/";
            const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
            fetch("/v1/agent/self" + suffix, { credentials: "include" }).catch(() => {});
            fetch(kvUrl, { credentials: "include" }).catch(() => {});
          } catch {}
        }
      });
    } catch {}
  }

  async function ensureTokenAvailable(tabId, host, dc, prefix) {
    await installTokenSniffer(tabId);
    await primeTokenCaptureOnTab(tabId, dc, prefix);
    for (let i = 0; i < 8; i += 1) {
      const token = await fetchTokenFromBackground(host);
      if (token) return token;
      await sleep(150);
    }
    const token = await captureAndStoreTokenFromConsulStorage(tabId, host, dc);
    if (token) return token;
    return "";
  }

  globalThis.SECRETS_SANTA.TOKEN = { ensureTokenAvailable };
})();
