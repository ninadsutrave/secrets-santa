/* Popup UI:
   - Loads secrets for the current Consul KV page
   - Renders keys/values with masking/copy/pretty JSON
   - Saves and compares snapshots */
const { CONSTANTS, STORAGE, TOKEN, ENV, TABLE, COLLECTIONS, COMPARE, UPLOAD } = (globalThis as any).SECRETS_SANTA;
const C_popup: any = (globalThis as any).chrome || (window as any).chrome;

const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement | null;
const grantPermissionBtn = document.getElementById("grantPermissionBtn") as HTMLButtonElement | null;
const loadSavedBtn = document.getElementById("loadSavedBtn") as HTMLButtonElement | null;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement | null;
const compareBtn = document.getElementById("compareBtn") as HTMLButtonElement | null;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement | null;
const intellijBtn = document.getElementById("intellijBtn") as HTMLButtonElement | null;
const envFileInput = document.getElementById("envFileInput") as HTMLInputElement | null;
const uploadKeyValuesBtn = document.getElementById("uploadKeyValuesBtn") as HTMLButtonElement | null;
const uploadModal = document.getElementById("uploadModal");
const uploadModalClose = document.getElementById("uploadModalClose") as HTMLButtonElement | null;
const uploadCancelBtn = document.getElementById("uploadCancelBtn") as HTMLButtonElement | null;
const uploadConfirmBtn = document.getElementById("uploadConfirmBtn") as HTMLButtonElement | null;
const uploadSummary = document.getElementById("uploadSummary");
const uploadTabEnv = document.getElementById("uploadTabEnv") as HTMLButtonElement | null;
const uploadTabJetbrains = document.getElementById("uploadTabJetbrains") as HTMLButtonElement | null;
const uploadPanelEnv = document.getElementById("uploadPanelEnv");
const uploadPanelJetbrains = document.getElementById("uploadPanelJetbrains");
const chooseEnvFileBtn = document.getElementById("chooseEnvFileBtn") as HTMLButtonElement | null;
const envFileLabel = document.getElementById("envFileLabel") as HTMLLabelElement | null;
const jetbrainsPasteInput = document.getElementById("jetbrainsPasteInput") as HTMLTextAreaElement | HTMLInputElement | null;
const table = document.getElementById("secretsTable");
const tbody = document.getElementById("secretsBody") as HTMLElement | null;
const savedList = document.getElementById("savedList") as HTMLElement | null;
const loader = document.getElementById("loader");
const statusDiv = document.getElementById("status") as HTMLElement | null;
const searchContainer = document.getElementById("search-container");
const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
const darkToggle = document.getElementById("dark-toggle") as HTMLButtonElement | null;
const jsonModal = document.getElementById("jsonModal");
const reviewLink = document.getElementById("reviewLink") as HTMLAnchorElement | null;

let currentSecrets: Record<string, string> = {};
let currentView: "table" | "list" = "table";
let currentPrefix = "";
let currentHost = "";
let isDiffView = false;
let comparePickerOpen = false;
let diffLeftTitle = "";
let diffRightTitle = "";
let pendingConsulContext: any = null;
let currentDataSource: "none" | "page" | "saved" = "none";
let currentScheme = "https";
let currentDc = "";

const SENSITIVE_REGEX = CONSTANTS.UI.SENSITIVE_KEY_REGEX;

function setStatus(text: string) {
  if (statusDiv) statusDiv.textContent = text || "";
}

function showLoader(visible: boolean) {
  if (!loader) return;
  loader.classList.toggle("hidden", !visible);
}

function showSearch() {
  if (!searchContainer) return;
  searchContainer.classList.add("visible");
}

function setPostLoadVisible(visible: boolean) {
  const controls = [downloadBtn, intellijBtn];
  controls.forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
    btn.disabled = !visible;
  });
  if (saveBtn) {
    saveBtn.classList.toggle("hidden", !visible);
    saveBtn.disabled = !visible;
  }
}

function setCompareVisible(visible: boolean, enabled: boolean = visible) {
  if (!compareBtn) return;
  compareBtn.classList.toggle("hidden", !visible);
  compareBtn.disabled = !enabled;
  compareBtn.textContent = comparePickerOpen ? "Cancel Compare" : "Compare";
}

