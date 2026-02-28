# 🎅 SecretsSanta

SecretsSanta is a Chrome extension that helps developers fetch, view, copy,
and compare secrets stored in Consul KV — safely and effortlessly.

## About

SecretsSanta is a lightweight Consul KV companion for developers who spend time in the Consul UI and want faster workflows for viewing, copying, exporting, and comparing KV values without writing one-off scripts.

## Who This Is For

- Backend / platform / SRE engineers working with Consul KV
- Developers debugging configs across environments
- Anyone who needs quick, safe, copy-friendly access to KV values from the Consul UI

## How It Helps

- Turns the current Consul KV page into a clean key/value table
- Supports safe-by-default viewing (masking sensitive values)
- Makes exports and IDE imports trivial
- Enables quick diffs between saved snapshots of KV prefixes

## ✨ Functionality

- Load keys and values from the current Consul KV UI page
- Automatically captures the `X-Consul-Token` from Consul UI network requests
- Fetches values via Consul KV API (`/v1/kv/...`) using the captured token
- Shows only direct keys on the current page (skips folders)
- Displays key/value pairs in a tabular view
- Masks values for sensitive keys (token/secret/password-like names)
- Toggles visibility for sensitive values (masked ↔ unmasked)
- Copies any individual value to clipboard (always copies raw)
- Detects valid JSON objects/arrays and toggles pretty JSON view
- Truncates long values while keeping copy available
- Downloads all loaded keys as a `.env` file
- Copies all loaded keys in IntelliJ / JetBrains env-var format
- Uploads key values to the currently opened Consul KV prefix (create/update)
- Saves a snapshot of the currently loaded prefix to local storage
- Updates an existing saved collection when saving the same prefix again
- Lists saved collections with key counts
- Loads a saved collection into the table view
- Deletes saved collections
- Searches keys in both table view and saved-collections view
- Compares any two saved collections (A → B)
- Diff view highlights added/changed/removed keys and shows both A and B values
- Includes a dark mode toggle for the popup UI
- Keyboard shortcut to open the UI: `Ctrl+Shift+S` (Windows/Linux), `Command+Shift+S` (macOS)

## 🗂️ Project Structure

- [manifest.json](file:///Users/ninadsutrave/Downloads/SecretsSanta/manifest.json): Chrome extension manifest (entrypoints + permissions)
- [src/background/background.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/background/background.js): service worker (token capture + Consul API)
- [src/popup/popup.html](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/popup.html): popup UI markup
- [src/popup/popup.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/popup.js): popup UI logic
- [src/popup/modules/env-utils.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/env-utils.js): .env and value utilities
- [src/popup/modules/modals.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/modals.js): modal wiring for JSON preview
- [src/popup/modules/table.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/table.js): table rendering and inline edit
- [src/popup/modules/token.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/token.js): token acquisition from page/network
- [src/popup/modules/collections.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/collections.js): saved collections list/load/delete
- [src/popup/modules/compare.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/compare.js): diff building and compare picker
- [src/popup/modules/upload.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/modules/upload.js): upload flows (.env / JetBrains)
- [src/popup/styles.css](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/styles.css): popup styling
- [src/shared/constants.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/shared/constants.js): shared constants (message types, headers, regex, etc.)
- [src/shared/storage.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/shared/storage.js): shared storage helpers
- [src/shared/consul.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/shared/consul.js): Consul URL + Base64 decode helpers (background)

## 🛠 Local Setup

1. Install Node.js 18+.
2. Install dependencies:
   - Run `npm install` in the repo root.
3. Load the extension:
   - Open Chrome → `chrome://extensions`
   - Enable Developer mode
   - Click Load unpacked → select the `SecretsSanta` folder

## 🧑‍💻 Development

- Use the unbundled popup for the best DX:
  - Manifest action points to [src/popup/popup.html](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/popup.html), which loads modular scripts directly.
- Optional: build a bundled popup during development:
  - `npm run dev:popup` (watches and emits `dist/popup.bundle.js`)
  - To preview the bundle, temporarily change the manifest’s `action.default_popup` to [src/popup/popup.prod.html](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/popup.prod.html) and reload the extension.

## 📦 Production Build

- Create a minified bundle:
  - `npm run build:popup`
  - Output: [dist/popup.bundle.js](file:///Users/ninadsutrave/Downloads/SecretsSanta/dist/popup.bundle.js)
- Set the default popup to the production HTML when packaging:
  - [src/popup/popup.prod.html](file:///Users/ninadsutrave/Downloads/SecretsSanta/src/popup/popup.prod.html) includes only the bundled script.

## 🧩 Installation

1. Download and unzip this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `SecretsSanta` folder

### Upload Key Values

Use **Upload Key Values** to create/update keys under the KV prefix of the currently opened Consul UI page.

- **.env**: choose a `.env` file containing `KEY=VALUE` lines
- **JetBrains**: paste JetBrains env-var format like `A=B;C=D;`

After selecting/pasting, click **Upload** and confirm.

## 🎅 A Little Holiday Spirit

Santa keeps your secrets snug and safe while you work. He’ll mask the sensitive bits, pretty‑print your JSON gifts, and help you compare lists like a pro. No chimneys required.

## 🔐 Security Notes

- Tokens are never logged
- Secrets are only fetched on demand
- Masking is UI-only — copying is always raw

## 🤝 Contributing

This is an open‑source initiative. Issues and pull requests are welcome:

- Fork the repo and create a feature branch
- Keep changes focused and well‑scoped
- Follow existing patterns and avoid introducing dependencies without discussion
- Test the flows: load secrets, edit/save, upload, compare, and JSON preview

## License

MIT — see [LICENSE](file:///Users/ninadsutrave/Downloads/SecretsSanta/LICENSE).

## Author

Ninad Sutrave  
Website: https://ninadsutrave.in
