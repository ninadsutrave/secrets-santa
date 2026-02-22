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

function buildKvValueUrl({ host, dc, fullKey }) {
  return `https://${host}/v1/kv/${encodeURI(fullKey)}?dc=${encodeURIComponent(dc)}`;
}

function buildKvListKeysUrl({ host, dc, prefix }) {
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `https://${host}/v1/kv/${encodeURI(p)}?dc=${encodeURIComponent(dc)}&keys&separator=/`;
}

globalThis.SECRETS_SANTA.CONSUL = {
  decodeBase64Utf8,
  buildKvValueUrl,
  buildKvListKeysUrl
};

