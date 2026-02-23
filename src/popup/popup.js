/* Popup UI:
   - Loads secrets for the current Consul KV page
   - Renders keys/values with masking/copy/pretty JSON
   - Saves and compares snapshots */

const { CONSTANTS, STORAGE } = globalThis.SECRETS_SANTA;

const loadBtn = document.getElementById("loadBtn");
const grantPermissionBtn = document.getElementById("grantPermissionBtn");
const loadSavedBtn = document.getElementById("loadSavedBtn");
const saveBtn = document.getElementById("saveBtn");
const compareBtn = document.getElementById("compareBtn");
const downloadBtn = document.getElementById("downloadBtn");
const intellijBtn = document.getElementById("intellijBtn");
const table = document.getElementById("secretsTable");
const tbody = document.getElementById("secretsBody");
const savedList = document.getElementById("savedList");
const loader = document.getElementById("loader");
const statusDiv = document.getElementById("status");
const searchContainer = document.getElementById("search-container");
const searchInput = document.getElementById("search-input");
const darkToggle = document.getElementById("dark-toggle");

let currentSecrets = {};
let currentView = "table";
let currentPrefix = "";
let currentLoadedCollectionId = null;
let isDiffView = false;
let comparePickerOpen = false;
let compareSelectedIds = [];
let diffLeftTitle = "";
let diffRightTitle = "";
let pendingConsulContext = null;

const SENSITIVE_REGEX = CONSTANTS.UI.SENSITIVE_KEY_REGEX;

function setStatus(text) {
  statusDiv.textContent = text || "";
}

function showLoader(visible) {
  if (!loader) return;
  loader.classList.toggle("hidden", !visible);
}

function showSearch() {
  if (!searchContainer) return;
  searchContainer.classList.add("visible");
}

function setPostLoadVisible(visible) {
  const controls = [downloadBtn, intellijBtn];
  controls.forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
    btn.disabled = !visible;
  });
  if (saveBtn) {
    saveBtn.classList.remove("hidden");
    saveBtn.disabled = !visible;
  }
}

function setCompareVisible(visible, enabled = visible) {
  if (!compareBtn) return;
  compareBtn.classList.toggle("hidden", !visible);
  compareBtn.disabled = !enabled;
  compareBtn.textContent = comparePickerOpen ? "Cancel Compare" : "Compare";
}

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
  pendingConsulContext = null;
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
  setCompareVisible(false, false);
  if (searchContainer) searchContainer.classList.remove("visible");
  if (searchInput) searchInput.value = "";
}

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

function parseConsulContext(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const uiIndex = parts.indexOf("ui");
    const kvIndex = parts.indexOf("kv");
    if (uiIndex === -1 || kvIndex === -1) return null;
    const dc = parts[uiIndex + 1] || "";
    const prefix = parts.slice(kvIndex + 1).join("/");
    if (!dc || !prefix) return null;
    return { host: u.host, dc, prefix: prefix.endsWith("/") ? prefix : `${prefix}/` };
  } catch {
    return null;
  }
}

function getConsulOrigins(host) {
  return [`https://${host}/*`, `http://${host}/*`];
}

function hasConsulHostPermission(host) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) => chrome.permissions.contains({ origins }, (has) => resolve(Boolean(has))));
}

function requestConsulHostPermission(host) {
  const origins = getConsulOrigins(host);
  return new Promise((resolve) =>
    chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)))
  );
}

function showHostPermissionPrompt(ctx) {
  pendingConsulContext = ctx;
  if (grantPermissionBtn) grantPermissionBtn.classList.remove("hidden");
  setStatus(
    `Santa asks for permission to fetch your key values in a friendly format! \n🎅🏻 Don't worry this is a READ ONLY extension! 🎅🏻 Ho ho ho!.`
  );
}

function hideHostPermissionPrompt() {
  pendingConsulContext = null;
  if (grantPermissionBtn) grantPermissionBtn.classList.add("hidden");
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchTokenFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: CONSTANTS.MESSAGE_TYPES.FETCH_KEYS }, (res) => {
      resolve(String(res?.token || ""));
    });
  });
}

