# SecretsSanta — Suggestions for Improvement

Improvement opportunities identified during the v1.0.3 audit. Grouped by area.

---

## 1. Token Collection

### Current layers (working)

| Layer | Mechanism | Notes |
|---|---|---|
| ✅ `webRequest.onBeforeSendHeaders` | Passive intercept of `X-Consul-Token` from every Consul API request | Best passive capture — zero user interaction |
| ✅ Fetch / XHR hooks (MAIN world) | `window.fetch` and `XMLHttpRequest` wrapped inside the page JS context | Covers all SPA navigation within the Consul UI |
| ✅ localStorage / sessionStorage scan | Page-context MAIN world read of storage keys matching Consul patterns | Good fallback for Consul UI versions that store the token in storage |
| ✅ Cookie scan (page context) | `document.cookie` read via executeScript | Covers some enterprise Consul deployments |

### Suggested additions

#### 1.1 `chrome.cookies` API  ❌ Not yet implemented

**What:** Use `chrome.cookies.getAll({ url })` in the background service worker to read Consul-domain cookies directly — without needing to inject a script into the page.

**Why:** More reliable than `document.cookie` via executeScript. Works even when the tab is not active or the content script failed to inject. Catches cookie-based auth patterns on any tab load.

**Requires:** Adding `"cookies"` to `manifest.json` permissions. The extension already holds optional host permissions for the Consul host (granted by the user), which satisfies the URL filter requirement.

**Integration point:** `getActiveToken()` in `background.js` — after storage lookup, before returning empty.

---

#### 1.2 IndexedDB scan  ❌ Not yet implemented

**What:** Enumerate all IndexedDB databases at the Consul origin and scan object stores with token / session / auth related names for UUID or JWT-shaped values.

**Why:** Consul UI 1.16+ stores session data (including the ACL token) in IndexedDB, not in localStorage. Without this layer, SecretsSanta cannot auto-capture tokens from newer Consul versions.

**API:** `indexedDB.databases()` (available Chrome 72+, Firefox 126+). Guard with `if (!indexedDB.databases)` for compatibility.

**Integration points:**
- `captureAndStoreTokenFromConsulStorage()` in `token.js` — make the executeScript func `async` and add the IDB scan after localStorage/sessionStorage, returning immediately if found.
- `consul-token-bridge.js` — add async `scanIndexedDB()` and call it from `scanStorages` and the `SS_SCAN` handler.

---

#### 1.3 JWT / non-UUID token support  ⚠️ Partial

**What:** Update `plausibleToken()` in all three locations (`consul-token-bridge.js`, `token.js` inline func, `background.js`) to:
1. Detect JWTs — three base64url segments separated by dots: `/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/`
2. Raise the generic opaque token length cap from **256** to **2048** characters

**Why:** Consul Enterprise and HashiCorp Cloud Platform (HCP) issue JWT tokens. These are typically 400–1500 characters long — well above the current 256-character cap — so they are silently dropped today.

**Locations to update:**
- `src/content/consul-token-bridge.js` — module-level `plausibleToken()`
- `src/popup/modules/token.js` — inline `plausibleToken` inside the `captureAndStoreTokenFromConsulStorage` executeScript function
- `src/background/background.js` — new shared `plausibleToken()` needed for cookie scanning

---

## 2. Token Storage

### Current behaviour

Tokens are written to `chrome.storage.local` — persisted to disk indefinitely. Correct for surviving MV3 service worker restarts (which happen every ~30 seconds when idle).

### Suggested improvement

#### 2.1 `chrome.storage.session` hybrid  ❌ Not yet implemented

**What:** Prefer `chrome.storage.session` (Chromium 102+) for token storage. Fall back to `chrome.storage.local` on Firefox or older Chrome.

**Why:** `chrome.storage.session` is:
- **Never written to disk** — significantly smaller attack surface for token theft
- **Automatically cleared when the browser closes** — reduces the window in which a stolen token file could be used
- **Survives service worker restarts within a session** — so it behaves identically to `local` from an MV3 reliability standpoint

