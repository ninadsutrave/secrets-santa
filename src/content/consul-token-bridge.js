/* Consul token bridge — injected into the MAIN world of the Consul UI tab.
 *
 * ── Why MAIN world, not the default ISOLATED content script world? ────────────────────────────
 *
 *  Chrome extensions run content scripts in an ISOLATED world — a sandboxed JS environment
 *  that shares the DOM with the page but has its own separate window, fetch, and prototype
 *  chain. Wrapping window.fetch or XMLHttpRequest.prototype in the ISOLATED world has NO
 *  effect on the page's own fetch calls because the page sees a different copy of those objects.
 *
 *  To intercept the Consul SPA's network calls we must inject into the MAIN world, where
 *  window.fetch is the same object the page code uses. chrome.scripting.executeScript with
 *  world: "MAIN" is the MV3-approved way to do this.
 *
 * ── Injection mechanism ───────────────────────────────────────────────────────────────────────
 *
 *  This file is NOT listed in manifest.json content_scripts.
 *  token.js (popup) calls chrome.scripting.executeScript({ world: "MAIN" }) to inject it
 *  on demand when the popup is opened for a Consul tab.
 *
 *  window.__ss_bridge_installed guards against double-injection if the user opens the popup
 *  multiple times on the same tab without a page reload.
 *
 * ── Token emission paths ─────────────────────────────────────────────────────────────────────
 *
 *  emitToken() sends the captured token through two channels simultaneously:
 *    1. CustomEvent "SECRETS_SANTA_TOKEN" on window — picked up by a separate ISOLATED-world
 *       listener installed by installTokenSniffer() in token.js, which then forwards it to
 *       the background via chrome.runtime.sendMessage. This path handles the case where the
 *       bridge is injected without direct chrome.runtime access.
 *    2. chrome.runtime.sendMessage({ type: "SET_TOKEN" }) — direct path to the background
 *       service worker; works when the MAIN world has access to the extension runtime.
 *
 * ── Message handlers ─────────────────────────────────────────────────────────────────────────
 *
 *  SS_PRIME → fires harmless Consul API requests (/v1/agent/self + KV list) so that the
 *             webRequest listener and fetch/XHR hooks in this file have traffic to intercept
 *             immediately after the popup opens.
 *  SS_SCAN  → re-runs the localStorage, sessionStorage, IndexedDB, and cookie scans.
 *             Called by the popup after the 2-second polling window expires without a token. */