async function primeTokenCaptureOnTab(tabId, dc) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [dc],
      func: (dcArg) => {
        try {
          const dc = String(dcArg || "");
          const suffix = dc ? `?dc=${encodeURIComponent(dc)}` : "";
          fetch(`/v1/acl/token/self${suffix}`, { credentials: "include" }).catch(() => {});
          fetch(`/v1/session/node${suffix}`, { credentials: "include" }).catch(() => {});
        } catch {}
      }
    });
  } catch {}
}

async function ensureTokenAvailable(tabId, dc) {
  await primeTokenCaptureOnTab(tabId, dc);
  for (let i = 0; i < 8; i += 1) {
    const token = await fetchTokenFromBackground();
    if (token) return token;
    await sleep(150);
  }
  return "";
}

function getCollections(callback) {
  STORAGE.getCollections(callback);
}

function updateSavedAvailability() {
  getCollections((collections) => {
    loadSavedBtn.disabled = !collections || collections.length === 0;
  });
}

function formatEnvValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r?\n/g, "\\n");
}

function truncate(str, max = 80) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function mask(value) {
  return "•".repeat(Math.min(value.length, 12));
}

function isValidJSON(str) {
  try {
    if (typeof str !== "string") return false;
    const trimmed = str.trim();
    if (!trimmed) return false;
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function buildValueActions(key, value, valueContainer, actionsContainer) {
  const textSpan = document.createElement("span");
  textSpan.className = "value-text";

  const isSensitive = SENSITIVE_REGEX.test(key);
  const isJSON = isValidJSON(value);
  const truncationLimit = 120;

  let formattedJSON = null;
  if (isJSON) {
    formattedJSON = JSON.stringify(JSON.parse(String(value).trim()), null, 2);
  }

  const valueWrap = document.createElement("div");
  valueWrap.className = "value-wrap";

  const initialText = isSensitive
    ? mask(String(value))
    : isJSON
      ? truncate(formattedJSON, truncationLimit)
      : truncate(String(value), truncationLimit);

  textSpan.textContent = initialText;
  if (isSensitive) textSpan.classList.add("masked");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "⧉";
  copy.className = "icon-btn value-copy";
  copy.title = "Copy";
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    navigator.clipboard.writeText(String(value));
    setStatus(`Copied ${key}`);
  });

  valueWrap.appendChild(textSpan);
  valueWrap.appendChild(copy);
  valueContainer.appendChild(valueWrap);

  if (!isSensitive && !isJSON && typeof value === "string" && value.length > truncationLimit) {
    let expanded = false;
    textSpan.style.cursor = "pointer";
    textSpan.addEventListener("click", () => {
      expanded = !expanded;
      textSpan.textContent = expanded ? value : truncate(value, truncationLimit);
    });
  }

  if (isSensitive) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "🔒";
    toggle.className = "icon-btn eye";
    toggle.title = "Reveal";

    let visible = false;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      visible = !visible;
      textSpan.classList.remove("json-view");
      textSpan.textContent = visible ? String(value) : mask(String(value));
      toggle.textContent = visible ? "🔓" : "🔒";
      toggle.title = visible ? "Hide" : "Reveal";
    });

    actionsContainer.appendChild(toggle);
    return;
  }

  if (isJSON) {
    const jsonBtn = document.createElement("button");
    jsonBtn.type = "button";
    jsonBtn.textContent = "⟦⟧";
    jsonBtn.className = "icon-btn json-btn";
    jsonBtn.title = "Pretty JSON";

    let expanded = false;
    jsonBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      expanded = !expanded;
      if (expanded) {
        textSpan.textContent = formattedJSON;
        textSpan.classList.add("json-view");
        jsonBtn.title = "Collapse JSON";
      } else {
        textSpan.classList.remove("json-view");
        textSpan.textContent = truncate(formattedJSON, truncationLimit);
        jsonBtn.title = "Pretty JSON";
      }
    });

    actionsContainer.appendChild(jsonBtn);
  }
}

