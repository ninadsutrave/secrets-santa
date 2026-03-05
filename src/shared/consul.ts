/* Consul KV helpers used by the background service worker. */
(globalThis as any).SECRETS_SANTA = (globalThis as any).SECRETS_SANTA || {};

function decodeBase64Utf8(b64: string) {
  if (!b64) return "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function buildKvValueUrl({ scheme = "https", host, dc, fullKey }: { scheme?: string; host: string; dc: string; fullKey: string }) {
  const s = String(scheme || "https").replace(":", "");
  return `${s}://${host}/v1/kv/${encodeURI(fullKey)}?dc=${encodeURIComponent(dc)}`;
}

function buildKvListKeysUrl({ scheme = "https", host, dc, prefix }: { scheme?: string; host: string; dc: string; prefix: string }) {
  const p = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const s = String(scheme || "https").replace(":", "");
  const base = p ? `/v1/kv/${encodeURI(p)}` : "/v1/kv/";
  const sep = encodeURIComponent("/");
  return `${s}://${host}${base}?keys&dc=${encodeURIComponent(dc)}&separator=${sep}`;
}

function buildKvPutUrl({ scheme = "https", host, dc, fullKey }: { scheme?: string; host: string; dc: string; fullKey: string }) {
  const s = String(scheme || "https").replace(":", "");
  return `${s}://${host}/v1/kv/${encodeURI(fullKey)}?dc=${encodeURIComponent(dc)}`;
}

(globalThis as any).SECRETS_SANTA.CONSUL = {
  decodeBase64Utf8,
  buildKvValueUrl,
  buildKvListKeysUrl,
  buildKvPutUrl
};