(() => {
  /* Emits a captured token to the background service worker.
   * Two paths are used simultaneously for reliability — see file header above. */
  function emitToken(t) {
    try {
      window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: String(t || "") }));
    } catch { }
    try {
      const token = String(t || "");
      if (token && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "SET_TOKEN", token, host: location.host });
      }
    } catch { }
  }
  function norm(h) {
    return h ? String(h) : "";
  }
  function plausibleToken(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (uuidLike.test(v)) return v;
    const match = v.match(uuidInText);
    if (match?.[0] && uuidLike.test(match[0])) return match[0];
    // JWT format: three base64url segments (Consul Enterprise / HCP — typically 400–1500 chars)
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) && v.length >= 20) return v;
    // Generic opaque token — cap raised from 256 to 2048 for enterprise tokens
    if (v.length < 20 || v.length > 2048) return "";
    if (/\s/.test(v)) return "";
    return v;
  }
  function keyOk(k) {
    const key = String(k || "").toLowerCase();
    if (!key) return false;
    const hasVendor = key.includes("consul") || key.includes("hashicorp") || key.includes("hcp");
    const hasType = key.includes("token") || key.includes("acl");
    if (hasVendor && hasType) return true;
    if (key.includes("consul") && key.includes("secret")) return true;
    return false;
  }
  function findUuidDeep(obj, depth = 0) {
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
  }
  function scanStorages() {
    try {
      const candidates = [];
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
      if (best) {
        fetch("/v1/acl/token/self", {
          method: "GET",
          credentials: "include",
          headers: { "X-Consul-Token": best }
        })
          .then(async (res) => {
            if (res && res.ok) {
              emitToken(best);
              return;
            }
            try {
              const policy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
              if (res && (res.status === 401 || res.status === 403) && policy === "deny") {
                const errorText = String(await res.text()).toLowerCase();
                if (!errorText.includes("acl not found")) {
                  emitToken(best);
                }
              }
            } catch { }
          })
          .catch(() => { });
      }
    } catch { }
  }
  function scanCookies() {
    try {
      const raw = String(document.cookie || "");
      if (!raw) return;
      const parts = raw.split(";").map((p) => p.trim());
      const candidates = [];
      for (const p of parts) {
        const eqIdx = p.indexOf("=");
        if (eqIdx === -1) continue;
        const k = p.slice(0, eqIdx);
        const v = p.slice(eqIdx + 1); // preserves all characters after the first = (handles base64 padding)
        if (!k || !v) continue;
        const key = String(k).toLowerCase();
        if (!(key.includes("consul") || key.includes("token") || key.includes("acl"))) continue;
        const t = plausibleToken(decodeURIComponent(v));
        if (!t) continue;
        let score = 0;
        if (key.includes("token")) score += 6;
        if (key.includes("acl")) score += 3;
        candidates.push({ value: t, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0]?.value || "";
      if (best) {
        fetch("/v1/acl/token/self", {
          method: "GET",
          credentials: "include",
          headers: { "X-Consul-Token": best }
        })
          .then(async (res) => {
            if (res && res.ok) {
              emitToken(best);
              return;
            }
            try {
              const policy = String(res.headers.get("x-consul-default-acl-policy") || "").toLowerCase();
              if (res && (res.status === 401 || res.status === 403) && policy === "deny") {
                const errorText = String(await res.text()).toLowerCase();
                if (!errorText.includes("acl not found")) {
                  emitToken(best);
                }
              }
            } catch { }
          })
          .catch(() => { });
      }
    } catch { }
  }
  /* Scans IndexedDB databases at the current origin for Consul session/auth data.
     Consul UI 1.16+ stores the ACL token in IndexedDB rather than localStorage/sessionStorage.
     Guarded with indexedDB.databases() availability check (Chrome 72+, Firefox 126+). */
  async function scanIndexedDB() {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB.databases) return;
      const dbs = await indexedDB.databases();
      for (const { name } of dbs) {
        if (!name) continue;
        try {
          const token = await new Promise((resolve) => {
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
              let found = "";
              let pending = relevant.length;
              const done = (val) => {
                if (val && !found) found = val;
                if (--pending === 0) { db.close(); resolve(found); }
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
          if (token) { emitToken(token); return; }
        } catch { }
      }
    } catch { }
  }
  function wrapFetch() {
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
        if (token && sameOrigin && isConsulApi) emitToken(token);
      } catch { }
      return orig.apply(this, arguments);
    };
  }
  function wrapXHR() {
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
          if (t && isConsulApi) emitToken(t);
        }
      } catch { }
      return origSet.apply(this, arguments);
    };
  }
  if (!window.__ss_bridge_installed) {
    wrapFetch();
    wrapXHR();
    try {
      scanStorages();
      scanCookies();
      scanIndexedDB(); // async — runs independently, emits token if found
    } catch { }
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          try {
            if (msg && msg.type === "SS_PRIME") {
              const dc = String(msg.dc || "");
              const prefix = String(msg.prefix || "");
              const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
              // Encode each path segment individually so special chars (?, #, &) don't corrupt the URL.
              const encodedPrefix = prefix
                ? prefix.split("/").filter(Boolean).map(encodeURIComponent).join("/")
                : "";
              const kvPath = encodedPrefix ? `/v1/kv/${encodedPrefix}/` : "/v1/kv/";
              const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
              fetch("/v1/agent/self" + suffix, { credentials: "include" }).catch(() => { });
              fetch(kvUrl, { credentials: "include" }).catch(() => { });
              sendResponse({ ok: true });
              return true;
            }
            if (msg && msg.type === "SS_SCAN") {
              scanStorages();
              scanCookies();
              scanIndexedDB(); // async — runs independently, emits token if found
              sendResponse({ ok: true });
              return true;
            }
          } catch { }
          return false;
        });
      }
    } catch { }
    window.__ss_bridge_installed = true;
  }
})(); 