function resetUI() {
  if (tbody) tbody.innerHTML = "";
  if (savedList) savedList.innerHTML = "";
  if (table) table.classList.add("hidden");
  if (savedList) savedList.classList.add("hidden");
  showLoader(false);
  setPostLoadVisible(false);
  comparePickerOpen = false;
  diffLeftTitle = "";
  diffRightTitle = "";
  currentHost = "";
  pendingConsulContext = null;
  currentDataSource = "none";
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
  setCompareVisible(false, false);
  if (searchContainer) searchContainer.classList.remove("visible");
  if (searchInput) searchInput.value = "";
  if (envFileInput) envFileInput.value = "";
  if (envFileLabel) envFileLabel.textContent = "No file chosen";
  if (jetbrainsPasteInput) (jetbrainsPasteInput as any).value = "";
  if (uploadConfirmBtn) uploadConfirmBtn.disabled = true;
  if (uploadSummary) uploadSummary.textContent = "0 keys ready";
  if (uploadModal) uploadModal.classList.add("hidden");
  if (jsonModal) jsonModal.classList.add("hidden");
}

TABLE.setup({
  table,
  tbody,
  savedList,
  intellijBtn,
  setStatus,
  showLoader,
  getContext: () => ({ prefix: currentPrefix, host: currentHost, scheme: currentScheme, dc: currentDc }),
  onValueSaved: (k: string, v: string) => {
    currentSecrets[k] = v;
  },
  SENSITIVE_REGEX: SENSITIVE_REGEX,
  setCurrentView: (view: "table" | "list") => {
    currentView = view;
  },
  setIsDiffView: (val: boolean) => {
    isDiffView = val;
  },
  getDiffLeftTitle: () => diffLeftTitle,
  getDiffRightTitle: () => diffRightTitle,
  getCanEdit: () => currentDataSource === "page" && !isDiffView
});

COLLECTIONS.setup({
  savedList,
  table,
  STORAGE,
  setStatus,
  setPostLoadVisible,
  setCompareVisible,
  showSearch,
  TABLE,
  onLoadCollection: (collection: any) => {
    currentSecrets = collection.keys;
    currentPrefix = collection.title || "";
    currentHost = collection.host || currentHost || "";
    isDiffView = false;
    currentDataSource = "saved";
    TABLE.renderTable(currentSecrets);
    setPostLoadVisible(true);
    setCompareVisible(true, true);
    showSearch();
    setStatus(`Loaded ${Object.keys(currentSecrets).length} keys`);
  }
});

COMPARE.setup({
  savedList,
  table,
  intellijBtn,
  setStatus,
  setPostLoadVisible,
  setCompareVisible,
  showSearch,
  setCurrentView: (view: "table" | "list") => {
    currentView = view;
  },
  setIsDiffView: (val: boolean) => {
    isDiffView = val;
  },
  setDiffTitles: (a: string, b: string) => {
    diffLeftTitle = a;
    diffRightTitle = b;
  },
  getDiffLeftTitle: () => diffLeftTitle,
  getDiffRightTitle: () => diffRightTitle,
  TABLE,
  setPickerOpen: (open: boolean) => {
    comparePickerOpen = Boolean(open);
  }
});

UPLOAD.setup({
  elements: {
    uploadModal,
    uploadModalClose,
    uploadCancelBtn,
    uploadConfirmBtn,
    uploadSummary,
    uploadTabEnv,
    uploadTabJetbrains,
    uploadPanelEnv,
    uploadPanelJetbrains,
    chooseEnvFileBtn,
    envFileInput,
    envFileLabel,
    jetbrainsPasteInput
  },
  setStatus,
  showLoader,
  ENV,
  TOKEN,
  CONSTANTS,
  onApplied: (ctx: any, tabId: number) => {
    loadSecretsForContext(ctx, tabId);
  }
});

function normalizeKeys(keys: any) {
  if (!keys) return null;
  if (Array.isArray(keys)) {
    const map: Record<string, string> = {};
    keys.forEach((item: any) => {
      if (!item || !item.key) return;
      map[item.key] = item.value ?? "";
    });
    return map;
  }
  if (typeof keys === "object") return keys;
  return null;
}

