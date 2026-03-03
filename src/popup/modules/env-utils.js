globalThis.SECRETS_SANTA = globalThis.SECRETS_SANTA || {};

(() => {
  function isLikelyJSON(value) {
    if (typeof value !== "string") return false;
    let trimmed = value.trim();
    if (!trimmed) return false;
    // Direct object/array
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed !== null && typeof parsed === "object";
      } catch {
        return false;
      }
    }
    // Quoted JSON (string containing JSON)
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      try {
        const inner = JSON.parse(trimmed);
        const innerTrim = String(inner || "").trim();
        if (!innerTrim) return false;
        if (!(innerTrim.startsWith("{") || innerTrim.startsWith("["))) return false;
        const parsed = JSON.parse(innerTrim);
        return parsed !== null && typeof parsed === "object";
      } catch {
        return false;
      }
    }
    return false;
  }

  function getPrettyJSON(value) {
    try {
      let str = String(value || "");
      let trimmed = str.trim();
      if (!trimmed) return "";
      if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        try {
          const inner = JSON.parse(trimmed);
          trimmed = String(inner || "").trim();
        } catch {
          return "";
        }
      }
      let startObj = trimmed.indexOf("{");
      let startArr = trimmed.indexOf("[");
      let start = -1;
      if (startObj !== -1 && startArr !== -1) start = Math.min(startObj, startArr);
      else start = startObj !== -1 ? startObj : startArr;
      if (start === -1) return "";
      // Extract the first valid JSON segment using bracket matching
      let depth = 0;
      let inString = false;
      let stringQuote = "";
      let prevEscaped = false;
      const openChar = trimmed[start];
      const closeChar = openChar === "{" ? "}" : "]";
      for (let i = start; i < trimmed.length; i += 1) {
        const ch = trimmed[i];
        if (inString) {
          if (ch === "\\" && !prevEscaped) {
            prevEscaped = true;
          } else {
            if (ch === stringQuote && !prevEscaped) inString = false;
            prevEscaped = false;
          }
          continue;
        }
        if (ch === "\"" || ch === "'") {
          inString = true;
          stringQuote = ch;
          prevEscaped = false;
          continue;
        }
        if (ch === openChar) depth += 1;
        else if (ch === closeChar) {
          depth -= 1;
          if (depth === 0) {
            const segment = trimmed.slice(start, i + 1);
            const parsed = JSON.parse(segment);
            return JSON.stringify(parsed, null, 2);
          }
        }
      }
      return "";
    } catch {
      return "";
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
    isLikelyJSON,
    getPrettyJSON
  };
})();
