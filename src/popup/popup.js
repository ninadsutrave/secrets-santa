/* Popup UI:
   - Loads secrets for the current Consul KV page
   - Renders keys/values with masking/copy/pretty JSON
   - Saves and compares snapshots */

const { CONSTANTS, STORAGE, TOKEN, ENV, TABLE, COLLECTIONS, COMPARE, UPLOAD } = globalThis.SECRETS_SANTA;

const loadBtn = document.getElementById("loadBtn");
const grantPermissionBtn = document.getElementById("grantPermissionBtn");
const loadSavedBtn = document.getElementById("loadSavedBtn");
const saveBtn = document.getElementById("saveBtn");
const compareBtn = document.getElementById("compareBtn");
const downloadBtn = document.getElementById("downloadBtn");
const intellijBtn = document.getElementById("intellijBtn");
const envFileInput = document.getElementById("envFileInput");
const uploadKeyValuesBtn = document.getElementById("uploadKeyValuesBtn");
const uploadModal = document.getElementById("uploadModal");
const uploadModalClose = document.getElementById("uploadModalClose");
const uploadCancelBtn = document.getElementById("uploadCancelBtn");
const uploadConfirmBtn = document.getElementById("uploadConfirmBtn");
const uploadSummary = document.getElementById("uploadSummary");
const uploadTabEnv = document.getElementById("uploadTabEnv");
const uploadTabJetbrains = document.getElementById("uploadTabJetbrains");
const uploadPanelEnv = document.getElementById("uploadPanelEnv");
const uploadPanelJetbrains = document.getElementById("uploadPanelJetbrains");
const chooseEnvFileBtn = document.getElementById("chooseEnvFileBtn");
const envFileLabel = document.getElementById("envFileLabel");
const jetbrainsPasteInput = document.getElementById("jetbrainsPasteInput");
const table = document.getElementById("secretsTable");
const tbody = document.getElementById("secretsBody");
const savedList = document.getElementById("savedList");
const loader = document.getElementById("loader");
const statusDiv = document.getElementById("status");
const searchContainer = document.getElementById("search-container");
const searchInput = document.getElementById("search-input");
const darkToggle = document.getElementById("dark-toggle");
const jsonModal = document.getElementById("jsonModal");
const reviewLink = document.getElementById("reviewLink");

let currentSecrets = {};
let currentView = "table";
let currentPrefix = "";
let currentHost = "";
let isDiffView = false;
let comparePickerOpen = false;
let diffLeftTitle = "";
let diffRightTitle = "";
let pendingConsulContext = null;
let currentDataSource = "none";
let currentScheme = "https";
let currentDc = "";

const SENSITIVE_REGEX = CONSTANTS.UI.SENSITIVE_KEY_REGEX;

// Sets the user-visible status banner text at the top of the popup.
// Pass a short, actionable message. Empty/falsey clears the banner.
function setStatus(text) {
  statusDiv.textContent = text || "";
}

// Shows or hides the global loader spinner overlay.
// Use for short-lived background actions; keep visible time minimal.
function showLoader(visible) {
  if (!loader) return;
  loader.classList.toggle("hidden", !visible);
}

// Ensures the search input is visible to filter the current view (table or list).
// The actual filtering behavior is bound to the input handler below.
function showSearch() {
  if (!searchContainer) return;
  searchContainer.classList.add("visible");
}