**Migration:** `getTokenForHost` should try session first, then fall back to local. This ensures tokens stored by the previous version (in local) are still usable. `setTokenForHost` writes to session only. `clearTokenForHost` clears from both stores to ensure complete cleanup on token invalidation.

**Firefox note:** `chrome.storage.session` is not available in Firefox MV3 (as of Firefox 126). The fallback to `chrome.storage.local` ensures no regression.

---

## 3. Token Usage (already solid)

The triple-retry pattern in `fetchKeyValue`, `listDirectKeys`, and `putKeyValue` is correct and covers all common Consul auth configurations:

1. **Try with cached token** — fast path
2. **On 401/403: re-read latest stored token and retry** — handles races where `webRequest` captured a newer token between request start and failure
3. **On 401/403 with `x-consul-default-acl-policy: allow`: retry without token** — handles anonymous-auth Consul where sending a stale token causes a 403 but no token works fine

No changes needed here.

---

## 4. Other Code Quality

#### 4.1 Cookie value splitting edge case

**Location:** `consul-token-bridge.js` and `captureAndStoreTokenFromConsulStorage` in `token.js`

**Issue:**
```js
const [k, v] = p.split("=");
```
`split("=")` without a limit returns all splits. For a cookie like `key=base64value==`, only the text up to the first `=` is captured in `v`; the rest is lost.

**Fix:**
```js
const eqIdx = p.indexOf("=");
if (eqIdx === -1) continue;
const k = p.slice(0, eqIdx);
const v = p.slice(eqIdx + 1); // preserves all characters after the first =
```
**Priority:** Low. UUID tokens contain no `=` so this is harmless in practice. Relevant only for base64-encoded tokens.

---

#### 4.2 Firefox `chrome.action.openPopup()` gap

**Location:** `background.js` — keyboard shortcut `chrome.commands.onCommand` handler

**Issue:** `chrome.action.openPopup()` requires a polyfill to map to `browser.browserAction.openPopup()` on Firefox. Without it, the keyboard shortcut silently fails. Toolbar icon click always works regardless.

**Fix:** Add a Firefox-safe wrapper:
```js
chrome.commands.onCommand.addListener((command) => {
  if (command !== CONSTANTS.COMMANDS.OPEN_UI) return;
  try {
    chrome.action.openPopup();
  } catch {
    // Firefox MV3 fallback
    if (typeof browser !== "undefined" && browser.browserAction?.openPopup) {
      browser.browserAction.openPopup();
    }
  }
});
```
**Priority:** Low. Affects keyboard shortcut only; icon click is unaffected.

---

## 5. GitHub Workflow Improvements

| Addition | Reason |
|---|---|
| `permissions: contents: read` on the CI job | Principle of least privilege for the GITHUB_TOKEN |
| Separate `lint` and `build` jobs | Fail fast on lint without waiting for the full build; parallel execution on PRs |
| Manifest version consistency check | Fail if `manifest.json` version was not bumped before a tag push |
| `secrets: FIREFOX_API_KEY/SECRET` + `web-ext sign` step on release tags | Automate Firefox AMO signing so releases don't require manual intervention |
| `retention-days: 14` on artifact uploads | Prevent indefinite artifact storage buildup on PR runs |
| Stale bot (`actions/stale`) | Auto-label and close inactive issues / PRs after a configurable period |
| Dependabot (`/.github/dependabot.yml`) | Keep GitHub Actions action versions up to date automatically |
| PR validation for branch naming (`feat/*`, `fix/*`) | Enforce conventional branch names to keep the git log clean |

---

## 6. README

| Update | Notes |
|---|---|
| Store links | Replace placeholder URLs with live published links for Chrome, Firefox, and Edge |
| Remove `*(Note: Store links are placeholders...)*` note | Links are now live |
| Add "Token Capture Architecture" section | Document the multi-layer capture approach for contributors |
| Update Security section | Reflect `chrome.storage.session` usage on Chromium |
| Add `browser_specific_settings.gecko.id` note | Firefox AMO requires this in the manifest; document that the Firefox build target injects it |
