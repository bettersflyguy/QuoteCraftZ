# Phase 0 spike — results

Throwaway extension proving the auth + CORS path before anything is built on it.

## Constants (final, consumed by src/config/appConfig.ts)

| Constant | Value |
|---|---|
| Entra app (client) ID | `84e47c8b-6499-40e9-b014-3e24c9ecd303` |
| Platform | **SPA** (spike-verified: AADSTS9002326 rejects public-client redemption from a chrome-extension origin), multi-tenant |
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
| Q1 (gate) | Dataverse GET 200 from extension origin | **PASS** (2026-08-15, SPA platform) | deferred to e2e checklist |
| Q2 | SSO pass-through (no credential typing; authorize < ~3s) | PASS — account picker shown (prompt=select_account, by design), no password typing | deferred to e2e checklist |
| Q3 | Second-org token in same session | authorize flow proven; per-org redemption exercised when a second real env is added | n/a |
