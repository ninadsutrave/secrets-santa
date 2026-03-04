# Contributing

SecretsSanta supports building packages for Chrome, Edge, Brave (Chromium family) and Firefox from one codebase.

## Prerequisites
- Node.js 18+
- npm

## Build Targets
- Chromium family (Chrome/Edge/Brave):
  - npm run build:chromium
  - Output: dist/chromium/
- Firefox:
  - npm run build:firefox
  - Output: dist/firefox/
- Both:
  - npm run build:all

## Commands

Add the following scripts to package.json:

```json
{
  "scripts": {
    "build:chromium": "node scripts/build.mjs --target=chromium",
    "build:firefox": "node scripts/build.mjs --target=firefox",
    "build:all": "node scripts/build.mjs --target=all",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix"
  }
}
```

## Pull Requests & CI
Our GitHub Actions CI pipeline runs automatically on all Pull Requests to the `master` branch.
- **Linting is enforced**: You must ensure your code passes `npm run lint` before committing. If the linter fails, the CI pipeline will fail, and **merging to master will be blocked**.
- You can auto-fix formatting issues locally using `npm run lint:fix`.

## Notes
- Chromium builds use Manifest V3 service worker and optional host permissions
- Firefox build includes a content script bridge to capture Consul tokens from page APIs
- Submit Chromium build to Chrome Web Store, Edge Add-ons, and Brave using the same zip
- Submit Firefox build to AMO with the Firefox output
