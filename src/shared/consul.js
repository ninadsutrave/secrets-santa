/* Consul KV helpers used by the background service worker. */

globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

function decodeBase64Utf8(b64) {
  if (!b64) return "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/* Encodes each path segment with encodeURIComponent while preserving slash separators.
   This correctly handles segments containing ?, #, &, = and other special characters
   that encodeURI would leave unencoded, breaking the query string. */
function encodePathSegments(path) {
  return String(path || "").split("/").map((s) => (s ? encodeURIComponent(s) : "")).join("/");
}

function buildKvValueUrl({ scheme = "https", host, dc, fullKey }) {
  const s = String(scheme || "https").replace(":", "");
  const encodedKey = encodePathSegments(fullKey);
  // Only append ?dc= when a datacenter is specified; empty dc= is invalid and confuses some Consul versions.
  const dcParam = dc ? `?dc=${encodeURIComponent(dc)}` : "";
  return `${s}://${host}/v1/kv/${encodedKey}${dcParam}`;
}

function buildKvListKeysUrl({ scheme = "https", host, dc, prefix }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const s = String(scheme || "https").replace(":", "");
  const encodedP = p ? encodePathSegments(p) : "";
  const base = encodedP ? `/v1/kv/${encodedP}` : "/v1/kv/";
  const sep = encodeURIComponent("/");
  const dcParam = dc ? `&dc=${encodeURIComponent(dc)}` : "";
  return `${s}://${host}${base}?keys${dcParam}&separator=${sep}`;
}

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
