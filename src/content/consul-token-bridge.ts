(() => {
  const C: any = (globalThis as any).chrome || (window as any).chrome;
  function emitToken(t: string) {
    try {
      window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: String(t || "") }));
    } catch { }
    try {
      const token = String(t || "");
      if (token && C && C.runtime && C.runtime.sendMessage) {
        C.runtime.sendMessage({ type: "SET_TOKEN", token, host: location.host });
      }
    } catch { }
  }
  function norm(h: any) {
    return h ? String(h) : "";
  }
  function plausibleToken(value: any) {
    const v = String(value || "").trim();
    if (!v) return "";
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (uuidLike.test(v)) return v;
    const match = v.match(uuidInText);
    if ((match as any)?.[0] && uuidLike.test((match as any)[0])) return (match as any)[0];
    if (v.length < 20 || v.length > 256) return "";
    if (/\s/.test(v)) return "";
    return v;
  }
  function keyOk(k: any) {
    const key = String(k || "").toLowerCase();
    if (!key) return false;
    const hasVendor = key.includes("consul") || key.includes("hashicorp") || key.includes("hcp");
    const hasType = key.includes("token") || key.includes("acl");
    if (hasVendor && hasType) return true;
    if (key.includes("consul") && key.includes("secret")) return true;
    return false;
  }
  function findUuidDeep(obj: any, depth = 0): string {
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
      const candidates: Array<{ value: string; score: number }> = [];
      const tryAdd = (k: any, v: any) => {
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
        tryAdd(k, localStorage.getItem(k as any));
      }
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        tryAdd(k, sessionStorage.getItem(k as any));
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = (candidates[0] as any)?.value || "";
      if (best) {
        const suffix = "";
        fetch(`/v1/acl/token/self${suffix}`, {
          method: "GET",
          credentials: "include",
          headers: { "X-Consul-Token": best }
        } as any)
          .then(async (res: any) => {
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
      const candidates: Array<{ value: string; score: number }> = [];
      for (const p of parts) {
        const [k, v] = p.split("=");
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
      const best = (candidates[0] as any)?.value || "";
      if (best) {
        const suffix = "";
        fetch(`/v1/acl/token/self${suffix}`, {
          method: "GET",
          credentials: "include",
          headers: { "X-Consul-Token": best }
        } as any)
          .then(async (res: any) => {
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
  function wrapFetch() {
    const orig = window.fetch;
    window.fetch = function (this: any, input: any, init: any) {
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
        const sameOrigin = url && (url as any).host === location.host;
        const isConsulApi = url && (url as any).pathname.startsWith("/v1/");
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
            const kv = init.headers.find(([k]: any[]) => String(k).toLowerCase() === "x-consul-token");
            token =
              (kv ? String((kv as any)[1]) : "") ||
              (function () {
                const auth = init.headers.find(([k]: any[]) => String(k).toLowerCase() === "authorization");
                const a = auth ? String((auth as any)[1] || "") : "";
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
        if (!token && input && typeof input === "object" && (input as any).headers instanceof Headers) {
          token =
            norm((input as any).headers.get("X-Consul-Token") || (input as any).headers.get("x-consul-token")) ||
            (function () {
              const a = String((input as any).headers.get("Authorization") || (input as any).headers.get("authorization") || "");
              return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
            })();
        }
        if (token && sameOrigin && isConsulApi) emitToken(token);
      } catch { }
      return (orig as any).apply(this, arguments as any);
    } as any;
  }
  function wrapXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSet = XMLHttpRequest.prototype.setRequestHeader;
    (XMLHttpRequest.prototype as any).open = function (this: any) {
      (this as any).__ss_token = (this as any).__ss_token || "";
      try {
        const url = arguments && typeof arguments[1] === "string" ? new URL(arguments[1], location.href) : null;
        (this as any).__ss_url = url && (url as any).host === location.host ? (url as any).pathname : "";
      } catch {
        (this as any).__ss_url = "";
      }
      return origOpen.apply(this, arguments as any);
    } as any;
    (XMLHttpRequest.prototype as any).setRequestHeader = function (this: any, name: string, value: string) {
      try {
        const lower = String(name).toLowerCase();
        if (lower === "x-consul-token" || lower === "authorization") {
          (this as any).__ss_token = String(value || "");
          const isConsulApi = typeof (this as any).__ss_url === "string" && (this as any).__ss_url.startsWith("/v1/");
          let t = (this as any).__ss_token;
          if (lower === "authorization" && t.toLowerCase().startsWith("bearer ")) {
            t = t.slice(7).trim();
          }
          if (t && isConsulApi) emitToken(t);
        }
      } catch { }
      return origSet.apply(this, arguments as any);
    } as any;
  }
  if (!(window as any).__ss_bridge_installed) {
    wrapFetch();
    wrapXHR();
    try {
      scanStorages();
      scanCookies();
    } catch { }
    try {
      if (C && C.runtime && C.runtime.onMessage) {
        C.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: any) => {
          try {
            if (msg && msg.type === "SS_PRIME") {
              const dc = String(msg.dc || "");
              const prefix = String(msg.prefix || "");
              const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
              const kvPath = prefix ? `/v1/kv/${encodeURI(prefix)}` : "/v1/kv/";
              const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
              fetch("/v1/agent/self" + suffix, { credentials: "include" } as any).catch(() => { });
              fetch(kvUrl, { credentials: "include" } as any).catch(() => { });
              sendResponse({ ok: true });
              return true;
            }
            if (msg && msg.type === "SS_SCAN") {
              scanStorages();
              scanCookies();
              sendResponse({ ok: true });
              return true;
            }
          } catch { }
          return false;
        });
      }
    } catch { }
    (window as any).__ss_bridge_installed = true;
  }
})(); 