function parseConsulContext(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const uiIndex = parts.indexOf("ui");
    const kvIndex = parts.indexOf("kv");
    if (uiIndex === -1 || kvIndex === -1) return null;
    const dc = parts[uiIndex + 1] || "";
    const prefix = parts.slice(kvIndex + 1).join("/");
    const scheme = String(u.protocol || "").replace(":", "") || "https";
    if (!dc) return null;
    const normalizedPrefix = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
    return { scheme, host: u.host, dc, prefix: normalizedPrefix };
  } catch {
    return null;
  }
}

function getConsulOrigins(host: string) {
  return [`https://${host}/*`, `http://${host}/*`];
}

function hasConsulHostPermission(host: string) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) => C_popup.permissions.contains({ origins }, (has: boolean) => resolve(Boolean(has))));
}

function requestConsulHostPermission(host: string) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) =>
    C_popup.permissions.request({ origins }, (granted: boolean) => resolve(Boolean(granted)))
  );
}

function showHostPermissionPrompt(ctx: any) {
  pendingConsulContext = ctx;
  if (grantPermissionBtn) grantPermissionBtn.classList.remove("hidden");
  setStatus(
    "Santa asks for permission to access Consul on this host. Your session token is used only in your browser, and actions run on paths you choose."
  );
}

function hideHostPermissionPrompt() {
  pendingConsulContext = null;
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
}

function getCollections(callback: (collections: any[]) => void) {
  STORAGE.getCollections(callback);
}

function loadSecretsForContext(ctx: any, tabId: number, attempt = 0) {
  setStatus("Fetching keys...");
  C_popup.runtime.sendMessage(
    { type: CONSTANTS.MESSAGE_TYPES.FETCH_PAGE_VALUES, scheme: ctx.scheme, host: ctx.host, dc: ctx.dc, prefix: ctx.prefix },
    (response: any) => {
      showLoader(false);
      if ((C_popup.runtime as any).lastError || !response) {
        const err = (C_popup.runtime as any).lastError?.message || "Internal communication failed.";
        setStatus(`Santa says please refresh and come back. (${err})`);
        return;
      }
      if (response.error) {
        const message = String(response.error || "");
        const lower = message.toLowerCase();
        let friendly = "Santa is unable to get keys. Please interact with the Consul UI (logged in) and try again.";
        if (lower.includes("grab your consul session")) {
          friendly = "Santa couldn't grab your Consul session. Please interact with the Consul UI while logged in and try again!";
        } else if (lower.includes("not found")) {
          friendly = lower.includes("santa can't find") ? message : "Santa can't find these secrets. Check the folder path or datacenter, or interact with the Consul UI to refresh your session.";
        } else if (lower.includes("santa noticed your consul session expired")) {
          friendly = "Santa noticed your Consul session expired. Please interact with the Consul UI (logged in) and try again!";
        } else if (lower.includes("permission denied") || lower.includes("acl not found") || lower.includes("access")) {
          friendly = "Your Consul session might have expired. Please interact with the Consul UI (logged in) and try again!";
        } else if (lower.includes("santa says") || lower.includes("santa couldn't") || lower.includes("santa can't")) {
          friendly = message;
        }
        const shouldRetry =
          attempt === 0 &&
          tabId &&
          (lower.includes("acl not found") ||
            lower.includes("santa couldn't capture") ||
            lower.includes("permission denied") ||
            lower.includes("access"));
        if (shouldRetry) {
          showLoader(true);
          setStatus("Refreshing Consul session…");
          TOKEN.ensureTokenAvailable(tabId, ctx.host, ctx.dc, ctx.prefix).then(() => {
            loadSecretsForContext(ctx, tabId, attempt + 1);
          });
          return;
        }
        setStatus(friendly);
        return;
      }
      const normalized = normalizeKeys(response?.keys);
      if (!normalized || Object.keys(normalized).length === 0) {
        const skipped = Number(response?.skipped || 0);
        if (skipped > 0) {
          setStatus("Santa sees only folders on this page.");
          return;
        }
        setStatus("Santa is unable to get keys on this page.");
        return;
      }
      currentPrefix = response?.prefix || `/${ctx.prefix.replace(/\/$/, "")}`;
      currentSecrets = normalized;
      currentHost = ctx.host || "";
      currentScheme = ctx.scheme || "https";
      currentDc = ctx.dc || "";
      isDiffView = false;
      currentDataSource = "page";
      TABLE.renderTable(currentSecrets);
      setPostLoadVisible(true);
      setCompareVisible(true, true);
      showSearch();
      const failed = Number(response?.failed || 0);
      const skipped = Number(response?.skipped || 0);
      const parts = [`Loaded ${Object.keys(currentSecrets).length} keys`];
      if (skipped) parts.push(`${skipped} folders skipped`);
      if (failed) parts.push(`${failed} values failed`);
      setStatus(parts.join(" · "));
    }
  );
}

