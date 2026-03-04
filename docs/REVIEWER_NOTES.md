# Notes to Reviewers

## Build & Reproduction
- Requirements: Node.js 18+, npm
- Install: npm ci
- Build:
  - Chromium: npm run build:chromium → dist/chromium/
  - Firefox: npm run build:firefox → dist/firefox/
- Package:
  - Zip: npm run zip (produces Chromium and Firefox zips)
  - XPI (optional): npm run xpi:firefox

## Architecture Summary
- Common sources; per-target manifest generation via scripts/build.mjs
- Firefox content script bridge for token capture and priming
- Background handles token cache/validation and proxy actions

## Testing Instructions
- Chromium:
  - Load dist/chromium via chrome://extensions, edge://extensions, brave://extensions
  - Navigate to Consul UI; click Load Secrets
- Firefox:
  - about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json
  - Interact with Consul UI; click Load Secrets
  - Bridge captures header tokens; storage scan fallback if needed

## Data & Privacy
- No analytics or external transmission
- Token stored locally per host; used only for Consul API calls
- PRIVACY.md documents scope and controls
