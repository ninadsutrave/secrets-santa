/* Shared constants for both the popup (UI) and background (service worker).
 *
 * These are loaded in two very different JavaScript environments:
 *   - popup.html    → via a <script> tag, runs in the extension popup window
 *   - background.js → via importScripts(), runs in the MV3 service worker
 *
 * Because of this, we attach everything to globalThis.SECRETS_SANTA rather than
 * using ES module exports — both environments share this single namespace.
 *
 * Keep this file free of any logic. Constants only. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

globalThis.SECRETS_SANTA.CONSTANTS = {

  /* URL pattern passed to chrome.webRequest.onBeforeSendHeaders.
   * Matches any request whose path starts with /v1/ on any host and scheme.
   * Intentionally broad — the listener filters by X-Consul-Token header presence,
   * not by URL, so it works across arbitrary Consul host names and ports. */
  WEB_REQUEST_URLS: ["*://*/v1/*"],

  /* Header names used to carry the ACL token in Consul API requests.
   * We store both casing variants because lookups differ by context:
   *   - Headers.get() is case-insensitive, but plain object key access is not.
   * Consul also accepts Authorization: Bearer <token>, handled separately in the
   * fetch/XHR hooks inside consul-token-bridge.js. */
  HEADERS: {
    CONSUL_TOKEN_REQUEST: "X-Consul-Token",
    CONSUL_TOKEN_REQUEST_LOWER: "x-consul-token"
  },

  /* Consul KV API path prefix — all KV read/write operations go through /v1/kv/. */
  CONSUL: {
    KV_API_PREFIX: "/v1/kv/"
  },

  /* Keyboard shortcut command name as declared in manifest.json → "commands".
   * Matched in background.js chrome.commands.onCommand listener. */
  COMMANDS: {
    OPEN_UI: "open-secrets-santa"
  },

  /* Message type strings for chrome.runtime.sendMessage / onMessage.
   * The popup sends these to the background service worker; the background
   * dispatches on message.type in the onMessage listener.
   *
   *   FETCH_KEYS            → Validate + return the current token for a host.
   *   FETCH_VISIBLE_VALUES  → Fetch values for a caller-supplied list of leaf keys.
   *   FETCH_PAGE_VALUES     → List direct keys under a prefix, then fetch all values.
   *   SET_TOKEN             → Accept a token sourced by the content script or popup.
   *                           Background validates before storing (single write path).
   *   APPLY_ENV             → Bulk-write key/value pairs parsed from a .env file. */
  MESSAGE_TYPES: {
    FETCH_KEYS: "FETCH_KEYS",
    FETCH_VISIBLE_VALUES: "FETCH_VISIBLE_VALUES",
    FETCH_PAGE_VALUES: "FETCH_PAGE_VALUES",
    SET_TOKEN: "SET_TOKEN",
    APPLY_ENV: "APPLY_ENV"
  },

  UI: {
    /* Applied case-insensitively to key names (not values) to decide whether a row's
     * value is masked by default in the table view. Add more terms here if common
     * sensitive key naming patterns are missing. */
    SENSITIVE_KEY_REGEX: /(key|secret|token|password|pwd|credential|otp|cvv|ssn|pin|jwt|cookie|signature|bearer)/i,

    /* Short labels used in the Compare diff view to tag each changed row.
     * Changing these also changes what appears in JetBrains-format exports. */
    DIFF_LABELS: {
      ADDED: "ADD",
      REMOVED: "DEL",
      CHANGED: "CHG"
    }
  },

  /* Store links for the "Leave a Review" footer button in the popup.
   * The popup reads navigator.userAgent to pick the matching URL at runtime.
   * Update these if the extension is published to new stores. */
  LINKS: {
    CHROME_WEBSTORE: "https://chromewebstore.google.com/detail/secretssanta/mfppamekfnjjnpgfpjhdgomnpobadhfe",
    FIREFOX_ADDON: "https://addons.mozilla.org/en-GB/addon/secretssanta-consul-kv-manager",
    EDGE_ADDONS: "https://microsoftedge.microsoft.com/addons/detail/consul-kv-viewer-secret/pjkphinghfbmakbabohbaklnbplgmcbk"
  }
};