loadBtn?.addEventListener("click", async () => {
  resetUI();
  showLoader(true);
  const [tab] = await C_popup.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showLoader(false);
    setStatus("Unable to read current tab.");
    return;
  }
  const tabUrl = (tab as any)?.url || "";
  const ctx = parseConsulContext(tabUrl);
  if (!ctx) {
    showLoader(false);
    try {
      const u = new URL(tabUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const isConsulUi = parts.includes("ui");
      if (isConsulUi && !parts.includes("kv")) {
        setStatus("Santa can help once you open a Consul KV page.");
      } else {
        setStatus("Santa can only help you on a valid Consul KV page.");
      }
    } catch {
      setStatus("Santa can only help you on a valid Consul KV page.");
    }
    return;
  }
  const allowed = await hasConsulHostPermission(ctx.host);
  if (!allowed) {
    showLoader(false);
    showHostPermissionPrompt(ctx);
    return;
  }
  hideHostPermissionPrompt();
  await TOKEN.ensureTokenAvailable(tab.id, ctx.host, ctx.dc, ctx.prefix);
  loadSecretsForContext(ctx, tab.id);
});

grantPermissionBtn?.addEventListener("click", async () => {
  const ctx = pendingConsulContext;
  if (!ctx?.host) {
    grantPermissionBtn?.classList.add("hidden");
    return;
  }
  const granted = await requestConsulHostPermission(ctx.host);
  if (!granted) {
    setStatus("Permission denied. Santa can’t fetch keys without host access. 🎅🏻");
    return;
  }
  hideHostPermissionPrompt();
  showLoader(true);
  const [tab] = await C_popup.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await TOKEN.ensureTokenAvailable(tab.id, ctx.host, ctx.dc, ctx.prefix);
    loadSecretsForContext(ctx, tab.id);
  } else {
    showLoader(false);
    setStatus("Unable to read current tab.");
  }
});

UPLOAD.wireOpenButton(uploadKeyValuesBtn, {
  parseConsulContext,
  hasHostPermission: hasConsulHostPermission,
  showHostPermissionPrompt
});

