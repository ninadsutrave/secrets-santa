# Contributing to SecretsSanta

Thank you for taking the time to contribute! This guide covers everything you need to go from a fresh clone to a merged PR.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Build Targets](#build-targets)
5. [CI Pipeline](#ci-pipeline)
6. [Token Capture Architecture](#token-capture-architecture)
7. [Browser Differences (Chromium vs Firefox)](#browser-differences-chromium-vs-firefox)
8. [Testing](#testing)

---

## Prerequisites

- **Node.js 18+** and **npm**
- A Consul instance to test against (see [Testing](#testing) for a one-command local setup)

---

## Project Structure

```
SecretsSanta/
├── src/
│   ├── background/
│   │   └── background.js            # MV3 service worker: token capture, KV API, message routing
│   ├── content/
│   │   └── consul-token-bridge.js   # Injected into MAIN world: wraps fetch/XHR, scans storage/IDB
│   ├── popup/
│   │   ├── popup.html               # Extension popup HTML
│   │   ├── popup.js                 # Popup entry point: URL parsing, load flow, UI wiring
│   │   ├── popup.css                # Popup styles
│   │   └── modules/
│   │       ├── token.js             # Token capture orchestration (ensureTokenAvailable)
│   │       ├── table.js             # KV table rendering, inline edit, row actions
│   │       ├── collections.js       # Saved collection list rendering and management
│   │       ├── compare.js           # Snapshot diff (Add/Delete/Change view)
│   │       ├── upload.js            # .env / JetBrains bulk upload flow
│   │       ├── env-utils.js         # .env parsing and formatting helpers
│   │       ├── modals.js            # JSON viewer modal
│   │       └── index.js             # Module barrel — exports all modules to globalThis
│   └── shared/
│       ├── constants.js             # Shared constants (URLs, headers, message types, regex)
│       ├── storage.js               # chrome.storage.session/local wrappers
│       └── consul.js                # Consul API URL builders and base64 decoder
├── assets/                          # Icons and screenshots
├── scripts/
│   └── build.mjs                    # esbuild script: bundles src/ into dist/chromium/ or dist/firefox/
├── manifest.json                    # MV3 manifest (Chromium)
├── .github/
│   ├── workflows/ci.yml             # CI pipeline (lint → build → release)
│   ├── dependabot.yml               # Auto-update GitHub Actions and npm devDeps
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
├── docs/                            # Architecture, changelog, security, reviewer notes
└── package.json
```

### Key architectural rules

- **`background.js` is the single source of truth for token storage.** The popup never writes tokens directly — it sends a `SET_TOKEN` message and the background validates + stores atomically.
- **`consul-token-bridge.js` is not listed in `manifest.json` as a content script.** It is dynamically injected into the `MAIN` world by `token.js` via `chrome.scripting.executeScript`. This is required so it can wrap `window.fetch` and `XMLHttpRequest` inside the page's own JavaScript context.
- **`shared/` files are loaded by both the popup and the background.** They use `globalThis.SECRETS_SANTA` as a shared namespace to work in both a popup window and a service worker.

---

## Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/secrets-santa.git
cd secrets-santa

# 2. Install exact dependencies from the lockfile
npm ci

# 3. Create a branch
git checkout -b fix/my-fix        # for bug fixes
git checkout -b feat/my-feature   # for new features

# 4. Build both targets
npm run build:all
# Output: dist/chromium/ and dist/firefox/

# 5. Load in your browser
#    Chrome/Edge/Brave:  chrome://extensions → Developer mode → Load unpacked → dist/chromium/
#    Firefox:            about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json

# 6. After making changes in src/, rebuild and reload
npm run build:all
# Chrome: click the refresh icon on the extension card in chrome://extensions

# 7. Lint before pushing
npm run lint          # check
npm run lint:fix      # auto-fix safe issues

# 8. Push and open a PR
git push origin fix/my-fix
```

---

## Build Targets

The build script (`scripts/build.mjs`) uses **esbuild** to bundle each JS context into a single file per target, then copies static assets and writes a target-specific `manifest.json`.

| Command | Output | Notes |
|---|---|---|
| `npm run build:chromium` | `dist/chromium/` | Standard MV3 build |
| `npm run build:firefox` | `dist/firefox/` | Injects `browser_specific_settings.gecko.id` into manifest (required by AMO) |
| `npm run build:all` | Both targets | Run before every commit |
| `npm run zip` | `SecretsSanta-{chromium,firefox}.zip` | Store submission packages |
| `npm run xpi:firefox` | `SecretsSanta-firefox.xpi` | For testing on Firefox Dev/Nightly |

---

## CI Pipeline

The GitHub Actions pipeline (`ci.yml`) runs three jobs in sequence:

```
lint ──► build ──► release  (tag pushes only)
```

| Job | Trigger | What it does | Token permissions |
|---|---|---|---|
| **Lint** | All PRs + master pushes | `npm run lint` | `contents: read` |
| **Build** | After Lint passes | `npm run build:all`, manifest version guard on tags, artifact upload | `contents: read` |
| **Release** | Tag pushes only (`v*`) | Downloads build artifacts, creates GitHub Release with zips | `contents: write` |

### Why lint is a separate job

Lint failures appear in ~20s without waiting for a full build. The `Lint` job name is what you add in branch protection as a required status check — any PR with ESLint errors cannot be merged to master.

### Cutting a release

```bash
# 1. Bump "version" in manifest.json
# 2. Commit
git commit -am "chore: bump version to 1.2.0"
# 3. Tag and push — CI handles the rest
git tag v1.2.0 && git push origin master v1.2.0
```

The CI verifies the manifest version matches the tag, builds both targets, and creates the GitHub Release automatically.

---

## Token Capture Architecture

Understanding this is essential before touching `background.js`, `consul-token-bridge.js`, or `token.js`.

SecretsSanta captures Consul tokens using a **layered passive approach**. Each layer runs independently; the first to produce a valid token wins. No user interaction is required in the typical case.

### Capture layers (in order of preference)

| # | Layer | File | Mechanism |
|---|---|---|---|
| 1 | `webRequest.onBeforeSendHeaders` | `background.js` | Passively intercepts `X-Consul-Token` from every Consul API request. Runs before the request leaves the browser. Zero user interaction. |
| 2 | `fetch` / `XHR` hooks (MAIN world) | `consul-token-bridge.js` | Wraps `window.fetch` and `XMLHttpRequest` in the page context so tokens sent by the Consul SPA are captured immediately. |
| 3 | Priming fetches (`SS_PRIME`) | `consul-token-bridge.js` | Fires harmless `/v1/agent/self` and KV list requests in the page context so layers 1–2 have traffic to intercept right away. |
| 4 | `localStorage` / `sessionStorage` scan | `token.js` (executeScript) | Reads storage directly in the page context; validates the candidate via `/v1/acl/token/self`. |
| 5 | `IndexedDB` scan | `token.js` + `consul-token-bridge.js` | Consul UI 1.16+ stores the ACL token in IDB. Guarded by `indexedDB.databases()` availability (Chrome 72+, Firefox 126+). |
| 6 | `chrome.cookies` API | `background.js` | Reads Consul-domain cookies from the background SW. Works even when the tab is inactive or the content script failed to inject. |

### Token validation — tri-state result

`validateToken()` returns **`"valid"` / `"invalid"` / `"unreachable"`**. Callers must distinguish all three:

- **`"valid"`** → token confirmed good. Store and use it.
- **`"invalid"`** → server explicitly rejected it (HTTP 401/403 + `acl not found` in the body). Discard the token.
- **`"unreachable"`** → network/CORS error. Token validity is unknown. **Do not clear it** — the user may still be able to reach the server.

### Storage strategy

- **Chromium 102+**: `chrome.storage.session` — never written to disk, cleared when the browser closes.
- **Firefox / older Chrome**: falls back to `chrome.storage.local`.
- `getTokenForHost` reads session first, then falls back to local (migration path for tokens stored by older versions of the extension).
- `clearTokenForHost` clears from **both** stores to ensure full cleanup.

### Message flow (popup → background)

```
popup.js
  └── TOKEN.ensureTokenAvailable(tabId, host, dc, prefix)
        ├── installTokenSniffer(tabId)        → injects consul-token-bridge.js into MAIN world
        ├── primeTokenCaptureOnTab()           → SS_PRIME: triggers priming fetches
        ├── poll fetchTokenFromBackground() for 2s  → waiting for webRequest/hook to fire
        ├── SS_SCAN                            → re-runs storage/IDB/cookie scan
        └── captureAndStoreTokenFromConsulStorage()  → direct IDB+storage read (last resort)
              └── SET_TOKEN → background.js: validates token, stores it
```

---

## Browser Differences (Chromium vs Firefox)

| Area | Chromium | Firefox |
|---|---|---|
| Manifest | MV3 | MV3 |
| `chrome.storage.session` | ✅ Available (102+) | ❌ Not available — falls back to `chrome.storage.local` |
| `webRequest` `extraHeaders` | Required for some sensitive headers | Not required — excluded from the listener spec to avoid Firefox warnings |
| `chrome.action.openPopup()` | ✅ Works in service worker | ❌ Requires `browser.browserAction.openPopup()` polyfill |
| `manifest.json` | Shipped as-is | Build injects `browser_specific_settings.gecko.id` (required for AMO signing) |
| Content script injection | `chrome.scripting.executeScript` (MAIN world) | Same — works identically |

---

## Testing

Since this is a browser extension, testing is primarily manual.

### Local Consul dev agent

```bash
# macOS
brew install consul

# All platforms — starts Consul UI at http://localhost:8500
consul agent -dev

# Seed test keys
consul kv put app/dev/DB_URL    "postgres://localhost/mydb"
consul kv put app/dev/API_KEY   "super-secret-key"
consul kv put app/prod/DB_URL   "postgres://prod.host/mydb"
```

Navigate to `http://localhost:8500/ui/dc1/kv/app/dev/` and open the extension.

### Test checklist before opening a PR

- [ ] Keys load correctly from a Consul KV page
- [ ] Token capture works without manual entry (log in to Consul UI → open popup)
- [ ] Edit a value inline and verify it saves in Consul
- [ ] Upload a `.env` file and verify keys appear in Consul
- [ ] Save a snapshot and use Compare on two paths
- [ ] Export as `.env` and as JetBrains format
- [ ] Dark mode toggle persists across popup open/close
- [ ] Tested in at least one browser (Chrome, Firefox, Edge, or Brave)