function renderTable(data, isDiff = false) {
  tbody.innerHTML = "";
  currentView = "table";
  if (savedList) savedList.classList.add("hidden");
  if (table) table.classList.remove("hidden");
  isDiffView = isDiff;

  if (table) {
    const headers = table.querySelectorAll("th");
    if (headers.length >= 3) {
      headers[0].textContent = "Key";
      headers[1].textContent = isDiff
        ? `Values (A: ${diffLeftTitle || "—"} · B: ${diffRightTitle || "—"})`
        : "Value";
      headers[2].textContent = isDiff ? "Type" : "Actions";
    }
  }

  const entries = Object.entries(data);
  const batchSize = 200;
  let index = 0;

  function renderBatch() {
    const fragment = document.createDocumentFragment();
    const slice = entries.slice(index, index + batchSize);

    slice.forEach(([key, raw]) => {
      const diffType = isDiff ? raw.type : null;

      const row = document.createElement("tr");
      if (diffType) row.classList.add(`diff-${diffType}`);

      const keyCell = document.createElement("td");
      keyCell.textContent = key;

      const valueCell = document.createElement("td");
      const actionsCell = document.createElement("td");

      if (isDiff) {
        const wrap = document.createElement("div");
        wrap.className = "diff-values";

        const appendLine = (label, v) => {
          const line = document.createElement("div");
          line.className = "diff-line";

          const labelEl = document.createElement("div");
          labelEl.className = "diff-label";
          labelEl.textContent = label;

          const lineValue = document.createElement("div");
          lineValue.className = "diff-value";
          const lineActions = document.createElement("div");
          lineActions.className = "diff-actions";

          if (v === undefined) {
            const missingWrap = document.createElement("div");
            missingWrap.className = "value-wrap";
            const missingText = document.createElement("span");
            missingText.className = "value-text";
            missingText.textContent = "—";
            missingWrap.appendChild(missingText);
            lineValue.appendChild(missingWrap);
          } else {
            buildValueActions(key, String(v), lineValue, lineActions);
          }

          line.appendChild(labelEl);
          line.appendChild(lineValue);
          line.appendChild(lineActions);
          wrap.appendChild(line);
        };

        appendLine("A", raw.aValue);
        appendLine("B", raw.bValue);
        valueCell.appendChild(wrap);

        const tag = document.createElement("span");
        tag.className = `diff-tag diff-tag-${diffType || "changed"}`;
        tag.textContent = diffType === "added" ? "ADD" : diffType === "removed" ? "DEL" : "CHG";
        actionsCell.appendChild(tag);
      } else {
        buildValueActions(key, raw, valueCell, actionsCell);
      }

      row.appendChild(keyCell);
      row.appendChild(valueCell);
      row.appendChild(actionsCell);
      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
    index += batchSize;
    if (index < entries.length) requestAnimationFrame(renderBatch);
  }

  renderBatch();
}

function buildDiff(aKeys, bKeys) {
  const a = aKeys || {};
  const b = bKeys || {};
  const diff = {};

  for (const key in b) {
    if (!(key in a)) {
      diff[key] = { aValue: undefined, bValue: b[key], type: "added" };
    } else if (a[key] !== b[key]) {
      diff[key] = { aValue: a[key], bValue: b[key], type: "changed" };
    }
  }

  for (const key in a) {
    if (!(key in b)) {
      diff[key] = { aValue: a[key], bValue: undefined, type: "removed" };
    }
  }

  return diff;
}

function runCompareForIds(collections, ids) {
  const left = (collections || []).find((c) => c.id === ids[0]);
  const right = (collections || []).find((c) => c.id === ids[1]);
  if (!left || !right) return;

  diffLeftTitle = left.title || "A";
  diffRightTitle = right.title || "B";

  const diff = buildDiff(left.keys, right.keys);
  if (Object.keys(diff).length === 0) {
    setStatus(`No differences found between A (${diffLeftTitle}) and B (${diffRightTitle}).`);
    return;
  }

  comparePickerOpen = false;
  compareSelectedIds = [];
  setCompareVisible(true, true);
  setPostLoadVisible(false);

  isDiffView = true;
  renderTable(diff, true);

  const counts = { added: 0, changed: 0, removed: 0 };
  Object.values(diff).forEach((item) => {
    if (!item || !item.type) return;
    if (counts[item.type] !== undefined) counts[item.type] += 1;
  });

  setStatus(
    `Comparing A (${diffLeftTitle}) → B (${diffRightTitle}) · ${Object.keys(diff).length} differences (added ${counts.added}, changed ${counts.changed}, removed ${counts.removed})`
  );
}

function renderComparePicker(collections) {
  if (!savedList) return;
  savedList.innerHTML = "";
  currentView = "list";
  if (table) table.classList.add("hidden");
  savedList.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  collections
    .slice()
    .sort((a, b) => ((b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)))
    .forEach((collection) => {
      const item = document.createElement("li");
      item.className = "saved-item";
      item.dataset.key = (collection.title || "").toLowerCase();

      const textWrap = document.createElement("div");

      const titleSpan = document.createElement("div");
      titleSpan.className = "saved-title";
      titleSpan.textContent = collection.title || "Collection";

      const count = Object.keys(collection.keys || {}).length;
      const metaSpan = document.createElement("div");
      metaSpan.className = "saved-meta";
      metaSpan.textContent = `${count} keys`;

      textWrap.appendChild(titleSpan);
      textWrap.appendChild(metaSpan);

      const actions = document.createElement("div");
      actions.className = "saved-actions";

      const checkbox = document.createElement("span");
      checkbox.className = "saved-delete";
      const idx = compareSelectedIds.indexOf(collection.id);
      checkbox.textContent = idx === 0 ? "①" : idx === 1 ? "②" : "☐";

      actions.appendChild(checkbox);

      item.appendChild(textWrap);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        const id = collection.id;
        if (!id) return;

        let next = compareSelectedIds.slice();
        const existingIndex = next.indexOf(id);
        if (existingIndex !== -1) {
          next.splice(existingIndex, 1);
        } else {
          if (next.length >= 2) next = next.slice(1);
          next.push(id);
        }

        compareSelectedIds = next;

        if (compareSelectedIds.length === 2) {
          runCompareForIds(collections, compareSelectedIds);
          return;
        }

        setStatus(`Selected ${compareSelectedIds.length}/2 collections (A then B)`);
        renderComparePicker(collections);
      });

      fragment.appendChild(item);
    });

  savedList.appendChild(fragment);
}

