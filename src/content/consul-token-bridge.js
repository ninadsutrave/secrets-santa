(() => {
  function emitToken(t) {
    try {
      window.dispatchEvent(new CustomEvent("SECRETS_SANTA_TOKEN", { detail: String(t || "") }));
    } catch {}
  }
  function norm(h) {
    return h ? String(h) : "";
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
    window.__ss_bridge_installed = true;
  }
})(); 
