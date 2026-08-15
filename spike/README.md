# Phase 0 spike — results

Throwaway extension proving the auth + CORS path before anything is built on it.

## Constants (final, consumed by src/config/appConfig.ts)

| Constant | Value |
|---|---|
| Entra app (client) ID | `84e47c8b-6499-40e9-b014-3e24c9ecd303` |
| Platform | Mobile & desktop (public client), multi-tenant |
| Authority | `https://login.microsoftonline.com/organizations` |
| Pinned extension ID (Chrome + Edge, via manifest `key`) | `nppecoclmgfkccogikgalbgpkimljhch` |
| Redirect URI | `https://nppecoclmgfkccogikgalbgpkimljhch.chromiumapp.org/` |
| Scope form | `{orgUrl}/user_impersonation offline_access openid` |

The manifest `key` field pins the extension ID on every machine and in both
browsers, so the single redirect URI above never drifts. The private key in
`keys/` (gitignored) is only needed if we ever pack a .crx by hand — store
uploads generate their own.

## How to run

1. `chrome://extensions` (or `edge://extensions`) → Developer mode → Load unpacked → this `spike/` folder.
2. Confirm the loaded ID equals the pinned ID above.
3. Click the toolbar icon. Sign in if prompted.
4. Badge turns **OK** (green) or **ERR** (red). Details: Inspect service worker → console, or `chrome.storage.local.get('spikeResults')`.

## Answers

| Q | Question | Chrome | Edge |
|---|---|---|---|
| Q1 (gate) | Dataverse GET 200 from extension origin | _pending_ | _pending_ |
| Q2 | SSO pass-through (no credential typing; authorize < ~3s) | _pending_ | _pending_ |
| Q3 | Second-org token in same session | _pending_ | _pending_ |
