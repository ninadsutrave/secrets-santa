/* Shared constants for both the popup (UI) and background (service worker). */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

globalThis.SECRETS_SANTA.CONSTANTS = {
  WEB_REQUEST_URLS: ["*://*/v1/*"],

  HEADERS: {
    CONSUL_TOKEN_REQUEST: "X-Consul-Token",
    CONSUL_TOKEN_REQUEST_LOWER: "x-consul-token"
  },

  CONSUL: {
    KV_API_PREFIX: "/v1/kv/"
  },

  COMMANDS: {
    OPEN_UI: "open-secrets-santa"
  },

  MESSAGE_TYPES: {
    FETCH_KEYS: "FETCH_KEYS",
    FETCH_VISIBLE_VALUES: "FETCH_VISIBLE_VALUES",
    FETCH_PAGE_VALUES: "FETCH_PAGE_VALUES",
    SET_TOKEN: "SET_TOKEN",
    APPLY_ENV: "APPLY_ENV"
  },

  UI: {
    SENSITIVE_KEY_REGEX: /(key|secret|token|password|pwd|credential|otp|cvv|ssn|pin|jwt|cookie|signature|bearer)/i
  }
};