function renderCollectionsList(collections) {
  if (!savedList) return;
  savedList.innerHTML = "";
  currentView = "list";
  if (table) table.classList.add("hidden");
  savedList.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  collections.forEach((collection) => {
    const item = document.createElement("li");
    item.className = "saved-item";
    item.dataset.key = (collection.title || "").toLowerCase();

    const textWrap = document.createElement("div");

    const titleSpan = document.createElement("div");
    titleSpan.className = "saved-title";
    titleSpan.textContent = collection.title || "Collection";

    const count = Object.keys(collection.keys || {}).length;
    const metaSpan = document.createElement("div");
    metaSpan.className = "saved-meta";
    metaSpan.textContent = `${count} keys`;

    textWrap.appendChild(titleSpan);
    textWrap.appendChild(metaSpan);

    const actions = document.createElement("div");
    actions.className = "saved-actions";

    const del = document.createElement("span");
    del.className = "saved-delete";
    del.textContent = "🗑";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCollection(collection.id);
    });

    actions.appendChild(del);

    item.appendChild(textWrap);
    item.appendChild(actions);

    item.addEventListener("click", () => {
      if (!collection.keys || Object.keys(collection.keys).length === 0) {
        setStatus("This collection is empty.");
        return;
      }
      currentSecrets = collection.keys;
      currentPrefix = collection.title || "";
      currentLoadedCollectionId = collection.id || null;
      isDiffView = false;
      renderTable(currentSecrets);
      setPostLoadVisible(true);
      setCompareVisible(true, true);
      showSearch();
      setStatus(`Loaded ${Object.keys(currentSecrets).length} keys`);
    });

    fragment.appendChild(item);
  });

  savedList.appendChild(fragment);
}

function deleteCollection(id) {
  getCollections((collections) => {
    const next = collections.filter((item) => item.id !== id);
    STORAGE.setCollections(next, () => {
      if (next.length === 0) {
        resetUI();
        updateSavedAvailability();
        setStatus("No collections remaining.");
        return;
      }
      renderCollectionsList(next);
      updateSavedAvailability();
      setStatus("Collection deleted.");
    });
  });
}

