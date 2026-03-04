import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const src = {
  popupHtml: path.join(root, "src/popup/popup.html"),
  popupCss: path.join(root, "src/popup/styles.css"),
  popupJs: path.join(root, "src/popup/popup.js"),
  popupModules: path.join(root, "src/popup/modules"),
  shared: path.join(root, "src/shared"),
  background: path.join(root, "src/background/background.js"),
  assets: path.join(root, "assets"),
  manifest: path.join(root, "manifest.json")
};

function distPaths(target) {
  const base = path.join(root, "dist", target);
  return {
    root: base,
    popupHtml: path.join(base, "popup.html"),
    popupCss: path.join(base, "styles.css"),
    popupJs: path.join(base, "popup.js"),
    background: path.join(base, "background.js"),
    assets: path.join(base, "assets"),
    manifest: path.join(base, "manifest.json"),
    content: path.join(base, "content")
  };
}

async function rimraf(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch { }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyDir(srcDir, destDir) {
  await ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function rewritePopupHtml(html) {
  let out = String(html);
  out = out.replace(/href="styles\.css"/g, 'href="styles.css"');
  // Normalize asset paths to dist/assets
  out = out.replace(/src="\.\.\/\.\.\/assets\/logo\.png"/g, 'src="assets/logo.png"');
  out = out.replace(/src="\.\.\/\.\.\/assets\/logo\.svg"/g, 'src="assets/logo.svg"');
  // Remove all development script tags (shared/modules/popup in src layout)
  out = out.replace(/<script[^>]+src="\.\.\/shared\/constants\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="\.\.\/shared\/storage\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/env-utils\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/modals\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/table\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/token\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/collections\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/compare\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="modules\/upload\.js"[^>]*><\/script>/g, "");
  out = out.replace(/<script[^>]+src="popup\.js"[^>]*><\/script>/g, "");
  // Add single bundled popup.js reference before closing body
  out = out.replace(/<\/body>\s*<\/html>/i, `<script src="popup.js"></script></body></html>`);
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\n{2,}/g, "\n");
  return out;
}

function rewriteBackground(content) {
  let out = String(content);
  out = out.replace(/importScripts\(\s*"\.\.\/shared\//g, 'importScripts("shared/');
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\n{2,}/g, "\n");
  return out;
}

async function buildCss(dist) {
  const css = await fs.readFile(src.popupCss, "utf8");
  const result = await esbuild.transform(css, { loader: "css", minify: true });
  await ensureDir(path.dirname(dist.popupCss));
  await fs.writeFile(dist.popupCss, result.code, "utf8");
}

async function buildPopupBundle(dist, target) {
  // Use esbuild bundler to preserve module order via modules/index.js
  await ensureDir(path.dirname(dist.popupJs));
  await esbuild.build({
    entryPoints: [path.join(src.popupModules, "index.js")],
    bundle: true,
    minify: true,
    target: target === "firefox" ? "firefox115" : "chrome116",
    format: "iife",
    outfile: dist.popupJs
  });
}

async function buildBackgroundBundle(dist, target) {
  const order = [
    path.join(src.shared, "constants.js"),
    path.join(src.shared, "storage.js"),
    path.join(src.shared, "consul.js"),
    src.background
  ];
  let combined = "";
  for (const p of order) {
    let code = await fs.readFile(p, "utf8");
    // Strip importScripts calls in background to avoid double-inclusion
    if (p === src.background) {
      code = code.replace(/importScripts\([^)]*\);?/g, "");
    }
    combined += `\n${code}\n`;
  }
  const result = await esbuild.transform(combined, {
    loader: "js",
    minify: target !== "firefox", // Firefox background can be sensitive to minification
    target: target === "firefox" ? "firefox128" : "chrome116"
  });
  await fs.writeFile(dist.background, result.code, "utf8");
}

async function writePopupHtml(dist) {
  const html = await fs.readFile(src.popupHtml, "utf8");
  const out = rewritePopupHtml(html);
  await fs.writeFile(dist.popupHtml, out, "utf8");
}

async function writeManifest(dist, target) {
  const raw = await fs.readFile(src.manifest, "utf8");
  const m = JSON.parse(raw);

  if (target === "firefox") {
    const author = typeof m.author === "string"
      ? m.author
      : [m?.author?.name, m?.author?.email].filter(Boolean).join(" ");

    // Firefox MV3 can use optional_host_permissions just like Chrome
    const ff = {
      ...m,
      author,
      background: {
        scripts: ["background.js"]
      },
      action: {
        ...(m.action || {}),
        default_popup: "popup.html"
      },
      browser_specific_settings: {
        gecko: {
          id: "secretssanta@ninadsutrave",
          strict_min_version: "128.0"
        }
      },
      content_scripts: [
        {
          matches: ["https://*/ui/*", "http://*/ui/*"],
          js: ["content/consul-token-bridge.js"],
          run_at: "document_start"
        }
      ]
    };

    await fs.writeFile(dist.manifest, JSON.stringify(ff, null, 2), "utf8");
  } else {
    const distManifest = {
      ...m,
      background: { ...(m.background || {}), service_worker: "background.js" },
      action: { ...(m.action || {}), default_popup: "popup.html" }
    };
    await fs.writeFile(dist.manifest, JSON.stringify(distManifest, null, 2), "utf8");
  }
}

async function buildTarget(target) {
  const dist = distPaths(target);
  await rimraf(dist.root);
  await ensureDir(dist.root);
  await ensureDir(dist.assets);
  await ensureDir(dist.content);
  await copyDir(src.assets, dist.assets).catch(() => { });
  await buildCss(dist);
  await buildPopupBundle(dist, target);
  await buildBackgroundBundle(dist, target);
  await writePopupHtml(dist);
  await writeManifest(dist, target);
  if (target === "firefox") {
    // copy content script
    await fs.copyFile(path.join(root, "src/content/consul-token-bridge.js"), path.join(dist.content, "consul-token-bridge.js")).catch(() => { });
  }
  console.log(`Dist built at: ${dist.root}`);
}

async function main() {
  const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] || "chromium";
  if (target === "all") {
    await buildTarget("chromium");
    await buildTarget("firefox");
  } else {
    await buildTarget(target);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
