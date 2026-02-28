globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  function isLikelyJSON(value) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed !== null && typeof parsed === "object";
    } catch {
      return false;
    }
  }

  function formatEnvValue(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    const needsQuoting = /[\s#;"']/g.test(str) || /\r|\n/.test(str) || isLikelyJSON(str);
    if (!needsQuoting) return str;
    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }

  function truncate(str, max = 80) {
    if (!str) return "";
    if (str.length <= max) return str;
    return str.slice(0, max) + "...";
  }

  function mask(value) {
    return "•".repeat(Math.min(String(value).length, 12));
  }

  function parseDotEnv(text) {
    const lines = String(text || "").split(/\r?\n/);
    const entries = [];
    let skipped = 0;
    lines.forEach((raw) => {
      const line = String(raw || "").trim();
      if (!line) return;
      if (line.startsWith("#")) return;
      const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
      const idx = withoutExport.indexOf("=");
      if (idx <= 0) {
        skipped += 1;
        return;
      }
      const key = withoutExport.slice(0, idx).trim();
      let value = withoutExport.slice(idx + 1);
      const isQuoted =
        (value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"));
      if (!isQuoted) {
        const hashIndex = value.indexOf(" #");
        if (hashIndex !== -1) value = value.slice(0, hashIndex);
        const hashIndex2 = value.indexOf("\t#");
        if (hashIndex2 !== -1) value = value.slice(0, hashIndex2);
      }
      value = value.trim();
      if (value.startsWith("\"") && value.endsWith("\"")) {
        value = value.slice(1, -1);
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"");
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (!key) {
        skipped += 1;
        return;
      }
      entries.push({ key, value });
    });
    return { entries, skipped };
  }

  function parseJetBrainsPairs(text) {
    const raw = String(text || "").trim();
    if (!raw) return { entries: [], skipped: 0 };
    const parts = raw.split(";");
    const entries = [];
    let skipped = 0;
    parts.forEach((p) => {
      const part = String(p || "").trim();
      if (!part) return;
      const idx = part.indexOf("=");
      if (idx <= 0) {
        skipped += 1;
        return;
      }
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1);
      if (!key) {
        skipped += 1;
        return;
      }
      entries.push({ key, value });
    });
    return { entries, skipped };
  }

  globalThis.SECRETS_SANTA.ENV = {
    formatEnvValue,
    truncate,
    mask,
    parseDotEnv,
    parseJetBrainsPairs,
    isLikelyJSON
  };
})();
