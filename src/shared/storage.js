/* Storage helpers used by both popup and background. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

const KEYS = {
  TOKEN: "consulTokenCaptured",
  TOKEN_BY_HOST: "consulTokenByHost",
  COLLECTIONS: "savedCollections",
  DARK_MODE: "darkMode"
};

/* Prefer chrome.storage.session (Chromium 102+) — never written to disk, cleared on browser close.
   Fall back to chrome.storage.local on Firefox MV3 or older Chrome where session is unavailable. */
function getTokenStore() {
  try {
    if (typeof chrome.storage.session !== "undefined") return chrome.storage.session;
  } catch { }
  return chrome.storage.local;
}

function getToken(callback) {
  chrome.storage.local.get([KEYS.TOKEN], (res) => callback(res?.[KEYS.TOKEN] || ""));
}

function setToken(token, callback = () => {}) {
  chrome.storage.local.set({ [KEYS.TOKEN]: token }, callback);
}

function clearToken(callback = () => {}) {
  chrome.storage.local.set({ [KEYS.TOKEN]: "" }, callback);
}

function normalizeHost(host) {
  return String(host || "").trim().toLowerCase();
}

function getTokenForHost(host, callback) {
  const h = normalizeHost(host);
  const store = getTokenStore();
  store.get([KEYS.TOKEN_BY_HOST, KEYS.TOKEN], (res) => {
    const map = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    if (h && typeof map[h] === "string" && map[h]) {
      callback(map[h]);
      return;
    }
    // Migration path: if session store found nothing, also check local for tokens written by the previous version.
    if (store !== chrome.storage.local) {
      chrome.storage.local.get([KEYS.TOKEN_BY_HOST, KEYS.TOKEN], (localRes) => {
        const localMap = (localRes?.[KEYS.TOKEN_BY_HOST] && typeof localRes[KEYS.TOKEN_BY_HOST] === "object") ? localRes[KEYS.TOKEN_BY_HOST] : {};
        if (h && typeof localMap[h] === "string" && localMap[h]) {
          callback(localMap[h]);
          return;
        }
        callback(localRes?.[KEYS.TOKEN] || "");
      });
      return;
    }
    callback(res?.[KEYS.TOKEN] || "");
  });
}

function setTokenForHost(host, token, callback = () => {}) {
  const h = normalizeHost(host);
  const store = getTokenStore();
  store.get([KEYS.TOKEN_BY_HOST], (res) => {
    const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    const next = { ...prev };
    if (h) next[h] = String(token || "");
    store.set({ [KEYS.TOKEN_BY_HOST]: next }, callback);
  });
}

function clearTokenForHost(host, callback = () => {}) {
  const h = normalizeHost(host);
  if (!h) {
    callback();
    return;
  }
  // Clear from a single storage area, then call next().
  const clearFrom = (s, next) => {
    s.get([KEYS.TOKEN_BY_HOST], (res) => {
      const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
      if (!prev[h]) { next(); return; }
      const updated = { ...prev };
      delete updated[h];
      s.set({ [KEYS.TOKEN_BY_HOST]: updated }, next);
    });
  };
  // Clear from both session and local so old tokens stored by the previous version are also removed.
  const store = getTokenStore();
  if (store !== chrome.storage.local) {
    clearFrom(store, () => clearFrom(chrome.storage.local, callback));
  } else {
    clearFrom(store, callback);
  }
}

function getCollections(callback) {
  chrome.storage.local.get([KEYS.COLLECTIONS], (res) => {
    const collections = Array.isArray(res?.[KEYS.COLLECTIONS]) ? res[KEYS.COLLECTIONS] : [];
    callback(collections);
  });
}

function setCollections(collections, callback = () => {}) {
  chrome.storage.local.set({ [KEYS.COLLECTIONS]: collections }, callback);
}

function getDarkMode(callback) {
  chrome.storage.local.get([KEYS.DARK_MODE], (res) => callback(Boolean(res?.[KEYS.DARK_MODE])));
}

function setDarkMode(isDark, callback = () => {}) {
  chrome.storage.local.set({ [KEYS.DARK_MODE]: Boolean(isDark) }, callback);
}

globalThis.SECRETS_SANTA.STORAGE = {
  getToken,
  setToken,
  clearToken,
  getTokenForHost,
  setTokenForHost,
  clearTokenForHost,
  getCollections,
  setCollections,
  getDarkMode,
  setDarkMode,
  getTokenStore
};
