<p align="left"><img src="assets/logo.png" alt="SecretsSanta logo" width="120" /></p>

# 🎅 SecretsSanta

SecretsSanta is a browser extension that helps developers fetch, view, copy, and compare secrets stored in Consul KV — safely and effortlessly, directly from the Consul UI.

This is an open source initiative designed to make Consul KV management smoother for everyone.

## ✨ Features

- **Load & View**: Fetches keys/values from your current Consul KV page.
- **Auto-Auth**: Captures your Consul token automatically — no manual copy-paste, no config.
- **Secure**: Values are masked by default. Copying always yields the raw value.
- **Edit & Upload**: Edit values inline or upload bulk keys via `.env` files or JetBrains format.
- **Compare**: Save snapshots of KV paths and diff them (e.g. Stage vs Prod).
- **Export**: Download keys as `.env` or copy in JetBrains format.
- **Modern UI**: Clean, responsive interface with a dark mode that respects your eyes.

## 🌐 Install from the Store

SecretsSanta works on all Chromium-based browsers and Firefox.

| Browser | Link |
|---|---|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/secretssanta/mfppamekfnjjnpgfpjhdgomnpobadhfe) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/consul-kv-viewer-secret/pjkphinghfbmakbabohbaklnbplgmcbk) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/en-GB/addon/secretssanta-consul-kv-manager) |
| **Brave** | Compatible via the Chrome Web Store link above |

## 🔗 Project Links

- GitHub: https://github.com/ninadsutrave/secrets-santa

## 🚀 Getting Started

### Prerequisites

- **Git** to clone the repository
- **Node.js 18+** for the build step (`npm run build`)

### Installation (Local Build)

1. Clone the repository:
   ```bash
   git clone https://github.com/ninadsutrave/secrets-santa.git
   cd secrets-santa
   ```

2. Install build tooling:
   ```bash
   npm ci
   ```

3. Build the extension:
   ```bash
   npm run build:all
   ```
   This produces `dist/chromium/` and `dist/firefox/`.

4. Load in your browser:

   **Chrome / Brave / Edge**
   - Open `chrome://extensions` (or `edge://extensions`)
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** → select `dist/chromium/`

   **Firefox**
   - Open `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on…**
   - Select `dist/firefox/manifest.json`

## 📖 Usage

1. **Navigate** to a Consul KV path (e.g. `http://consul.local/ui/dc1/kv/my-service/`).
2. **Open SecretsSanta** — click the toolbar icon or press `Ctrl+Shift+S` / `Cmd+Shift+S`.
3. **Grant permission** for the Consul host when prompted (one-time, per host).
4. **Load Secrets** — the extension captures your session token automatically if you're logged in.
5. **Manage your keys**:
   - `⧉` — copy value
   - `✎` — edit inline
   - `⟦⟧` — view / copy pretty-printed JSON
   - **Upload Key Values** — bulk create/update from a `.env` or JetBrains file
   - **Save** — snapshot the current view for later comparison

## 🖼️ Preview

<table>
  <tr>
    <td align="center">
      <img src="assets/screenshot1.png" alt="KV table view (mask, copy, edit, JSON)" width="340" /><br/>
      <sub>KV table view — mask, copy, edit, JSON</sub>
    </td>
    <td align="center">
      <img src="assets/screenshot2.png" alt="Compare stage vs production key values" width="340" /><br/>
      <sub>Compare stage vs production key values</sub>
    </td>
  </tr>
</table>

## 🔑 Token Capture Architecture

SecretsSanta never asks you to paste a token. It uses a layered passive-capture approach so the first layer that succeeds provides the session:

