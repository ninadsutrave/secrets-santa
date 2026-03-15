/* Consul KV API helpers used by the background service worker.
 *
 * All URL-building functions follow two rules:
 *   1. Path segments are encoded with encodeURIComponent (not encodeURI) so that
 *      key names containing ?, #, &, = and similar characters don't corrupt the URL.
 *   2. The ?dc= parameter is only appended when a datacenter is explicitly provided.
 *      An empty ?dc= is invalid and causes errors on some Consul versions.
 *
 * Consul KV API reference:
 *   GET /v1/kv/<key>                       → fetch a single value (base64 in "Value")
 *   GET /v1/kv/<prefix>?keys&separator=/   → list direct children (keys + folder names)
 *   PUT /v1/kv/<key>                       → create or update a value (raw string body) */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

/* Decodes a base64 string returned by the Consul KV API as a proper UTF-8 string.
 * Consul always wraps KV values in base64 in the "Value" field of its JSON response.
 * We decode via Uint8Array + TextDecoder rather than atob() alone so that multi-byte
 * UTF-8 characters (emoji, CJK, accented letters) round-trip correctly. */
function decodeBase64Utf8(b64) {
  if (!b64) return "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/* Encodes each segment of a slash-separated path with encodeURIComponent while
 * preserving the slash separators between segments.
 *
 * Why not encodeURI?
 *   encodeURI leaves ?, #, &, = unencoded because they are valid URL characters.
 *   But a Consul key name can legally contain those characters (e.g. "app/db?env=dev"),
 *   and leaving them unencoded would corrupt the query string. Per-segment encoding
 *   handles this while keeping the path separators intact. */
function encodePathSegments(path) {
  return String(path || "").split("/").map((s) => (s ? encodeURIComponent(s) : "")).join("/");
}

/* Builds the URL for fetching a single KV value (HTTP GET).
 * The response is a JSON array with one entry; the value lives in entry.Value as base64.
 * Use decodeBase64Utf8() to convert it to a plain string.
 * Example: https://consul.host/v1/kv/app/config/DB_URL?dc=dc1 */
function buildKvValueUrl({ scheme = "https", host, dc, fullKey }) {
  const s = String(scheme || "https").replace(":", "");
  const encodedKey = encodePathSegments(fullKey);
  // Only append ?dc= when a datacenter is specified; empty dc= is invalid and confuses some Consul versions.
  const dcParam = dc ? `?dc=${encodeURIComponent(dc)}` : "";
  return `${s}://${host}/v1/kv/${encodedKey}${dcParam}`;
}

/* Builds the URL for listing direct children under a prefix (HTTP GET).
 * Consul's ?keys&separator=/ query returns a flat string array:
 *   - Strings ending with "/"  → sub-folder names (counted but not fetched)
 *   - Strings not ending "/"   → leaf key names (fetched individually for their values)
 * Example: https://consul.host/v1/kv/app/config/?keys&separator=%2F&dc=dc1 */
function buildKvListKeysUrl({ scheme = "https", host, dc, prefix }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const s = String(scheme || "https").replace(":", "");
  const encodedP = p ? encodePathSegments(p) : "";
  const base = encodedP ? `/v1/kv/${encodedP}` : "/v1/kv/";
  const sep = encodeURIComponent("/");
  // dc is an additional query param here (not the first), so use & not ?.
  const dcParam = dc ? `&dc=${encodeURIComponent(dc)}` : "";
  return `${s}://${host}${base}?keys${dcParam}&separator=${sep}`;
}

/* Builds the URL for creating or updating a single KV value (HTTP PUT).
 * The request body is the raw string value — no JSON encoding needed.
 * Example: https://consul.host/v1/kv/app/config/DB_URL?dc=dc1 */
function buildKvPutUrl({ scheme = "https", host, dc, fullKey }) {
  const s = String(scheme || "https").replace(":", "");
  const encodedKey = encodePathSegments(fullKey);
  const dcParam = dc ? `?dc=${encodeURIComponent(dc)}` : "";
  return `${s}://${host}/v1/kv/${encodedKey}${dcParam}`;
}

globalThis.SECRETS_SANTA.CONSUL = {
  decodeBase64Utf8,
  encodePathSegments,
  buildKvValueUrl,
  buildKvListKeysUrl,
  buildKvPutUrl
};
