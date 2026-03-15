/* Token capture orchestration — popup side.
 *
 * The single public entry point is ensureTokenAvailable(tabId, host, dc, prefix).
 * It runs a layered capture strategy and resolves with a token string (or "" on failure).
 *
 * ── Capture layers (in order, each is a fallback for the previous) ────────────────────────────
 *
 *  Layer 1  webRequest passive capture (background.js)
 *           Already running before the popup opens. If the user recently visited the Consul
 *           UI, the background likely already has a token — FETCH_KEYS will return it immediately.
 *
 *  Layer 2  fetch / XHR hooks  (consul-token-bridge.js, MAIN world)
 *           installTokenSniffer() injects the bridge script into the Consul tab's MAIN world.
 *           Any Consul API call the page makes after injection will have its token captured.
 *
 *  Layer 3  Priming fetches  (consul-token-bridge.js, SS_PRIME)
 *           primeTokenCaptureOnTab() sends an SS_PRIME message to trigger harmless Consul API
 *           calls in the page context, giving layers 1–2 something to intercept immediately.
 *
 *  Polling (2 seconds, 50ms interval)
 *           After layers 2–3 are started, we poll FETCH_KEYS every 50ms for up to 2 seconds.
 *           webRequest is asynchronous — the token may arrive at any point in this window.
 *
 *  Layer 4  SS_SCAN re-scan
 *           If polling finds nothing, we ask the bridge to re-scan localStorage/sessionStorage,
 *           IndexedDB, and cookies in case the token was written to storage after page load.
 *
 *  Layer 5  captureAndStoreTokenFromConsulStorage (last resort)
 *           Runs a direct executeScript in MAIN world to scan localStorage, sessionStorage,
 *           and IndexedDB synchronously and validate the best candidate via /v1/acl/token/self.
 *
 * ── Single write path ─────────────────────────────────────────────────────────────────────────
 *
 *  captureAndStoreTokenFromConsulStorage sends a SET_TOKEN message to the background rather
 *  than writing to chrome.storage directly. The background is the sole writer — this prevents
 *  races where a direct popup write could be overwritten by a concurrent background validation. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* Asks the background for the current validated token for a host.
   * Returns "" if no token is stored or the stored token failed validation. */
  function fetchTokenFromBackground(host) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.FETCH_KEYS, host }, (res) => {
        resolve(String(res?.token || ""));
      });
    });
  }

  /* Validates a token by running a /v1/acl/token/self fetch directly inside the Consul tab's
   * MAIN world (same origin as Consul). This avoids CORS restrictions that would block the same
   * request from the extension popup or service worker on some deployments.
   * Returns true if the token is accepted, false otherwise. */
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
            if (res.ok) return true;
            try {
              const policy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
              if ((res.status === 401 || res.status === 403) && policy === "deny") {
                try {
                  const errorText = String(await res.text()).toLowerCase();
                  if (errorText.includes("acl not found")) {
                    return false;
                  }
                } catch { }
                return true;
              }
            } catch { }
            return false;
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

  /* Last-resort synchronous scan for a Consul token in the page's storage (Layer 5).
   * Runs a MAIN-world executeScript that checks localStorage, sessionStorage, and IndexedDB
   * for keys with Consul-related names, scores candidates, and returns the best match.
   * The candidate is validated via /v1/acl/token/self (in validateTokenOnTab) before being stored.
   * On success, sends SET_TOKEN to the background — the background is the sole writer. */
  async function captureAndStoreTokenFromConsulStorage(tabId, host, dc) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async () => {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
          const plausibleToken = (value) => {
            const v = String(value || "").trim();
            if (!v) return "";
            if (uuidLike.test(v)) return v;
            const match = v.match(uuidInText);
            if (match?.[0] && uuidLike.test(match[0])) return match[0];
            // JWT format: three base64url segments (Consul Enterprise / HCP)
            if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) && v.length >= 20) return v;
            // Generic opaque token — cap raised from 256 to 2048 for enterprise tokens
            if (v.length < 20 || v.length > 2048) return "";
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
          const best = candidates[0]?.value || "";
          if (best) return best;

          // IndexedDB scan — covers Consul UI 1.16+ which stores the ACL token in IDB, not localStorage.
          // indexedDB.databases() is available on Chrome 72+ and Firefox 126+.
          try {
            if (typeof indexedDB !== "undefined" && indexedDB.databases) {
              const dbs = await indexedDB.databases();
              for (const { name } of dbs) {
                if (!name) continue;
                const found = await new Promise((resolve) => {
                  const req = indexedDB.open(name);
                  req.onerror = () => resolve("");
                  req.onsuccess = () => {
                    const db = req.result;
                    const relevant = Array.from(db.objectStoreNames).filter((s) => {
                      const l = s.toLowerCase();
                      return l.includes("token") || l.includes("acl") || l.includes("auth") ||
                             l.includes("session") || l.includes("consul");
                    });
                    if (!relevant.length) { db.close(); resolve(""); return; }
                    let result = "";
                    let pending = relevant.length;
                    const done = (val) => {
                      if (val && !result) result = val;
                      if (--pending === 0) { db.close(); resolve(result); }
                    };
                    for (const storeName of relevant) {
                      try {
                        const tx = db.transaction(storeName, "readonly");
                        const req2 = tx.objectStore(storeName).getAll();
                        req2.onsuccess = () => done(findUuidDeep(req2.result));
                        req2.onerror = () => done("");
                      } catch { done(""); }
                    }
                  };
                });
                if (found) return found;
              }
            }
          } catch { }
          return "";
        }
      });
      const token = String(results?.[0]?.result || "");
      if (!token) return "";
      const validOnTab = await validateTokenOnTab(tabId, dc, token);
      if (validOnTab) {
        // Let the background be the single source of truth — it validates and stores atomically.
        // Storing directly from the popup AND via SET_TOKEN creates a race where background
        // validation might clear a token the popup just wrote, causing inconsistent state.
        const stored = await new Promise((resolve) =>
          chrome.runtime.sendMessage(
            { type: globalThis.SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.SET_TOKEN, token, host },
            (res) => resolve(res?.ok === true)
          )
        );
        return stored ? token : "";
      }
      return "";
    } catch {
      return "";
    }
  }

  /* Sets up two injection phases so that any Consul API request made after the popup opens
   * will have its X-Consul-Token captured regardless of which world it originates from.
   *
   * Phase 1 — ISOLATED world listener (default content-script world)
   *   Installs a window.addEventListener("SECRETS_SANTA_TOKEN") handler in the content script's
   *   ISOLATED world. When the MAIN world bridge fires a CustomEvent carrying the token, this
   *   listener picks it up and forwards it to the background via chrome.runtime.sendMessage.
   *   The guard window.__ss_listener_installed prevents double-registration if the popup is
   *   opened multiple times without a page reload.
   *
   * Phase 2 — MAIN world injection (world: "MAIN")
   *   Injects wrapFetch() and wrapXHR() into the page's own JS context so that every subsequent
   *   same-origin Consul API call emits its X-Consul-Token header as a "SECRETS_SANTA_TOKEN"
   *   CustomEvent (caught by Phase 1). The guard window.__ss_fetch_wrapped prevents double-
   *   wrapping the prototype chain on repeated popup opens.
   *   Also fires two priming fetches immediately (/v1/agent/self and /v1/kv/…) so that the
   *   hooks installed above have real authenticated Consul traffic to intercept right away. */
  async function installTokenSniffer(tabId, dc, prefix) {
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
            } catch { }
          });
          window.__ss_listener_installed = true;
        }
      });
    } catch { }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [dc, prefix],
        func: (dcArg, prefixArg) => {
          const emit = (t) => {
            try {
              window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: t }));
            } catch { }
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
                    token =
                      norm(init.headers.get("X-Consul-Token") || init.headers.get("x-consul-token")) ||
                      (function () {
                        const a = String(init.headers.get("Authorization") || init.headers.get("authorization") || "");
                        return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
                      })();
                  } else if (Array.isArray(init.headers)) {
                    const kv = init.headers.find(([k]) => String(k).toLowerCase() === "x-consul-token");
                    token =
                      (kv ? String(kv[1]) : "") ||
                      (function () {
                        const auth = init.headers.find(([k]) => String(k).toLowerCase() === "authorization");
                        const a = auth ? String(auth[1] || "") : "";
                        return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
                      })();
                  } else if (typeof init.headers === "object") {
                    token =
                      norm(init.headers["X-Consul-Token"] || init.headers["x-consul-token"]) ||
                      (function () {
                        const a = String(init.headers["Authorization"] || init.headers["authorization"] || "");
                        return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
                      })();
                  }
                }
                if (!token && input && typeof input === "object" && input.headers instanceof Headers) {
                  token =
                    norm(input.headers.get("X-Consul-Token") || input.headers.get("x-consul-token")) ||
                    (function () {
                      const a = String(input.headers.get("Authorization") || input.headers.get("authorization") || "");
                      return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
                    })();
                }
                if (token && sameOrigin && isConsulApi) emit(token);
              } catch { }
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
                const lower = String(name).toLowerCase();
                if (lower === "x-consul-token" || lower === "authorization") {
                  this.__ss_token = String(value || "");
                  const isConsulApi = typeof this.__ss_url === "string" && this.__ss_url.startsWith("/v1/");
                  let t = this.__ss_token;
                  if (lower === "authorization" && t.toLowerCase().startsWith("bearer ")) {
                    t = t.slice(7).trim();
                  }
                  if (t && isConsulApi) emit(t);
                }
              } catch { }
              return origSet.apply(this, arguments);
            };
          };
          if (!window.__ss_fetch_wrapped) {
            wrapFetch();
            wrapXHR();
            window.__ss_fetch_wrapped = true;
          }
          try {
            const dc = String(dcArg || "");
            const prefix = String(prefixArg || "");
            const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
            // Encode each path segment individually so special chars don't corrupt the query string.
            const encodedPrefix = prefix
              ? prefix.split("/").filter(Boolean).map(encodeURIComponent).join("/")
              : "";
            const kvPath = encodedPrefix ? `/v1/kv/${encodedPrefix}/` : "/v1/kv/";
            const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
            fetch("/v1/agent/self" + suffix, { credentials: "include" }).catch(() => { });
            fetch(kvUrl, { credentials: "include" }).catch(() => { });
          } catch { }
        }
      });
    } catch { }
  }

  /* Sends an SS_PRIME message to the consul-token-bridge already running in the Consul tab.
   * The bridge responds by issuing harmless Consul API requests (/v1/agent/self and a KV list)
   * using the page's own fetch, giving the fetch/XHR hooks (Phase 2) and the background
   * webRequest listener real authenticated traffic to intercept immediately.
   * Silently no-ops if the bridge is not installed (e.g. page not yet loaded). */
  async function primeTokenCaptureOnTab(tabId, dc, prefix) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SS_PRIME", dc, prefix });
    } catch { }
  }

  /* Main public entry point — orchestrates the full token capture cascade.
   *
   * Order of operations:
   *   1. installTokenSniffer  — inject ISOLATED-world CustomEvent listener (Phase 1) and
   *                             MAIN-world fetch/XHR hooks + priming fetches (Phase 2)
   *   2. primeTokenCaptureOnTab — send SS_PRIME to the already-installed bridge as a second
   *                               trigger for priming in case Phase 2 didn't self-prime
   *   3. Poll fetchTokenFromBackground every 50 ms for up to 2 s (40 × 50 ms)
   *      → catches tokens that arrive asynchronously via webRequest or the fetch/XHR hooks
   *   4. SS_SCAN — ask the bridge to re-scan localStorage/sessionStorage/IndexedDB/cookies,
   *      then poll 1 s more (20 × 50 ms) for any token that was written to storage after load
   *   5. captureAndStoreTokenFromConsulStorage — direct MAIN-world storage read + in-tab
   *      validation as a last resort when all async layers have failed
   *
   * Returns the validated token string on success, or "" if all layers are exhausted. */
  async function ensureTokenAvailable(tabId, host, dc, prefix) {
    await installTokenSniffer(tabId, dc, prefix);
    await primeTokenCaptureOnTab(tabId, dc, prefix);
    for (let i = 0; i < 40; i += 1) { // 2 seconds total polling
      const token = await fetchTokenFromBackground(host);
      if (token) return token;
      await sleep(50);
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SS_SCAN" });
      for (let i = 0; i < 20; i += 1) { // 1 second more
        const t = await fetchTokenFromBackground(host);
        if (t) return t;
        await sleep(50);
      }
    } catch { }
    const token = await captureAndStoreTokenFromConsulStorage(tabId, host, dc);
    if (token) return token;
    return "";
  }

  globalThis.SECRETS_SANTA.TOKEN = { ensureTokenAvailable };
})();