saveBtn?.addEventListener("click", () => {
  if (!currentSecrets || Object.keys(currentSecrets).length === 0) {
    setStatus("No keys to save.");
    return;
  }
  if (!currentPrefix) {
    setStatus("Load secrets from a Consul page first.");
    return;
  }
  let host = currentHost || "";
  if (!host) host = "Unknown Host";
  getCollections((collections) => {
    const title = currentPrefix;
    const matches = (collections || []).filter((c: any) => (c.title || "") === title && (c.host || "") === host);
    const now = Date.now();
    let next: any[] = [];
    if (matches.length === 0) {
      const id = typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(now);
      const collection = { id, host, title, createdAt: now, updatedAt: now, keys: currentSecrets };
      next = [...collections, collection];
    } else {
      const keep = matches.sort((a: any, b: any) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      next = (collections || [])
        .filter((c: any) => (c.id || "") !== (keep.id || ""))
        .concat([{ ...keep, host, title, updatedAt: now, keys: currentSecrets }]);
    }
    STORAGE.setCollections(next, () => {
      setStatus("Collection saved.");
      updateSavedAvailability();
    });
  });
});

loadSavedBtn?.addEventListener("click", () => {
  setStatus("");
  resetUI();
  showLoader(true);
  getCollections((collections) => {
    showLoader(false);
    if (!collections || collections.length === 0) {
      setStatus("No saved collections found.");
      if (loadSavedBtn) loadSavedBtn.disabled = true;
      return;
    }
    COLLECTIONS.renderList(collections, true);
    setPostLoadVisible(false);
    setCompareVisible(true, collections.length >= 2);
    if (loadSavedBtn) loadSavedBtn.disabled = false;
    setStatus(`Loaded ${collections.length} collections`);
    if (intellijBtn) {
      intellijBtn.classList.remove("hidden");
      intellijBtn.disabled = true;
    }
  });
});

downloadBtn?.addEventListener("click", () => {
  if (!currentSecrets || Object.keys(currentSecrets).length === 0) {
    setStatus("No keys to download.");
    return;
  }
  const envText = Object.entries(currentSecrets)
    .map(([key, value]) => `${key}=${ENV.formatEnvValue(value)}`)
    .join("\n");
  const blob = new Blob([envText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const base = String(currentPrefix || "secrets")
    .replace(/^\/+/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  link.download = `${base || "secrets"}.env`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Downloaded .env file.");
});

intellijBtn?.addEventListener("click", () => {
  if (!currentSecrets || Object.keys(currentSecrets).length === 0) {
    setStatus("No keys to copy.");
    return;
  }
  const pairs = Object.entries(currentSecrets)
    .map(([key, value]) => `${key}=${ENV.formatEnvValue(value)}`)
    .join(";");
  const payload = pairs.length > 0 ? `${pairs};` : "";
  navigator.clipboard.writeText(payload);
  setStatus("Copied JetBrains format.");
});

COMPARE.wireButton(compareBtn, {
  parseConsulContext,
  getCollections,
  renderScopedList: (host: string, scoped: any[]) => {
    currentHost = host;
    COLLECTIONS.renderList(scoped);
  },
  getCurrentView: () => currentView,
  getCurrentHost: () => currentHost,
  setCurrentHost: (h: string) => {
    currentHost = h;
  },
  getCurrentSecrets: () => currentSecrets
});

searchInput?.addEventListener("input", () => {
  const query = (searchInput?.value || "").toLowerCase();
  if (currentView === "list") {
    const items = savedList?.querySelectorAll(".saved-item") || [];
    items.forEach((item) => {
      const el = item as HTMLElement;
      const key = el.dataset.key || "";
      el.style.display = key.includes(query) ? "" : "none";
    });
  } else {
    const rows = tbody?.querySelectorAll("tr") || [];
    rows.forEach((row) => {
      const el = row as HTMLElement;
      const key = (el.children[0] as HTMLElement).textContent?.toLowerCase() || "";
      el.style.display = key.includes(query) ? "" : "none";
    });
  }
});

darkToggle?.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  if (darkToggle) darkToggle.textContent = isDark ? "☀️" : "🌙";
  STORAGE.setDarkMode(isDark);
});

STORAGE.getDarkMode((isDark: boolean) => {
  if (isDark) {
    document.body.classList.add("dark");
    if (darkToggle) darkToggle.textContent = "☀️";
  }
});

function updateSavedAvailability() {
  C_popup.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
    const tab = tabs?.[0];
    const ctx = (tab as any)?.url ? parseConsulContext((tab as any).url) : null;
    const host = (ctx as any)?.host || currentHost || "";
    if (!host) {
      if (loadSavedBtn) loadSavedBtn.disabled = true;
      COLLECTIONS.getAll((collections: any[]) => {
        if (loadSavedBtn) loadSavedBtn.disabled = !collections || collections.length === 0;
      });
      return;
    }
    COLLECTIONS.getAll((collections: any[]) => {
      if (loadSavedBtn) loadSavedBtn.disabled = !collections || collections.length === 0;
    });
  });
}

updateSavedAvailability();

if (reviewLink) {
  const ua = navigator.userAgent.toLowerCase();
  const LINKS = CONSTANTS.LINKS || {};
  let url = LINKS.CHROME_WEBSTORE || "";
  if (ua.includes("firefox")) {
    url = LINKS.FIREFOX_ADDON || url;
  } else if (ua.includes("edg/")) {
    url = LINKS.EDGE_ADDONS || url;
  }
  reviewLink.href = url || "https://github.com/ninadsutrave/secrets-santa";
}

const globalTooltip = document.getElementById("globalTooltip") as HTMLElement | null;
let tooltipTimeout: any;

