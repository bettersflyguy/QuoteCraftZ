# Session handoff: QuoteCraftZ (EZLynx Quote Bridge)

Handoff from a local Claude Code session (Nathan's Windows machine) to a cloud session, 2026-11-09. Read this first, then work from the repo.
Full technical spec (data shapes, mapping grammar, pipelines, CRM contract, invariants): `docs/technical-spec.md`.

## The product

QuoteCraftZ is a Chrome MV3 side-panel extension for Betters Insurance agents.

- **Ingest:** reads insured data from rating and agency sites: EZLynx (through its own data service), NowCerts / Momentum AMS, carrier portals, and the agency's Dynamics 365 CRM.
- **Show:** lays the captured data out in the panel.
- **Load into CRM:** writes it to Dataverse (accounts, contacts, opportunities, quotes, policies, notes, Prior Coverage and assets).
- **Fill:** fills quote forms from the capture.

- Repo: GitHub `bettersflyguy/QuoteCraftZ`, branch `main`. Latest shipped build: **v0.1.66** (commit f161cee).
- Stack: TypeScript strict, Vite + crxjs, React 18, Fluent UI v9, Vitest (jsdom).
- Owner: Nathan Betters (agency owner). Wants short, direct, answer-first replies and autonomous execution.

## Commands

```bash
npm ci
npm test               # vitest run: 313 tests, 46 files, all passing at handoff
npx tsc --noEmit -p .  # must be clean
npm run build          # tsc + vite build into dist/
```

## Publishing (local machine only)

`scripts/publish-local.ps1` does the following:
1. bumps the patch version;
2. builds;
3. commits `package.json` as `release: vX.Y.Z` and pushes;
4. mirrors `dist/` into Nathan's OneDrive folder, which Chrome loads unpacked.

That last step only works on Nathan's machine. **In the cloud:** commit and push source changes, then tell Nathan to run the publish script locally:

```bash
powershell -ExecutionPolicy Bypass -File scripts/publish-local.ps1
```

`keys/` (the manifest signing key that keeps the extension ID stable) is gitignored and only exists locally. A cloud build gets a different extension ID; that's fine for tests but not for publishing.

## Standing rules (from Nathan, non-negotiable)

**Writing and UI**
- No em or en dashes anywhere: UI text, CRM data, code, comments. Check with `grep -c $'\xe2\x80\x94\|\xe2\x80\x93' <files>`.
- No instructional filler text in the UI; icon buttons carry tooltips.

**Commits**
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- PR descriptions end with the Claude Code attribution line.
- Commit and push source first; the release commit is the publish script's.

**Security and privacy**
- SSN is never stored in the capture, export, notes or panel; it is shown masked only.
- License numbers and identifier columns travel only on the secured channel (`secure:` targets, session-memory holding area). They never go in a plain capture field, timeline note or share file.
- Secured mappings never travel in share files.
- Never write `iacrm_amsexternalid`, `iacrm_synctoams` or `iacrm_lastsyncon`.
- Prior Coverage, and the planned Policy Driver / Driving Incident tables, never sync to NowCerts.

**CRM schema and environments**
- **CRM schema, form and role changes are NOT built from this session.** They go to Nathan's separate CRM enhancement session (repo `bettersflyguy/BettersInsuranceCRM`) as a handoff brief. Build only the extension side against the agreed contract. Example: `docs/crm-handoff-policy-drivers.md`.
- DEV Dataverse: `https://agentcrmdev.crm.dynamics.com`. Read-only metadata checks are fine (they used `az account get-access-token` locally; the cloud likely has no Azure login). Never touch production; Nathan promotes.

**Deferred work**
- Filling styled dropdowns (EZLynx Year/Make/Model mat-selects) is deferred until Nathan finishes validating ingestion.

## Code map

| Area | Files |
|---|---|
| Page scripts (plain JS, injected; loaded in tests via `new Function`) | `public/portal/portal-mapper.js` (sections, scopes, field matching), `portal-ingest.js` (capture), `portal-fill.js` (fill, pick, peek, scan), `portal-autocap.js` (auto-capture change signal) |
| Worker / message router | `src/worker.ts`, `src/workerRouter.ts` (all `panel/*` routes, ingest paths, auto-capture queue) |
| EZLynx data service | `src/ezlynx/client.ts`, `src/ezlynx/normalize.ts`, `src/ezlynx/content.ts`, `src/sources/ezlynxSource.ts` (field list, routing, peek items) |
| Mapping grammar | `src/portal/fieldMaps.ts` (targets, row slots, notes, field keys, `familyKeyOf`), `src/portal/assetTables.ts` (asset and child tables, no imports), `src/portal/optionMaps.ts` (choice translation) |
| CRM catalog and writes | `src/crm/fieldCatalog.ts` (live column catalog per entity, cache `crm/fieldCatalog/v7/`), `src/crm/dataverse.ts` (Web API, `upsertPriorCoverage`, `upsertAsset`, `upsertChildRecord`, notes), `src/crm/appCommit.ts` (capture to CRM drafts, `priorCoveragesFromCapture`, `rowSections`, line-of-business helpers) |
| Capture merge and people | `src/boldpenguin/ingest.ts` (`mergeIngestedFields`; a re-read replaces the old value), `src/boldpenguin/people.ts` (`alignPeople`: match people by name across sources, new people take the next free slot) |
| Panel UI | `src/panel/steps/PortalFill.tsx` (Intake view, data tables, policy tables, notes, auto-capture), `src/panel/steps/LoadToCrm.tsx` (Load flow: account, contacts, opportunities, quotes, Prior Coverage, assets, child records, notes), `src/panel/MapEditor.tsx`, `MappingsManager.tsx`, `DataServiceMapEditor.tsx` |
| Starter mappings | `public/mappings/quotecraftz-ezlynx-mappings.json` |

## Key concepts

- **Targets:**
  - semantic paths (`contact.firstName`), CRM columns (`crm:<entity>.<column>`);
  - lists (`crm:contacts[]`, `crm:vehicles[]`...) that fan into row slots (`crm:contact2`, `crm:vehicle1`...);
  - notes (`note`, `note:opportunity`, `note:contacts[]`...);
  - secured (`secure:...`).
- **Person slots:** 1 = primary insured (`contact.*`, `crm:primarycontact.*`); N = related contact N. `crm:contacts[]` row 1 = slot 2.
- **Field keys:** `field:[page|][section>]label` maps a page field by its label on a page step, optionally in a sub-section.
- **Repeated cards** (one per driver: "Primary Insured" / "Additional Driver") map "every card": card order is row order, and each row lands on the person its own name matches.
- **Sections:**
  - a line's Policy Info step is **"Opportunity Policy - Auto"** (Home, Dwelling, Boat, RV, Personal Articles...);
  - prior-policy values are **"Prior Auto Policy"**, written on Load to CRM **Prior Coverage** (`iacrm_priorcoverages`).
  - Other steps are "Auto: Drivers" and so on.
- **EZLynx ingest** uses its data service (Insured / Contacts / Phones / Emails / Addresses), plus fields the agent mapped on the page. Drivers added only on a quote's risk application are added as contacts. Auto-capture on EZLynx runs the same data-service ingest, never a raw page scrape.
- **Asset tables:**
  - Vehicles, Watercraft, Properties, Equipment and Scheduled items are each one record per row on the insured, matched by VIN / hull ID / street / serial so a reload never duplicates.
  - Additional interests attach to the asset's insured item.
  - Property renovations, losses and parties attach to the property mapped on the same page.

## Shipped this session (v0.1.58 to v0.1.66)

1. **Prior Coverage:** captured "Prior <Line> Policy" tables become CRM Prior Coverage records, and values can also be mapped straight to Prior Coverage columns.
2. **Auto-capture:**
   - on EZLynx it reads the data service;
   - turning it on captures mapped, filled-in values at once and reports why if it can't;
   - EZLynx reads target the agent's own tab.
3. **Mapping search:** includes Prior Coverage, all asset tables, Additional interests, Property renovations, losses and parties, and the contact driver fields (all verified against live DEV metadata).
4. **Policy tables:** "Opportunity Policy - <Line>" naming. Policy tables show every value from their page with a "Goes to" column. One-off repeated labels (the two "Month" boxes) are named after their field. Note values are grouped per section.
5. **Quote drivers:** drivers on the EZLynx risk application become contacts.
6. **Card mapping:** a typed or date box on repeated cards maps every card, like a dropdown. Saved one-row mappings on those pages convert themselves.

## Open items (in priority order)

1. **Live verification.** None of v0.1.59 to v0.1.66 has been run on a live EZLynx page. Nathan tests manually after each publish; expect screenshots of results.
2. **Policy Driver / Driving Incident.** Waiting on the CRM session, which has the handoff `docs/crm-handoff-policy-drivers.md`. When its report arrives, build:
   - "Policy drivers (all rows)" and "Driving incidents (all rows)" as list targets: add them to `assetTables.ts` child tables, or as a new kind linked to a contact rather than an asset;
   - Load: one Policy Driver per driver row (contact + account + the line's opportunity + line of business), upserted by contact + opportunity or policy; incidents upserted by contact + type + date;
   - use the exact link names (bind navigation property names) the CRM session reports.
3. **Fill from CRM on driver cards** still goes by card order (card 1 is filled from the first related contact, not the primary). Nathan was offered name-matched fill; not yet requested.
4. **Not covered yet:** linking a property to the opportunity (N:N `iacrm_property_opportunity`) and a vehicle's primary driver lookup. Offered, not requested.
5. **Styled-dropdown fill** stays deferred.

## Working style that worked

- Read the code before claiming a cause, and say plainly when a cause is unconfirmed.
- Add a test for every fix: page-script behaviour under jsdom (see `tests/sections.test.ts`), merge and people logic in plain unit tests.
- After each change:
  1. `npx tsc --noEmit -p .`
  2. `npx vitest run`
  3. the dash check
  4. commit
  5. push
  6. publish (locally)
- The reply states the version, what changed, how to verify it, and what wasn't verified.
- Shell gotcha seen locally: `\\` in Bash heredocs got collapsed. Prefer the Edit tool for regex-bearing code, or `chr(92)` in Python scripts.