function loadSecretsForContext(ctx, tabId, attempt = 0) {
  setStatus("Fetching keys...");
  chrome.runtime.sendMessage(
    { type: CONSTANTS.MESSAGE_TYPES.FETCH_PAGE_VALUES, host: ctx.host, dc: ctx.dc, prefix: ctx.prefix },
    (response) => {
      showLoader(false);
      if (chrome.runtime.lastError || !response) {
        setStatus("Unable to fetch key values. Reload the extension and refresh Consul.");
        return;
      }
      if (response.error) {
        const message = String(response.error || "");
        const shouldRetry =
          attempt === 0 &&
          tabId &&
          (message.toLowerCase().includes("acl not found") || message.toLowerCase().includes("no consul token captured"));
        if (shouldRetry) {
          showLoader(true);
          setStatus("Refreshing Consul session…");
          ensureTokenAvailable(tabId, ctx.dc).then(() => {
            loadSecretsForContext(ctx, tabId, attempt + 1);
          });
          return;
        }
        setStatus(message);
        return;
      }

      const normalized = normalizeKeys(response?.keys);
      if (!normalized || Object.keys(normalized).length === 0) {
        const skipped = Number(response?.skipped || 0);
        if (skipped > 0) {
          setStatus("No direct keys on this page (folders only).");
          return;
        }
        setStatus("No Consul keys found on this page.");
        return;
      }

      currentPrefix = response?.prefix || `/${ctx.prefix.replace(/\/$/, "")}`;
      currentSecrets = normalized;
      currentLoadedCollectionId = null;
      isDiffView = false;

      renderTable(currentSecrets);
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
    setStatus("Not a valid Consul KV page.");
    return;
  }

  const allowed = await hasConsulHostPermission(ctx.host);
  if (!allowed) {
    showLoader(false);
    showHostPermissionPrompt(ctx);
    return;
  }

  hideHostPermissionPrompt();
  await ensureTokenAvailable(tab.id, ctx.dc);
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
  if (tab?.id) await ensureTokenAvailable(tab.id, ctx.dc);
  loadSecretsForContext(ctx, tab?.id);
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

  getCollections((collections) => {
    const title = currentPrefix;
    const matches = (collections || []).filter((c) => (c.title || "") === title);
    const now = Date.now();

    let next = [];

    if (matches.length === 0) {
      const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(now);
      const collection = { id, title, createdAt: now, updatedAt: now, keys: currentSecrets };
      next = [...collections, collection];
    } else {
      const keep = matches.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      next = (collections || [])
        .filter((c) => (c.id || "") === (keep.id || "") || (c.title || "") !== title)
        .map((c) => {
          if ((c.id || "") !== (keep.id || "")) return c;
          return { ...c, title, updatedAt: now, keys: currentSecrets };
        });
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

  getCollections((collections) => {
    showLoader(false);
    if (!collections || collections.length === 0) {
      setStatus("No saved collections found.");
      loadSavedBtn.disabled = true;
      return;
    }

    renderCollectionsList(collections);
    setPostLoadVisible(false);
    setCompareVisible(true, collections.length >= 2);
    loadSavedBtn.disabled = false;
    setStatus(`Loaded ${collections.length} collections`);
  });
});

downloadBtn.addEventListener("click", () => {
  if (!currentSecrets || Object.keys(currentSecrets).length === 0) {
    setStatus("No keys to download.");
    return;
  }

  const envText = Object.entries(currentSecrets)
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
    .join("\n");

  const blob = new Blob([envText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "secrets.env";
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
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
    .join(";");
  const payload = pairs.length > 0 ? `${pairs};` : "";
  navigator.clipboard.writeText(payload);
  setStatus("Copied JetBrains format.");
});

compareBtn.addEventListener("click", () => {
  if (comparePickerOpen) {
    comparePickerOpen = false;
    compareSelectedIds = [];
    diffLeftTitle = "";
    diffRightTitle = "";
    setCompareVisible(true, true);

    if (currentView === "list") {
      getCollections((collections) => {
        renderCollectionsList(collections);
        setPostLoadVisible(false);
        setCompareVisible(true, (collections || []).length >= 2);
        showSearch();
        setStatus(`Loaded ${(collections || []).length} collections`);
      });
      return;
    }

    isDiffView = false;
    renderTable(currentSecrets, false);
    setPostLoadVisible(true);
    setCompareVisible(true, true);
    showSearch();
    setStatus("Compare cancelled.");
    return;
  }

  getCollections((collections) => {
    if (!collections || collections.length < 2) {
      setStatus("Need at least 2 saved collections to compare.");
      setCompareVisible(true, false);
      return;
    }

    comparePickerOpen = true;
    compareSelectedIds = [];
    setPostLoadVisible(false);
    setCompareVisible(true, true);
    renderComparePicker(collections);
    showSearch();
    setStatus("Select two collections (A then B) to compare.");
  });
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