function updateStatusOpaque() {
  const doc = document.documentElement;
  const scrollTop = (window.pageYOffset || (doc as any).scrollTop || 0);
  if (statusDiv) statusDiv.classList.toggle("status-opaque", scrollTop > 0);
}

window.addEventListener("scroll", updateStatusOpaque, { passive: true } as any);
window.addEventListener("resize", updateStatusOpaque);
updateStatusOpaque();
function willOverflow(left: number, top: number, tipRect: DOMRect, containerRect: DOMRect) {
  if (left < (containerRect.left + 2)) return true;
  if (left + tipRect.width > (containerRect.right - 2)) return true;
  if (top < (containerRect.top + 2)) return true;
  if (top + tipRect.height > (containerRect.bottom - 2)) return true;
  return false;
}

function computeTooltipPosition(targetRect: DOMRect, tipRect: DOMRect, containerRect: DOMRect) {
  const offset = 6;
  let top = targetRect.bottom + offset;
  let left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
  const minLeft = containerRect.left + 4;
  const maxLeft = containerRect.right - tipRect.width - 4;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  if (top + tipRect.height > containerRect.bottom - 4) {
    top = targetRect.top - tipRect.height - offset;
  }
  if (top < containerRect.top + 4) {
    let tryRightTop = targetRect.top + (targetRect.height - tipRect.height) / 2;
    let tryRightLeft = targetRect.right + offset;
    if (willOverflow(tryRightLeft, tryRightTop, tipRect, containerRect)) {
      let tryLeftLeft = targetRect.left - tipRect.width - offset;
      if (willOverflow(tryLeftLeft, tryRightTop, tipRect, containerRect)) {
        top = containerRect.top + 4;
        left = Math.min(Math.max(left, minLeft), maxLeft);
      } else {
        top = tryRightTop;
        left = tryLeftLeft;
      }
    } else {
      top = tryRightTop;
      left = tryRightLeft;
    }
  } else {
    const rightEdge = left + tipRect.width;
    if (rightEdge > containerRect.right - 4) {
      left = targetRect.right - tipRect.width;
      if (left < minLeft) left = minLeft;
    }
  }
  return { top, left };
}

document.body.addEventListener("mouseover", (e: any) => {
  const target = (e.target as HTMLElement).closest("[data-tip]") as HTMLElement | null;
  if (!target) {
    if (globalTooltip) {
      globalTooltip.classList.remove("visible");
      globalTooltip.classList.add("hidden");
    }
    return;
  }
  const tipText = target.getAttribute("data-tip");
  if (!tipText) return;
  clearTimeout(tooltipTimeout);
  if (globalTooltip) {
    globalTooltip.textContent = tipText;
    const rect = target.getBoundingClientRect();
    const container = document.querySelector(".container") as HTMLElement | null;
    const containerRect = container
      ? container.getBoundingClientRect()
      : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight } as any;
    globalTooltip.classList.remove("hidden");
    globalTooltip.classList.add("visible");
    const tooltipRect = globalTooltip.getBoundingClientRect();
    const pos = computeTooltipPosition(rect, tooltipRect, containerRect as DOMRect);
    globalTooltip.style.top = `${pos.top}px`;
    globalTooltip.style.left = `${pos.left}px`;
    globalTooltip.classList.remove("hidden");
    globalTooltip.classList.add("visible");
  }
});

document.body.addEventListener("mouseout", (e: any) => {
  const target = (e.target as HTMLElement).closest("[data-tip]");
  if (target && globalTooltip) {
    globalTooltip.classList.remove("visible");
    globalTooltip.classList.add("hidden");
  }
});

document.body.addEventListener("mousemove", (e: any) => {
  const target = (e.target as HTMLElement).closest("[data-tip]") as HTMLElement | null;
  if (!target || !globalTooltip || !globalTooltip.classList.contains("visible")) return;
  const rect = target.getBoundingClientRect();
  const container = document.querySelector(".container") as HTMLElement | null;
  const containerRect = container
    ? container.getBoundingClientRect()
    : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight } as any;
  const tooltipRect = globalTooltip.getBoundingClientRect();
  const pos = computeTooltipPosition(rect, tooltipRect, containerRect as DOMRect);
  globalTooltip.style.top = `${pos.top}px`;
  globalTooltip.style.left = `${pos.left}px`;
});

export {};