// Toggles visibility and enabled state of post-load controls (download, save, JetBrains).
// Should be enabled only when a concrete set of keys is visible (table view).
function setPostLoadVisible(visible) {
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

// Controls the Compare button’s visibility and enabled state.
// The button is available when there are at least 2 saved collections for the host.
function setCompareVisible(visible, enabled = visible) {
  if (!compareBtn) return;
  compareBtn.classList.toggle("hidden", !visible);
  compareBtn.disabled = !enabled;
  compareBtn.textContent = comparePickerOpen ? "Cancel Compare" : "Compare";
}

// Resets the popup UI to its clean state before a new load or when switching modes.
// Clears tables/lists, hides modals, resets state flags and UI controls.
function resetUI() {
  tbody.innerHTML = "";
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
  if (jetbrainsPasteInput) jetbrainsPasteInput.value = "";
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
  onValueSaved: (k, v) => {
    currentSecrets[k] = v;
  },
  SENSITIVE_REGEX: SENSITIVE_REGEX,
  setCurrentView: (view) => {
    currentView = view;
  },
  setIsDiffView: (val) => {
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
  onLoadCollection: (collection) => {
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
  setCurrentView: (view) => {
    currentView = view;
  },
  setIsDiffView: (val) => {
    isDiffView = val;
  },
  setDiffTitles: (a, b) => {
    diffLeftTitle = a;
    diffRightTitle = b;
  },
  getDiffLeftTitle: () => diffLeftTitle,
  getDiffRightTitle: () => diffRightTitle,
  TABLE,
  setPickerOpen: (open) => {
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
  onApplied: (ctx, tabId) => {
    loadSecretsForContext(ctx, tabId);
  }
});

// Converts API responses into a flat key→value map.
// Supports either array of {key,value} or a plain object already keyed by KV.
function normalizeKeys(keys) {
  if (!keys) return null;
  if (Array.isArray(keys)) {
    const map = {};
    keys.forEach((item) => {
      if (!item || !item.key) return;
      map[item.key] = item.value ?? "";
    });
    return map;
  }
  if (typeof keys === "object") return keys;
  return null;
}

// Parses a Consul UI URL and extracts: scheme, host, datacenter, and KV prefix (with trailing slash).
// Returns null if the URL does not resemble a Consul KV page.
function parseConsulContext(url) {
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

// Builds the optional host permission origins for a given Consul host.
// Includes both https and http schemes to satisfy sites that downgrade.
function getConsulOrigins(host) {
  return [`https://${host}/*`, `http://${host}/*`];
}

// Checks whether the extension already has the required host permissions for the Consul host.
function hasConsulHostPermission(host) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) => chrome.permissions.contains({ origins }, (has) => resolve(Boolean(has))));
}

// Prompts the user to grant optional host permissions for the Consul host.
// Resolves to true when granted, false otherwise.
function requestConsulHostPermission(host) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) =>
    chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)))
  );
}

// Shows a CTA prompting the user to grant host access.
// Stores the context so the grant action can resume loading immediately after.
function showHostPermissionPrompt(ctx) {
  pendingConsulContext = ctx;
  if (grantPermissionBtn) grantPermissionBtn.classList.remove("hidden");
  setStatus(
    "Santa asks for permission to access Consul on this host. Your session token is used only in your browser, and actions run on paths you choose."
  );
}

// Hides any visible host permission CTA.
function hideHostPermissionPrompt() {
  pendingConsulContext = null;
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
}

// Attempts a heuristic token capture from local/session storage in the page context.
// Function removed as logic lives in content scripts now

/* token helpers moved to token.js */

/* token functions moved to token.js */

function getCollections(callback) {
  STORAGE.getCollections(callback);
}

// Enables or disables the “Load Saved” button depending on host-scoped collections.
function updateSavedAvailability() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    const ctx = tab?.url ? parseConsulContext(tab.url) : null;
    const host = ctx?.host || currentHost || "";
    if (!host) {
      loadSavedBtn.disabled = true;
      // Allow loading even without host to support "any website" requirement
      // But we need to know if any collections exist at all
      COLLECTIONS.getAll((collections) => {
        loadSavedBtn.disabled = !collections || collections.length === 0;
      });
      return;
    }
    COLLECTIONS.getAll((collections) => {
      // If we have a host, prioritize that? Or just show all?
      // User said "Load Saved should be cliackable on any tab"
      // So logic: always check if ANY collection exists.
      loadSavedBtn.disabled = !collections || collections.length === 0;
    });
  });
}

/* env helpers moved to env-utils.js */

