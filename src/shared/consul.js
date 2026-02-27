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

function buildKvValueUrl({ scheme = "https", host, dc, fullKey }) {
  const s = String(scheme || "https").replace(":", "");
  return `${s}://${host}/v1/kv/${encodeURI(fullKey)}?dc=${encodeURIComponent(dc)}`;
}

function buildKvListKeysUrl({ scheme = "https", host, dc, prefix }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const s = String(scheme || "https").replace(":", "");
  const base = p ? `/v1/kv/${encodeURI(p)}` : "/v1/kv/";
  return `${s}://${host}${base}?dc=${encodeURIComponent(dc)}&keys&separator=/`;
}

function buildKvPutUrl({ scheme = "https", host, dc, fullKey }) {
  const s = String(scheme || "https").replace(":", "");
  return `${s}://${host}/v1/kv/${encodeURI(fullKey)}?dc=${encodeURIComponent(dc)}`;
}

globalThis.SECRETS_SANTA.CONSUL = {
  decodeBase64Utf8,
  buildKvValueUrl,
  buildKvListKeysUrl,
  buildKvPutUrl
};
