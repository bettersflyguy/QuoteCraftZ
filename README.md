# QuoteCraftZ

Chrome/Edge extension that captures data from the agency's quoting tools and
moves it where it's needed next:

- **EZLynx (personal lines):** imports comparative-rater quote results into the
  Betters D365 Insurance CRM as `iacrm_quote` records - applicant-matched,
  carrier-mapped, idempotent on re-import, written as the signed-in agent.
- **Bold Penguin (commercial lines):** captures a completed application
  (every question set, including vehicle VINs) read-only, then fills matching
  fields on any carrier portal on demand - highlighting what it changed and
  never clicking Next, Save, Get Quote, or Submit. The capture lives only in
  browser session storage; a JSON download is available for review.

The side panel switches mode by the active tab: EZLynx shows the import wizard,
Bold Penguin shows Capture, and any other site shows "Fill this page" once an
application is captured. Carrier-portal access is requested per site at click
time (optional host permissions), so the install prompt stays lean.

- **Spec:** `docs/superpowers/specs/2026-08-15-ezlynx-quote-bridge-design.md`
- **Plan:** `docs/superpowers/plans/2026-08-15-ezlynx-quote-bridge.md`
- **Pre-release checklist:** `docs/e2e-checklist.md`

## How it works

A content script on `app.ezlynx.com` calls EZLynx's own JSON API with your
existing session cookie (read-only, always). A service worker signs you into
Dataverse via Entra (PKCE; you pick your Microsoft account; per-environment
tokens) and writes quotes with your own permissions - no service account, no
server, no stored secrets. The side panel walks: pick rate run → match Account →
pin an Opportunity per line of business → map carriers → review → commit.

## Install (internal, unpacked)

Releases are built by the Release desk and delivered through the Decision desk. You do not build anything on your own machine.

1. Get the release zip from the Decision desk. It comes with a release note that names the version and the sha256 of the zip.
2. Check the zip is the one that was built. In PowerShell:
   ```powershell
   Get-FileHash .\QuoteCraftZ.zip -Algorithm SHA256
   ```
   The hash must match the release note exactly. If it does not, do not install it; tell the Decision desk.
3. Unzip it into one stable folder that you keep using for every release (for example `C:\Tools\QuoteCraftZ`). Chrome reads the extension from this folder, so do not move or delete it afterwards.
4. First time only: Chrome `chrome://extensions` → Developer mode ON → **Load unpacked** → select that folder. Edge: `edge://extensions`, same steps.
   Updates: replace the files in the same folder with the new unzipped release, then click **Reload** on the QuoteCraftZ card in `chrome://extensions`.
5. Confirm the version shown on the QuoteCraftZ card in `chrome://extensions` matches the version in the release note.
6. Pin "QuoteCraftZ" from the extensions menu (🧩).
7. First CRM action prompts a Microsoft sign-in - an account picker appears;
   choose your `@bettersagency.com` account. This happens once per environment.

The extension ID stays the same on every release because the manifest carries the public key. Reloading the same folder keeps your settings.

Your settings (CRM environments, field maps, choice maps, carrier matches) can be saved and restored from the Options page with the export and import icons. Before you switch from an older install to the stable folder for the first time, export your settings from Options, and import the file after loading the new build. The file never contains sign-in tokens, so you sign in again once per environment.

Building from source (`npm ci && npm run build`, output in `dist/`) is for development only. See "Development" below.

Your account needs a Dataverse security role in the target environment. Default
environment is **DEV** (`agentcrmdev.crm.dynamics.com`); manage environments in
the extension's Options page.

## The environment badge

The colored pill in the panel header is the write destination. The commit button
always names it ("Write 6 quotes to **DEV**"). Switching environments clears your
in-progress CRM selections (record IDs don't cross orgs) but keeps the captured
EZLynx data.

## Releases and versioning

- Every pull request that changes shipped code raises `version` in `package.json` (and the matching entries in `package-lock.json`) in that same pull request. A pull request that changes only docs or tooling does not.
- Nothing is pushed directly to `main`. Every change goes through a pull request with review.
- After a merge, the Release desk builds the zip from the merge commit and the Decision desk delivers it (see Install).

## Troubleshooting

| Panel message | Cause | Fix |
|---|---|---|
| "Open an EZLynx applicant page, then Refresh" | Panel can't find an EZLynx tab with an applicant in context | Open the applicant in EZLynx, click Refresh |
| "EZLynx session expired - sign in on the EZLynx tab and retry." | EZLynx logged you out | Sign back into EZLynx; your captured data is retained |
| "Couldn't read EZLynx results - the extension needs an update." | EZLynx changed its payload shape | Click "Copy payload" and send it to the maintainer; nothing was written to the CRM |
| "Your account has no access to DEV (…)" | No Dataverse security role in the active environment, or wrong environment active | Check the badge; switch environments or request access |
| Sign-in window loops or errors `AADSTS…` | Entra consent/propagation | Wait 2 minutes, retry; if persistent, send the AADSTS code to the maintainer |
| Some rows show errors after commit | Per-row Dataverse rejections (batch continues past failures) | Failed rows stay selected - fix the cause and hit "Retry failed" |

## Development

```bash
npm ci
npm test          # Vitest - normalizers, mapping, auth, batch
npm run build     # tsc + vite → dist/
```

Auth constants (Entra app ID, pinned extension ID, redirect URI) are recorded in
`spike/README.md`. EZLynx endpoint knowledge lives only in `src/ezlynx/` +
`src/config/endpoints.json`; Dataverse field mapping in `src/crm/mapping.ts`.

Maintainer: Nathan Betters (nathan@bettersagency.com).
