(globalThis as any).SECRETS_SANTA = (globalThis as any).SECRETS_SANTA || {};
const C_token: any = (globalThis as any).chrome;

(() => {
  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function fetchTokenFromBackground(host: string) {
    return new Promise<string>((resolve) => {
      C_token.runtime.sendMessage({ type: (globalThis as any).SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.FETCH_KEYS, host }, (res: any) => {
        resolve(String(res?.token || ""));
      });
    });
  }

  async function validateTokenOnTab(tabId: number, dc: string, token: string) {
    try {
      if (!C_token.scripting || !C_token.scripting.executeScript) {
        return false;
      }
      const results = await C_token.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [dc, token],
        func: async (dcArg: string, tokenArg: string) => {
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

  async function captureAndStoreTokenFromConsulStorage(tabId: number, host: string, dc: string) {
    try {
      const results = await C_token.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
          const plausibleToken = (value: any) => {
            const v = String(value || "").trim();
            if (!v) return "";
            if (uuidLike.test(v)) return v;
            const match = v.match(uuidInText);
            if ((match as any)?.[0] && uuidLike.test((match as any)[0])) return (match as any)[0];
            if (v.length < 20 || v.length > 256) return "";
            if (/\s/.test(v)) return "";
            return v;
          };
          const keyOk = (k: any) => {
            const key = String(k || "").toLowerCase();
            if (!key) return false;
            const hasVendor = key.includes("consul") || key.includes("hashicorp") || key.includes("hcp");
            const hasType = key.includes("token") || key.includes("acl");
            if (hasVendor && hasType) return true;
            if (key.includes("consul") && key.includes("secret")) return true;
            return false;
          };
          const candidates: Array<{ value: string; score: number }> = [];
          const findUuidDeep = (obj: any, depth = 0): string => {
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
          return (candidates[0] as any)?.value || "";
        }
      });
      const token = String((results as any)?.[0]?.result || "");
      if (!token) return "";
      const validOnTab = await validateTokenOnTab(tabId, dc, token);
      if (validOnTab) {
        (globalThis as any).SECRETS_SANTA.STORAGE.setTokenForHost(host, token);
        await new Promise((resolve) =>
          C_token.runtime.sendMessage({ type: (globalThis as any).SECRETS_SANTA.CONSTANTS.MESSAGE_TYPES.SET_TOKEN, token, host }, () =>
            resolve(null)
          )
        );
        return token;
      }
      return "";
    } catch {
      return "";
    }
  }

  async function installTokenSniffer(tabId: number, dc: string, prefix: string) {
    try {
      await C_token.scripting.executeScript({
        target: { tabId },
        func: () => {
          if ((window as any).__ss_listener_installed) return;
          window.addEventListener("SECRETS_SANTA_TOKEN", (e: any) => {
            try {
              const token = String(e?.detail || "");
              if (!token) return;
              if (typeof (window as any).chrome !== "undefined" && (window as any).chrome.runtime && (window as any).chrome.runtime.sendMessage) {
                (window as any).chrome.runtime.sendMessage({ type: "SET_TOKEN", token, host: location.host });
              }
            } catch { }
          });
          (window as any).__ss_listener_installed = true;
        }
      });
    } catch { }
    try {
      await C_token.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [dc, prefix],
        func: (dcArg: string, prefixArg: string) => {
          const emit = (t: string) => {
            try {
              window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: t }));
            } catch { }
          };
          const norm = (h: any) => (h ? String(h) : "");
          const wrapFetch = () => {
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
                      (kv ? String(kv[1]) : "") ||
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
                if (token && sameOrigin && isConsulApi) emit(token);
              } catch { }
              return (orig as any).apply(this, arguments as any);
            } as any;
          };
          const wrapXHR = () => {
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
                  if (t && isConsulApi) emit(t);
                }
              } catch { }
              return origSet.apply(this, arguments as any);
            } as any;
          };
          if (!(window as any).__ss_fetch_wrapped) {
            wrapFetch();
            wrapXHR();
            (window as any).__ss_fetch_wrapped = true;
          }
          try {
            const dc = String(dcArg || "");
            const prefix = String(prefixArg || "");
            const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
            const kvPath = prefix ? `/v1/kv/${encodeURI(prefix)}` : "/v1/kv/";
            const kvUrl = `${kvPath}${suffix}${suffix ? "&" : "?"}keys&separator=/`;
            fetch("/v1/agent/self" + suffix, { credentials: "include" }).catch(() => { });
            fetch(kvUrl, { credentials: "include" }).catch(() => { });
          } catch { }
        }
      });
    } catch { }
  }

  async function primeTokenCaptureOnTab(tabId: number, dc: string, prefix: string) {
    try {
      await C_token.tabs.sendMessage(tabId, { type: "SS_PRIME", dc, prefix });
    } catch { }
  }

  async function ensureTokenAvailable(tabId: number, host: string, dc: string, prefix: string) {
    await installTokenSniffer(tabId, dc, prefix);
    await primeTokenCaptureOnTab(tabId, dc, prefix);
    for (let i = 0; i < 40; i += 1) {
      const token = await fetchTokenFromBackground(host);
      if (token) return token;
      await sleep(50);
    }
    try {
      await C_token.tabs.sendMessage(tabId, { type: "SS_SCAN" });
      for (let i = 0; i < 20; i += 1) {
        const t = await fetchTokenFromBackground(host);
        if (t) return t;
        await sleep(50);
      }
    } catch { }
    const token = await captureAndStoreTokenFromConsulStorage(tabId, host, dc);
    if (token) return token;
    return "";
  }

  (globalThis as any).SECRETS_SANTA.TOKEN = { ensureTokenAvailable };
})();
