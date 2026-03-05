/* Storage helpers used by both popup and background. */
(globalThis as any).SECRETS_SANTA = (globalThis as any).SECRETS_SANTA || {};
const C_storage: any = (globalThis as any).chrome || (window as any).chrome;

const KEYS = {
  TOKEN: "consulTokenCaptured",
  TOKEN_BY_HOST: "consulTokenByHost",
  COLLECTIONS: "savedCollections",
  DARK_MODE: "darkMode"
};

function getToken(callback: (token: string) => void) {
  C_storage.storage.local.get([KEYS.TOKEN], (res: any) => callback(res?.[KEYS.TOKEN] || ""));
}

function setToken(token: string, callback: () => void = () => {}) {
  C_storage.storage.local.set({ [KEYS.TOKEN]: token }, callback);
}

function clearToken(callback: () => void = () => {}) {
  C_storage.storage.local.set({ [KEYS.TOKEN]: "" }, callback);
}

function normalizeHost(host: string) {
  return String(host || "").trim().toLowerCase();
}

function getTokenForHost(host: string, callback: (token: string) => void) {
  const h = normalizeHost(host);
  C_storage.storage.local.get([KEYS.TOKEN_BY_HOST, KEYS.TOKEN], (res: any) => {
    const map = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    if (h && typeof map[h] === "string" && map[h]) {
      callback(map[h]);
      return;
    }
    callback(res?.[KEYS.TOKEN] || "");
  });
}

function setTokenForHost(host: string, token: string, callback: () => void = () => {}) {
  const h = normalizeHost(host);
  C_storage.storage.local.get([KEYS.TOKEN_BY_HOST], (res: any) => {
    const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    const next = { ...prev };
    if (h) (next as any)[h] = String(token || "");
    C_storage.storage.local.set({ [KEYS.TOKEN_BY_HOST]: next }, callback);
  });
}

function clearTokenForHost(host: string, callback: () => void = () => {}) {
  const h = normalizeHost(host);
  if (!h) {
    callback();
    return;
  }
  C_storage.storage.local.get([KEYS.TOKEN_BY_HOST], (res: any) => {
    const prev = (res?.[KEYS.TOKEN_BY_HOST] && typeof res[KEYS.TOKEN_BY_HOST] === "object") ? res[KEYS.TOKEN_BY_HOST] : {};
    if (!(prev as any)[h]) {
      callback();
      return;
    }
    const next = { ...prev };
    delete (next as any)[h];
    C_storage.storage.local.set({ [KEYS.TOKEN_BY_HOST]: next }, callback);
  });
}

function getCollections(callback: (collections: any[]) => void) {
  C_storage.storage.local.get([KEYS.COLLECTIONS], (res: any) => {
    const collections = Array.isArray(res?.[KEYS.COLLECTIONS]) ? res[KEYS.COLLECTIONS] : [];
    callback(collections);
  });
}

function setCollections(collections: any[], callback: () => void = () => {}) {
  C_storage.storage.local.set({ [KEYS.COLLECTIONS]: collections }, callback);
}

function getDarkMode(callback: (isDark: boolean) => void) {
  C_storage.storage.local.get([KEYS.DARK_MODE], (res: any) => callback(Boolean(res?.[KEYS.DARK_MODE])));
}

function setDarkMode(isDark: boolean, callback: () => void = () => {}) {
  C_storage.storage.local.set({ [KEYS.DARK_MODE]: Boolean(isDark) }, callback);
}

(globalThis as any).SECRETS_SANTA.STORAGE = {
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
