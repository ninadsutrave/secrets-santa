# Architecture

## Overview
- Single codebase for Chromium and Firefox
- Build script generates per-target dist with appropriate manifest entries

## Modules
- src/popup
  - popup.html, styles.css, modules/, popup.js bundle
  - UI: load, save, compare, upload flows
- src/background
  - background.js (bundled)
  - webRequest header observation; token cache and validation; message handlers
- src/shared
  - constants.js, storage.js, consul.js (URL builders, helpers)
- src/content (Firefox)
  - consul-token-bridge.js wraps fetch/XHR in page context; scans storage; primes /v1/* requests

## Data Flow
- Token capture
  - Headers: webRequest onBeforeSendHeaders sees X-Consul-Token → validate → cache
  - Page bridge (Firefox): detects tokens in fetch/XHR → sends to extension; scans storage for plausible tokens
  - Popup: installs event listener; primes capture via messaging; falls back to storage capture
- Validation
  - /v1/acl/token/self; accepts tokens if ok or if denied under default “deny” policy; KV listing is final gate
- KV operations
  - List keys: /v1/kv/<prefix>?keys&separator=/
  - Fetch values: /v1/kv/<fullKey>
  - Upload values: PUT /v1/kv/<fullKey>

## Permissions
- Required: storage, tabs, webRequest, scripting
- Optional host permissions granted per host
- Firefox: background.scripts for temp installs; browser_specific_settings with ID and consent

## Messaging
- Popup ↔ Background: chrome.runtime.sendMessage
- Popup ↔ Page (Firefox): chrome.tabs.sendMessage (SS_PRIME, SS_SCAN) handled by content script
