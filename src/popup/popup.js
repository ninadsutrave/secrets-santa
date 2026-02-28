/* Popup UI:
   - Loads secrets for the current Consul KV page
   - Renders keys/values with masking/copy/pretty JSON
   - Saves and compares snapshots */

const { CONSTANTS, STORAGE, TOKEN, ENV, MODALS, TABLE, COLLECTIONS, COMPARE, UPLOAD } = globalThis.SECRETS_SANTA;

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

let currentSecrets = {};
let currentView = "table";
let currentPrefix = "";
let currentHost = "";
let currentLoadedCollectionId = null;
let isDiffView = false;
let comparePickerOpen = false;
let compareSelectedIds = [];
let diffLeftTitle = "";
let diffRightTitle = "";
let pendingConsulContext = null;
let pendingUpload = null;
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
  compareSelectedIds = [];
  diffLeftTitle = "";
  diffRightTitle = "";
  currentHost = "";
  pendingConsulContext = null;
  pendingUpload = null;
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
  getDiffRightTitle: () => diffRightTitle
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
    currentLoadedCollectionId = collection.id || null;
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
  TABLE
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
    `Santa asks for permission to fetch your key values in a friendly format! \n🎅🏻 Don't worry this is a READ ONLY extension! 🎅🏻 Ho ho ho!.`
  );
}

// Hides any visible host permission CTA.
function hideHostPermissionPrompt() {
  pendingConsulContext = null;
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
}

// Attempts a heuristic token capture from local/session storage in the page context.
async function tryCaptureTokenFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        const shouldScanKey = (key) => {
          const k = String(key || "").toLowerCase();
          if (!k) return false;
          if (k.includes("consul")) return true;
          if (k.includes("token")) return true;
          if (k.includes("acl")) return true;
          if (k.includes("session")) return true;
          return false;
        };

        const tryExtractUuid = (value) => {
          const v = String(value || "").trim();
          if (!v) return "";
          if (uuidLike.test(v)) return v;
          const match = v.match(uuidInText);
          if (match?.[0]) return match[0];
          return "";
        };

        const findUuidDeep = (obj, depth = 0) => {
          if (!obj || depth > 5) return "";
          if (typeof obj === "string") return tryExtractUuid(obj);
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

        const candidates = [];
        const add = (k, v, source) => {
          if (!k || !v) return;
          const key = String(k);
          if (!shouldScanKey(key)) return;

          const raw = String(v).trim();
          if (!raw) return;

          let token = tryExtractUuid(raw);
          if (!token) {
            try {
              const parsed = JSON.parse(raw);
              token = findUuidDeep(parsed);
            } catch {
              token = "";
            }
          }
          if (!token) return;

          let score = 0;
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes("consul")) score += 4;
          if (lowerKey.includes("token")) score += 6;
          if (lowerKey.includes("acl")) score += 2;
          if (source === "sessionStorage") score += 1;
          candidates.push({ value: token, score, source, key });
        };

        const scan = (storage, source) => {
          if (!storage) return;
          for (let i = 0; i < storage.length; i += 1) {
            const k = storage.key(i);
            const v = storage.getItem(k);
            add(k, v, source);
          }
        };

        scan(localStorage, "localStorage");
        scan(sessionStorage, "sessionStorage");

        candidates.sort((a, b) => b.score - a.score);
        const top = candidates[0];
        if (!top) return "";
        if (top.score < 6) return "";
        return top.value;
      }
    });

    const token = String(results?.[0]?.result || "");
    if (!token) return "";
    return token;
  } catch {
    return "";
  }
}

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
      return;
    }
    COLLECTIONS.getAll((collections) => {
      const scoped = (collections || []).filter((c) => (c.host || "") === host);
      loadSavedBtn.disabled = scoped.length === 0;
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
        let friendly = "Santa is unable to get keys. Please refresh and try again.";
        if (lower.includes("prefix not found")) {
          friendly = "Santa is unable to get keys for this prefix. Check datacenter/prefix or permissions.";
        } else if (lower.includes("no consul token captured")) {
          friendly = "Santa couldn’t find your Consul session yet. Please interact with the Consul UI and try again.";
        } else if (lower.includes("permission denied") || lower.includes("acl not found") || lower.includes("access")) {
          friendly = "Santa is unable to get keys: access issue. Ensure your token has key:read and refresh.";
        }
        const shouldRetry =
          attempt === 0 &&
          tabId &&
          (message.toLowerCase().includes("acl not found") || message.toLowerCase().includes("no consul token captured"));
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
      currentLoadedCollectionId = null;
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
    setStatus("Santa can only help you on a valid Consul page.");
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
  if (tab?.id) await TOKEN.ensureTokenAvailable(tab.id, ctx.host, ctx.dc, ctx.prefix);
  loadSecretsForContext(ctx, tab?.id);
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
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    const ctx = tab?.url ? parseConsulContext(tab.url) : null;
    const host = currentHost || ctx?.host || "";
    if (!host) {
      setStatus("Open a Consul KV page to save a host-scoped collection.");
      return;
    }

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
});

loadSavedBtn.addEventListener("click", () => {
  setStatus("");
  resetUI();
  showLoader(true);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    const ctx = tab?.url ? parseConsulContext(tab.url) : null;
    const host = ctx?.host || currentHost || "";
    if (!host) {
      showLoader(false);
      setStatus("Open a Consul KV page to view host-scoped saved collections.");
      loadSavedBtn.disabled = true;
      return;
    }

    getCollections((collections) => {
      showLoader(false);
      const scoped = (collections || []).filter((c) => (c.host || "") === host);
      if (scoped.length === 0) {
        setStatus("No saved collections found for this host.");
        loadSavedBtn.disabled = true;
        return;
      }

      currentHost = host;
      COLLECTIONS.renderList(scoped);
      setPostLoadVisible(false);
      setCompareVisible(true, scoped.length >= 2);
      loadSavedBtn.disabled = false;
      setStatus(`Loaded ${scoped.length} collections`);
    });
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
