/* Storage helpers used by both popup and background. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

const KEYS = {
  TOKEN: "consulTokenCaptured",
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
  getCollections,
  setCollections,
  getDarkMode,
  setDarkMode
};