/* json modal moved to modals.js */

/* json test moved to env-utils.js */

/* buildValueActions moved to table.js */

/* table rendering moved to table.js */

/* compare moved to compare.js */

/* collections moved to collections.js */

function loadSecretsForContext(ctx, tabId, attempt = 0) {
  setStatus("Fetching keys...");
  chrome.runtime.sendMessage(
    { type: CONSTANTS.MESSAGE_TYPES.FETCH_PAGE_VALUES, scheme: ctx.scheme, host: ctx.host, dc: ctx.dc, prefix: ctx.prefix },
    (response) => {
      showLoader(false);
      if (chrome.runtime.lastError || !response) {
        setStatus("Santa says please refresh and come back.");
        return;
      }
      if (response.error) {
        const message = String(response.error || "");
        const lower = message.toLowerCase();
        let friendly = "Santa is unable to get keys. Please interact with the Consul UI (logged in) and try again.";
        if (lower.includes("grab your consul session")) {
          friendly = "Santa couldn't grab your Consul session. Please interact with the Consul UI while logged in and try again!";
        } else if (lower.includes("not found")) {
          // If the background already provided a friendly message for not found, use it.
          // Otherwise, provide a default friendly one.
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

loadBtn.addEventListener("click", async () => {
  resetUI();
  showLoader(true);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showLoader(false);
    setStatus("Unable to read current tab.");
    return;
  }

  const tabUrl = tab?.url || "";
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

grantPermissionBtn.addEventListener("click", async () => {
  const ctx = pendingConsulContext;
  if (!ctx?.host) {
    grantPermissionBtn.classList.add("hidden");
    return;
  }

  const granted = await requestConsulHostPermission(ctx.host);
  if (!granted) {
    setStatus("Permission denied. Santa can’t fetch keys without host access. 🎅🏻");
    return;
  }

  hideHostPermissionPrompt();
  showLoader(true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await TOKEN.ensureTokenAvailable(tab.id, ctx.host, ctx.dc, ctx.prefix);
    loadSecretsForContext(ctx, tab.id);
  } else {
    showLoader(false);
    setStatus("Unable to read current tab.");
  }
});

/* upload wiring delegated to upload.js */
UPLOAD.wireOpenButton(uploadKeyValuesBtn, {
  parseConsulContext,
  hasHostPermission: hasConsulHostPermission,
  showHostPermissionPrompt
});

saveBtn.addEventListener("click", () => {
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
    const matches = (collections || []).filter((c) => (c.title || "") === title && (c.host || "") === host);
    const now = Date.now();
    let next = [];
    if (matches.length === 0) {
      const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(now);
      const collection = { id, host, title, createdAt: now, updatedAt: now, keys: currentSecrets };
      next = [...collections, collection];
    } else {
      const keep = matches.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      next = (collections || [])
        .filter((c) => (c.id || "") !== (keep.id || ""))
        .concat([{ ...keep, host, title, updatedAt: now, keys: currentSecrets }]);
    }
    STORAGE.setCollections(next, () => {
      setStatus("Collection saved.");
      updateSavedAvailability();
    });
  });
});

loadSavedBtn.addEventListener("click", () => {
  setStatus("");
  resetUI();
  showLoader(true);

  // We no longer require a Consul tab to load saved collections.
  getCollections((collections) => {
    showLoader(false);
    if (!collections || collections.length === 0) {
      setStatus("No saved collections found.");
      loadSavedBtn.disabled = true;
      return;
    }

    // Group by host
    const grouped = {};
    collections.forEach(c => {
      const h = c.host || "Unknown Host";
      if (!grouped[h]) grouped[h] = [];
      grouped[h].push(c);
    });

    COLLECTIONS.renderList(collections, true); // true for "grouped mode"

    setPostLoadVisible(false);
    setCompareVisible(true, collections.length >= 2);
    loadSavedBtn.disabled = false;
    setStatus(`Loaded ${collections.length} collections`);

    // Copy Jetbrains button visible but disabled on Load Saved page
    if (intellijBtn) {
      intellijBtn.classList.remove("hidden");
      intellijBtn.disabled = true;
    }
  });
});

downloadBtn.addEventListener("click", () => {
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

intellijBtn.addEventListener("click", () => {
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

/* compare wiring delegated to compare.js */
COMPARE.wireButton(compareBtn, {
  parseConsulContext,
  getCollections,
  renderScopedList: (host, scoped) => {
    currentHost = host;
    COLLECTIONS.renderList(scoped);
  },
  getCurrentView: () => currentView,
  getCurrentHost: () => currentHost,
  setCurrentHost: (h) => {
    currentHost = h;
  },
  getCurrentSecrets: () => currentSecrets
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.toLowerCase();
  if (currentView === "list") {
    const items = savedList.querySelectorAll(".saved-item");
    items.forEach((item) => {
      const key = item.dataset.key || "";
      item.style.display = key.includes(query) ? "" : "none";
    });
  } else {
    const rows = tbody.querySelectorAll("tr");
    rows.forEach((row) => {
      const key = row.children[0].textContent.toLowerCase();
      row.style.display = key.includes(query) ? "" : "none";
    });
  }
});

darkToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  darkToggle.textContent = isDark ? "☀️" : "🌙";
  STORAGE.setDarkMode(isDark);
});

STORAGE.getDarkMode((isDark) => {
  if (isDark) {
    document.body.classList.add("dark");
    darkToggle.textContent = "☀️";
  }
});

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

// Global tooltip handler
const globalTooltip = document.getElementById("globalTooltip");
let tooltipTimeout;

function updateStatusOpaque() {
  const doc = document.documentElement;
  const scrollTop = window.pageYOffset || doc.scrollTop || 0;
  if (statusDiv) statusDiv.classList.toggle("status-opaque", scrollTop > 0);
}

window.addEventListener("scroll", updateStatusOpaque, { passive: true });
window.addEventListener("resize", updateStatusOpaque);
updateStatusOpaque();
function willOverflow(left, top, tipRect, containerRect) {
  if (left < containerRect.left + 2) return true;
  if (left + tipRect.width > containerRect.right - 2) return true;
  if (top < containerRect.top + 2) return true;
  if (top + tipRect.height > containerRect.bottom - 2) return true;
  return false;
}

function computeTooltipPosition(targetRect, tipRect, containerRect) {
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

document.body.addEventListener("mouseover", (e) => {
  const target = e.target.closest("[data-tip]");
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
    const container = document.querySelector(".container");
    const containerRect = container
      ? container.getBoundingClientRect()
      : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    globalTooltip.classList.remove("hidden");
    globalTooltip.classList.add("visible");
    const tooltipRect = globalTooltip.getBoundingClientRect();
    const pos = computeTooltipPosition(rect, tooltipRect, containerRect);
    globalTooltip.style.top = `${pos.top}px`;
    globalTooltip.style.left = `${pos.left}px`;
    globalTooltip.classList.remove("hidden");
    globalTooltip.classList.add("visible");
  }
});

document.body.addEventListener("mouseout", (e) => {
  const target = e.target.closest("[data-tip]");
  if (target && globalTooltip) {
    globalTooltip.classList.remove("visible");
    globalTooltip.classList.add("hidden");
  }
});

document.body.addEventListener("mousemove", (e) => {
  const target = e.target.closest("[data-tip]");
  if (!target || !globalTooltip || !globalTooltip.classList.contains("visible")) return;
  const rect = target.getBoundingClientRect();
  const container = document.querySelector(".container");
  const containerRect = container
    ? container.getBoundingClientRect()
    : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  const tooltipRect = globalTooltip.getBoundingClientRect();
  const pos = computeTooltipPosition(rect, tooltipRect, containerRect);
  globalTooltip.style.top = `${pos.top}px`;
  globalTooltip.style.left = `${pos.left}px`;
});