| # | Layer | Where | Notes |
|---|---|---|---|
| 1 | `webRequest.onBeforeSendHeaders` | Background SW | Passively intercepts `X-Consul-Token` from every outgoing Consul API request. Zero user interaction required — most reliable layer. |
| 2 | `fetch` / `XHR` hooks (MAIN world) | Injected content script | Wraps `window.fetch` and `XMLHttpRequest` inside the page's JS context so tokens sent by the Consul SPA are captured even before the response returns. |
| 3 | Priming fetches (`SS_PRIME`) | Injected content script | Fires harmless `/v1/agent/self` and `/v1/kv/…?keys` requests in the page context so layers 1 and 2 have something to intercept immediately. |
| 4 | `localStorage` / `sessionStorage` scan | MAIN world executeScript | Direct storage read; validated against `/v1/acl/token/self` before use. |
| 5 | `IndexedDB` scan | MAIN world executeScript | Covers Consul UI 1.16+ which stores the ACL token in IDB, not `localStorage`. |
| 6 | `chrome.cookies` API | Background SW | Reads Consul-domain cookies directly; works even when the tab is inactive or the content script failed to inject. |

**Token validation** uses a tri-state result (`"valid"` / `"invalid"` / `"unreachable"`) so a network error never causes a valid token to be discarded.

**Token storage** uses `chrome.storage.session` on Chromium 102+ — tokens are never written to disk and are automatically cleared when the browser closes. Firefox falls back to `chrome.storage.local` (session storage is not yet available in Firefox MV3).

## 🧭 Build Targets

| Command | Output |
|---|---|
| `npm run build:chromium` | `dist/chromium/` — load into Chrome, Edge, or Brave |
| `npm run build:firefox` | `dist/firefox/` — load into Firefox |
| `npm run build:all` | Both targets |
| `npm run zip` | `SecretsSanta-chromium.zip` + `SecretsSanta-firefox.zip` |
| `npm run xpi:firefox` | `SecretsSanta-firefox.xpi` (Firefox Dev / Nightly) |

## 🛠️ Development & Contribution

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for a full walkthrough.

### Quick Start

1. **Fork** and **clone** the repo.
2. **Install** tooling: `npm ci`
3. **Create a branch**: `git checkout -b fix/my-fix` or `feat/my-feature`
4. **Make changes** in `src/` — the codebase is vanilla JS/HTML/CSS, no framework.
5. **Lint**: `npm run lint` (auto-fix: `npm run lint:fix`) — CI will block the merge if lint fails.
6. **Build & test**: `npm run build:all`, then load `dist/chromium/` (Chrome/Edge/Brave) or `dist/firefox/` in your browser.
7. **Open a PR** to `master`.

> **CI builds automatically.** Every PR triggers a full lint → build pipeline. Once the build passes, a bot comment is posted on the PR with direct download links for each browser's sideloadable package — no local build needed to test the PR.

### Local Testing (Consul Dev Agent)

```bash
# Install Consul (macOS)
brew install consul

# Start a local dev agent (UI at http://localhost:8500)
consul agent -dev

# Seed a test key
consul kv put app/dev/HELLO world
```

Then navigate to `http://localhost:8500/ui/dc1/kv/app/dev/` and open SecretsSanta.

## 📚 Docs & Policies

| Document | Link |
|---|---|
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Architecture | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Changelog | [docs/CHANGELOG.md](./docs/CHANGELOG.md) |
| Security Policy | [docs/SECURITY.md](./docs/SECURITY.md) |
| Privacy Policy | [PRIVACY.md](./PRIVACY.md) |
| Code of Conduct | [docs/CODE_OF_CONDUCT.md](./docs/CODE_OF_CONDUCT.md) |
| Reviewer Notes | [docs/REVIEWER_NOTES.md](./docs/REVIEWER_NOTES.md) |

## 🔐 Security

- **Local execution** — all logic runs in your browser. No backend, no relay.
- **No analytics** — we do not track usage or transmit any data.
- **Token safety** — on Chromium 102+, your Consul token is stored in `chrome.storage.session`, which is never written to disk and is automatically cleared when the browser closes. On Firefox, `chrome.storage.local` is used as a fallback. The token is used only to make Consul API calls on your behalf and is never transmitted elsewhere.

## 📄 License

This project is licensed under the [MIT License](https://github.com/ninadsutrave/secrets-santa/blob/main/LICENSE).

## ✍️ Author

**Ninad Sutrave**
[ninadsutrave.in](https://ninadsutrave.in)
