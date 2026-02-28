/* Storage helpers used by both popup and background. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

const KEYS = {
  TOKEN: "consulTokenCaptured",
  TOKEN_BY_HOST: "consulTokenByHost",
  COLLECTIONS: "savedCollections",
  DARK_MODE: "darkMode"
};

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
  chrome.storage.local.get([KEYS.TOKEN_BY_HOST, KEYS.TOKEN], (res) => {
    const map = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    if (h && typeof map[h] === "string" && map[h]) {
      callback(map[h]);
      return;
    }
    callback(res?.[KEYS.TOKEN] || "");
  });
}

function setTokenForHost(host, token, callback = () => {}) {
  const h = normalizeHost(host);
  chrome.storage.local.get([KEYS.TOKEN_BY_HOST], (res) => {
    const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    const next = { ...prev };
    if (h) next[h] = String(token || "");
    chrome.storage.local.set({ [KEYS.TOKEN_BY_HOST]: next }, callback);
  });
}

function clearTokenForHost(host, callback = () => {}) {
  const h = normalizeHost(host);
  if (!h) {
    callback();
    return;
  }
  chrome.storage.local.get([KEYS.TOKEN_BY_HOST], (res) => {
    const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    if (!prev[h]) {
      callback();
      return;
    }
    const next = { ...prev };
    delete next[h];
    chrome.storage.local.set({ [KEYS.TOKEN_BY_HOST]: next }, callback);
  });
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
  setDarkMode
};
