# Privacy Policy

SecretsSanta is a browser extension that helps developers work with Consul KV securely on their own machines. This document explains what data the extension accesses, how it is used, and the controls available to you.

## Overview
SecretsSanta runs entirely within your browser. It does not send analytics, telemetry, or usage data to any external service. All processing occurs locally on your device.

## Data Accessed
SecretsSanta may access the following data solely to provide its functionality:

- Consul KV keys and values from Consul pages you open in your browser

- Consul session token (`X-Consul-Token`) used to make KV API requests on your behalf

- Saved collections (snapshots of keys/values) that you choose to store locally

- Optional host permissions that you explicitly grant to allow interaction with specific Consul endpoints

## Purpose of Data Use
The accessed data is used strictly to:

- List keys and fetch values under the active Consul KV path

- Display, copy, download, and compare keys/values for developer workflows

- Apply bulk updates (PUT requests) to keys when you upload data (e.g., `.env` or JetBrains formats)

No data is used for analytics, advertising, profiling, or tracking.

## Storage
SecretsSanta uses `chrome.storage.local` to store:

- Consul token per host (if captured)

- Saved collections (your snapshots of keys/values)

- UI preferences (such as dark mode)

All stored data remains local to your browser profile. You may clear this data at any time through browser settings or by removing the extension.

## Network Activity
- Requests are made only to Consul endpoints under the hosts you visit (for example, `/v1/kv/` or `/v1/acl/token/self`).

- The Consul token is attached only to requests made to your Consul host and only to perform actions you initiate.

- No data is transmitted to third-party servers beyond your configured Consul host(s).

## Permissions
SecretsSanta requests the following required permissions:

- `storage`

- `tabs`

- `webRequest`

- `scripting`

Optional host permissions are requested on a per-host basis to allow interaction with specific Consul instances when needed.

The extension listens for the `X-Consul-Token` header on requests to your Consul host solely to reuse your existing authenticated session locally.

## Your Controls
You have full control over the extension’s behavior:

- Grant or revoke host permissions at any time

- Save, delete, or export collections

- Copy keys in .env or JetBrains format

- Clear local storage via browser settings

- Remove the extension entirely

## Security
- Tokens are stored locally and used only for requests to your Consul host.

- The extension does not collect or transmit personal data.

- All actions are initiated by you through the extension interface.

## Changes
If this policy changes, the updated version will be published in the project repository.

## Contact
Questions or concerns: ninadsutrave@gmail.com
