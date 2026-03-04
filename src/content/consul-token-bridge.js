(() => {
  function emitToken(t) {
    try {
      window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: String(t || "") }));
    } catch {}
    try {
      const token = String(t || "");
      if (token && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "SET_TOKEN", token, host: location.host });
      }
    } catch {}
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
    if (v.length < 20 || v.length > 256) return "";
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
      if (best) emitToken(best);
    } catch {}
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
        if (token && sameOrigin && isConsulApi) emitToken(token);
      } catch {}
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
        if (String(name).toLowerCase() === "x-consul-token") {
          this.__ss_token = String(value || "");
          const isConsulApi = typeof this.__ss_url === "string" && this.__ss_url.startsWith("/v1/");
          if (this.__ss_token && isConsulApi) emitToken(this.__ss_token);
        }
      } catch {}
      return origSet.apply(this, arguments);
    };
  }
  if (!window.__ss_bridge_installed) {
    wrapFetch();
    wrapXHR();
    try {
      scanStorages();
    } catch {}
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          try {
            if (msg && msg.type === "SS_PRIME") {
              const dc = String(msg.dc || "");
              const prefix = String(msg.prefix || "");
              const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
              const kvPath = prefix ? `/v1/kv/${encodeURI(prefix)}` : "/v1/kv/";
              const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
              fetch("/v1/agent/self" + suffix, { credentials: "include" }).catch(() => {});
              fetch(kvUrl, { credentials: "include" }).catch(() => {});
              sendResponse({ ok: true });
              return true;
            }
            if (msg && msg.type === "SS_SCAN") {
              scanStorages();
              sendResponse({ ok: true });
              return true;
            }
          } catch {}
          return false;
        });
      }
    } catch {}
    window.__ss_bridge_installed = true;
  }
})(); 
