# QuoteCraftZ: Technical Specification

Version covered: v0.1.66 (2026-11-09). Repo: `bettersflyguy/QuoteCraftZ`. Companion docs: `docs/session-handoff.md` (working context and rules), `docs/crm-handoff-policy-drivers.md` (pending CRM contract).

This document describes what the extension is for, how it is built, the data shapes it stores and moves, and the rules it must keep. When the code and this spec disagree, the code is current; update the spec in the same commit.

---

## 1. Purpose

Agents at an independent insurance agency (Betters Insurance) re-key the same insured data between systems:
- rating sites (EZLynx, Bold Penguin);
- carrier quote portals;
- the agency management system (NowCerts / Momentum AMS);
- the agency's Dynamics 365 CRM.

QuoteCraftZ removes the re-keying:

1. **Ingest:** read the insured, people, addresses, policies, prior coverage, assets and quotes from whatever page the agent is on.
2. **Review:** show what was captured in the side panel, organized as the CRM will hold it.
3. **Load into CRM:** write it to Dataverse without duplicating records or overwriting agent-entered data, and record a dated timeline history.
4. **Fill:** fill a carrier or rater form from the capture or from a CRM record.

Design intentions that drive most decisions:

- **The agent teaches, the extension remembers.** Every site is different. The agent maps a page field once (click it, pick a target), and the mapping works for every applicant after that. Mappings can be shared between agents as files.
- **Match by meaning, not position.** People are matched by who they are, assets by VIN / hull ID / street / serial, and prior policies by line + carrier + expiration. Row order differs between sources and must never decide identity.
- **Never lose or clobber data.** CRM writes fill empty columns only. A changed note creates a new dated note. Re-ingesting replaces a captured value; it never piles up duplicates.
- **Sensitive data has one narrow path.** SSN and license numbers never enter the capture, notes, exports or share files (section 11).
- **The CRM is the source of truth for schema.** Columns are read live from Dataverse metadata, so new CRM columns become mappable without a release. Schema changes are made by the CRM project, never by this extension.

---

## 2. Architecture

Chrome MV3 extension. TypeScript strict, Vite + `@crxjs/vite-plugin`, React 18, Fluent UI v9, Vitest (jsdom for page scripts).

| Context | Entry | Role |
|---|---|---|
| Service worker | `src/worker.ts` > `src/workerRouter.ts` | Owns all state, CRM I/O, script injection, the auto-capture queue. Every panel action is a message routed by `routeMessage(msg, deps)`. `Deps` is injectable for tests; `realDeps` in production. |
| Side panel | `src/panel/index.html`, `App.tsx` | UI. Mode follows the active tab (section 3). Talks to the worker only through `send()` in `src/panel/api.ts`, which has timeouts: 25 s by default, 180 s for CRM writes that may need interactive sign-in, 240 s for captures and auto-capture start. |
| Options page | `src/options/*` | Environments, data-service mappings, settings import/export. |
| EZLynx content script | `src/ezlynx/content.ts` (static, `app.ezlynx.com`) | Bridge to EZLynx's own JSON API using the agent's session: `ezlynx/getContext`, `listRuns`, `captureRun`, `getApplicant`. Answers only `ezlynx/*` messages. Broadcasts `ezlynx/applicantChanged` on SPA navigation. |
| Bold Penguin content script | `src/boldpenguin/extract.ts` | Commercial application capture (legacy source). |
| Page scripts (injected on demand) | `public/portal/portal-mapper.js`, `portal-ingest.js`, `portal-fill.js`, `portal-autocap.js` | Plain JS IIFEs injected with `chrome.scripting.executeScript` into all frames. They expose globals (`__bettersPortalIngest`, `__bettersFieldsByLabel`, `BettersPortalMapper`...). Tests load them with `new Function`. |

Permissions:
- `storage`, `identity`, `sidePanel`, `tabs`, `scripting`.
- Hosts: EZLynx, Bold Penguin, `*.crm.dynamics.com`, `login.microsoftonline.com`.
- `optional_host_permissions: https://*/*`, requested per origin at click time.

The manifest `key` pins the extension ID; the private key in `keys/` is local only.

Build and publish:
- `npm run build` (tsc + vite) writes `dist/`.
- `scripts/publish-local.ps1` bumps the patch version, builds, commits `release: vX`, pushes, and mirrors `dist/` to the OneDrive folder Chrome loads unpacked. This runs on Nathan's machine only.

---

## 3. Panel modes and UI

`panel/getPageContext` classifies the active tab:

- **commercial** (Bold Penguin): `CommercialCapture.tsx`.
- **portal** (every other work site, EZLynx included): `PortalFill.tsx`, the shared Intake.
- **idle** (CRM, settings, browser pages): nothing to work on.

While a load or fill flow is running, the mode is pinned so a tab switch can't drop it.

**Intake (`PortalFill.tsx`)**

Toolbar, all icon buttons with tooltips:
1. Auto-capture.
2. Ingest.
3. Fill.
4. Fill from CRM.
5. Peek (mapped fields outlined green, unmapped red).

Tabs: Data (N) and Quotes (N).

The Data view, in order:
1. The main Field / Value table, grouped by section.
2. Grid tables (fields with `group = "Row N"`) rebuilt per section, with a Primary column when a row lands on the primary record.
3. **Policy tables:** sections `Opportunity Policy - <Line>` and `Prior <Line> Policy`, holding every value from that page whatever its target, with a "Goes to" column.
4. Secured (masked values only).
5. Timeline entries grouped by target record, then by section.

Load into CRM (`LoadToCrm.tsx`), Export to Excel (`captureSheets.ts`, `xlsx.ts`) and Clear sit below.

**Mappings (`MappingsManager.tsx`, `MapEditor.tsx`, `DataServiceMapEditor.tsx`)**
- Per-site page mapping, with a click-to-map picker (pick on the page, pick a target).
- For EZLynx, a data-service mapping editor (sections Insured / Contacts / Phones / Emails / Addresses) plus "Page fields (not in the data service)".
- `TargetPicker` searches all targets: semantic paths, CRM columns per entity from the live catalog, notes and secured targets.

UI rules: no em or en dashes; no instructional filler text; icon buttons with tooltips.

---

## 4. Core data shapes

All in `src/boldpenguin/types.ts` and `src/types.ts`.

### 4.1 The capture: `CapturedApplication`

There is one per browser session, stored in `chrome.storage.session["bp/capturedApplication"]`.

```ts
interface CapturedApplication {
  schemaVersion: "1.1";
  capturedAt: string;                       // ISO
  source: { system: string; url: string; title: string };  // "EZLynx" or the site hostname
  completion: { likelyCompleted: boolean; matchedPhrases: string[]; hasReviewStep: boolean };
  scannedSections: string[];
  normalized: NormalizedApplication;        // projection of fields, see 4.3
  fields: CapturedAppField[];               // the truth; everything else derives from it
  quotes?: HeldQuote[];                     // quotes held for import
  quoteIssues?: { lob: string; carrierName: string; message: string }[];
  dataService?: { kind: "ezlynx"; run: CapturedRun };  // exact EZLynx rating run (SSN stripped)
}
```

### 4.2 A captured value: `CapturedAppField`

```ts
interface CapturedAppField {
  label: string;     // the page's label ("Prior Carrier"), or a combined one ("Years with Prior Carrier (Month)")
  value: string;     // display text; dates as shown; never SSN
  name?: string;     // control name/id when from a form control
  section: string;   // where it came from: see 4.4
  group: string;     // "" for a single value; "Row N" for the Nth row of a repeated structure
  source: "control" | "choice-group" | "definition-list" | "table" | "review-row"
        | "entity-card" | "money-line" | "sale" | "taught" | "dataservice";
  mapped?: string;   // explicit target path (section 5.2); absent = unmapped page text
}
```

Rules:
- `(section, group, canonical(label))` identifies a field slot. Re-ingesting a slot replaces its value.
- `mapped` routes the value. Unmapped fields are kept for review and export, but only reach CRM through label-alias normalization.
- Identifier-class values are stripped before storage (section 11).

### 4.3 `NormalizedApplication`

`Record<string, Record<string, string | string[]>>`, recomputed from `fields` by `normalize()` (`src/boldpenguin/normalize.ts`). Groups:

- **Semantic:**
  - `business`, `contact` (primary insured), `contact2..N` (related people), `address`, `coverage`, `policy`;
  - `vehicles`, `vehicle1..N`, `employment`, `payroll`, `building`.
- **CRM column groups:**
  - `crm:account`, `crm:primarycontact`, `crm:contact2..N`;
  - `crm:policy1..N`, `crm:address1..N`, `crm:quote`, `crm:opportunity`, `crm:priorcoverage`;
  - asset rows `crm:vehicle1..N`, `crm:watercraft1..N`, `crm:property1..N`, `crm:equipment1..N`, `crm:scheduleditem1..N`;
  - child rows `crm:additionalinterest1..N`, `crm:propertyrenovation1..N`, `crm:propertyloss1..N`, `crm:propertyparty1..N`.
  - Values are raw text; the worker coerces them against the live catalog at write time.

Merges keep values already normalized (agent-reviewed data wins); identifier columns are always removed.

### 4.4 Sections (where a value came from)

`section` is a human-readable table name. Produced by `portal-mapper.js` + `portal-ingest.js`:

- **Titled boxes:**
  - expansion panel, fieldset, mat-card, `.card`, Kendo panelbar;
  - `sectionOf(el)` returns the nearest titled box when it is an expansion panel or nested in another titled box;
  - numbered titles ("Vehicle 2") are not sections, so repeated cards stay one table.
- **Line-of-business steps (EZLynx rating):**
  - the page heading names the line (Auto, Home, Dwelling, Boat, RV, Personal Articles...);
  - the tab title names the step (`"Tracy Dittrich - Policy Info"`).
  - Policy Info step, and new-policy values: `Opportunity Policy - <Line>`.
  - Prior-policy values (prior carrier, prior expiration / limits / term / premium, years with carrier, continuous coverage): `Prior <Line> Policy`.
  - Other steps: `<Line>: <Step>` (`Auto: Drivers`).
- **Data service:** `Insured`, `Contacts`, `Phones`, `Emails`, `Addresses`.
- **Grids:** the grid's caption or nearest preceding title.
- `lineOfSection()` and `otherLine()` in `appCommit.ts` read the line back out, so opportunity notes and Prior Coverage go to the right line's opportunity.

### 4.5 EZLynx run: `CapturedRun` / `CapturedApplicant`

```ts
interface CapturedRun { applicant: CapturedApplicant; openApplicationId: number; capturedAt: string; ratedAt: string | null; blocks: CapturedLobBlock[] }
interface CapturedApplicant {
  ezlynxApplicantId: number; firstName: string; lastName: string; dateOfBirth: string | null;
  dlNumber: string | null; dlState: string | null;   // secured channel only
  ssn?: string | null;                               // secured channel only, stripped before storage
  address: { street; city; state; postalCode } | null;
  phones: { type: string | null; number: string }[]; emails: string[];
  details?: Record<string, string>;                  // gender, marital, occupation, license status, isDriver...
  addresses?: CapturedAddress[];                     // every address, primary first
  morePhones?: CapturedPhone[]; moreEmails?: CapturedEmail[];   // after the primary, with person
  coApplicants: { firstName; lastName; relationship; phone; email; dateOfBirth; dlNumber; dlState; ssn?; details?; extra?; slot? }[];
  isCommercial: boolean;
}
```

`CapturedLobBlock` holds per-line quotes (`CapturedQuote`), carrier errors and carrier underwriting Q&A (`icq`). Drivers found only on the risk application (added on the quote's Drivers step) are added to `coApplicants` by `addDrivers()`, matched by name.

### 4.6 Held quotes: `HeldQuote`

```ts
{
  key: string;                     // "ezlynx:{execId}:req|alt{n}" | "portal:{host}"
  provider: "EZLynx" | "Portal";
  source: string;
  lob: string;
  carrierName: string;
  carrierRef: string | null;       // the source's carrier id
  carrierId: string | null;        // CRM iacrm_carrier for the active environment
  kind: "requested" | "alternate";
  quoteNumber: string | null;
  premium: number | null;
  termMonths: number | null;
  premiumStatus: "estimated" | "firm";
  coverageSummary: string;
  coverageLines: { code; label; limitText }[];
  link: string | null;
  selected: boolean;
}
```

EZLynx carrier ids map to CRM carriers per environment through remembered aliases (`carrierAliases.ts`).

### 4.7 Mapping-editor rows: `PortalScanRow`, `PeekItem`

`PortalScanRow`:
- `{ key, label, type, payment, autoPath, mapped, options? }`;
- `fieldLabel?`, `section?`, `scopes?`;
- `repeats?`: fields on the page sharing this label;
- `repeatSections?`: the section of each;
- `page?`: the step taken from the tab title.

`PeekItem`: `{ key, label, kind: "mapped"|"auto"|"skip", array?, family?, labels? }`.

---

## 5. Mapping system

### 5.1 Storage

- **Page mappings:** `chrome.storage.local["portal/fieldMap"]`: `{ [origin]: { [key]: target | "skip" } }`.
- **Choice mappings:** `["portal/optionMap"]`: `{ [scope]: { [table.column]: { [sourceWording]: crmChoiceValue } } }`. Scope is an origin or `dataservice:<name>`.
- **Data-service mappings:** `["dataservice/fieldMap"]`: `{ ezlynx: { [serviceFieldId]: target } }`. Unset entries use built-in defaults (`effectiveTargets`).
- **Share files:**
  - `fieldMaps.ts` (`parseShareFile` / builders) and `settingsBundle.ts`;
  - JSON with site maps, option maps and data-service maps;
  - secured mappings are never exported;
  - targets are validated on import and invalid ones dropped and counted.

### 5.2 Keys (what a mapping is attached to)

| Key form | Meaning |
|---|---|
| `<controlKey>` | One form control (name/id-based, plus `@section` inside a sub-section). Fills and captures that control. A list target on it names one row (`crm:contact2.*`, the "Row N" selector). |
| `field:[page\|][section>]label` | A labelled field. `page` is the step from the tab title (`drivers`). `section` is a sub-section key; `*kind` matches every section of that kind (Primary / Other Address). With a list target it covers every card or section, one row each, in page order. |
| `pick:<css>` | Read-only text the agent taught (capture only). With a list target it expands to every repeated row. |

When the agent picks a box on repeated cards (2+ fields share the label, differently titled cards) and chooses a list target, the mapping becomes `field:<page>|<label>` ("(every card)"). Saved one-row mappings on such pages convert automatically when the editor opens (`familyKeyOf`, the MapEditor effect).

### 5.3 Targets (what a value is)

| Target | Grammar | Lands on |
|---|---|---|
| Semantic | `business.*`, `contact.*`, `address.*`, `coverage.*`, `policy.*`, `employment.*`, `payroll.*`, `building.*` (see `MAP_PATHS`) | Primary insured / account fields via normalization |
| Semantic list | `contacts[].x`, `vehicles[].x` > rows `contact2..`, `vehicle1..` | Related people, vehicles (risk data) |
| CRM column | `crm:(account\|primarycontact\|quote\|opportunity\|priorcoverage).<column>` | That record's column (validated against the live catalog) |
| CRM list | `crm:(contacts\|policies\|addresses\|vehicles\|watercraft\|properties\|equipment\|scheduleditems\|additionalinterests\|propertyrenovations\|propertylosses\|propertyparties)[].<column>` | One record per row; rows fan into `crm:<slot>N` |
| Note | `note` (account), `note:contact`, `note:contacts[]` (each person's own timeline), `note:opportunity`, `note:quote`, `note:policy` | A rich-text timeline note on that record |
| Secured | `secure:(account\|primarycontact\|contacts[]\|contactN).<column>` | Pass-through to a field-secured column (section 11) |
| Captured label | `label:<canonical label>` | Fill only: the value captured under that label (section-scoped forms like `label:prior auto policy prior carrier`) |
| `skip` / `""` | | Never fill / auto-match |

Row slot rules (`ROW_SLOTS` in `fieldMaps.ts`, `ARRAY_SLOTS` in `portal-ingest.js`; keep them in sync):

| List | Slot | Row 1 is |
|---|---|---|
| `contacts`, `crm:contacts`, `secure:contacts` | `contact`, `crm:contact`, `secure:contact` | slot **2** (slot 1 is the primary insured) |
| `crm:policies` | `crm:policy` | 1 |
| `crm:addresses` | `crm:address` | 1 = the applicant contact's Address 1 (rows 1 to 3 are its Address 1 to 3; 4+ are More Addresses) |
| `vehicles` | `vehicle` | 1 |
| asset and child lists | `crm:vehicle`, `crm:watercraft`, `crm:property`, `crm:equipment`, `crm:scheduleditem`, `crm:additionalinterest`, `crm:propertyrenovation`, `crm:propertyloss`, `crm:propertyparty` | 1 |

The asset and child table registry is `src/portal/assetTables.ts`, a leaf module with no imports to avoid cycles. It holds `ASSET_TABLES`, `CHILD_TABLES`, `ROW_TABLES` and `SLOT_ENTITY`.

### 5.4 Live CRM catalog

`src/crm/fieldCatalog.ts`:
- `CATALOG_ENTITIES` lists what can be mapped.
- `buildFieldCatalog` reads each entity's attribute metadata and keeps writable, non-system, non-lookup, non-calculated columns, excluding the DENY list. Picklists come with their options.
- Identifier-class columns are offered only as secured targets.
- Cached per environment in `chrome.storage.local["crm/fieldCatalog/v7/<envId>"]` for 24 h, re-read sooner when a saved mapping names a missing column.
- Bump the cache version when entities change.

| key | logical | entity set | label |
|---|---|---|---|
| account | account | accounts | Insured (account) |
| primarycontact | contact | contacts | Primary contact |
| contacts | contact | contacts | Contacts (all rows) |
| policies | iacrm_policy | iacrm_policies | Policies (all rows) |
| addresses | customeraddress | customeraddresses | Addresses (all rows) |
| quote | iacrm_quote | iacrm_quotes | Quote |
| opportunity | opportunity | opportunities | Opportunity |
| priorcoverage | iacrm_priorcoverage | iacrm_priorcoverages | Prior Coverage |
| vehicles | iacrm_vehicle | iacrm_vehicles | Vehicles (all rows) |
| watercraft | iacrm_watercraft | iacrm_watercrafts | Watercraft (all rows) |
| properties | iacrm_property | iacrm_properties | Properties (all rows) |
| equipment | iacrm_equipment | iacrm_equipments | Equipment (all rows) |
| scheduleditems | iacrm_scheduleditem | iacrm_scheduleditems | Scheduled items (all rows) |
| additionalinterests | iacrm_additionalinterest | iacrm_additionalinterests | Additional interests (all rows) |
| propertyrenovations | iacrm_propertyrenovation | iacrm_propertyrenovations | Property renovations (all rows) |
| propertylosses | iacrm_propertyloss | iacrm_propertylosses | Property losses (all rows) |
| propertyparties | iacrm_propertyparty | iacrm_propertyparties | Property parties (all rows) |

Verified against DEV on 2026-11-09: all 17 entities resolve, and the contact driver fields are present.

### 5.5 Choice translation

A source's wording ("Separated", "12 Month") maps to the exact CRM choice value per `table.column` (`optionMaps.ts`: `columnKeyOf`, `autoMatchOption`). The agent can override per option in the editor. `translateCapturedChoices` applies this at ingest; `coerceGroup` applies type coercion at write time.

---

## 6. Ingest pipelines

### 6.1 EZLynx (data service)

`panel/portalIngest` on `app.ezlynx.com` runs `ingestEzlynx`:

1. `ezlynx/getContext` on the agent's own EZLynx tab, else the active one, gives the applicant id.
2. `ezlynx/listRuns`, then `ezlynx/captureRun` for the latest rating run. The run includes:
   - the applicant;
   - quote-result blocks per line;
   - carrier Q&A;
   - licenses and drivers from the risk application.
   With no run, `ezlynx/getApplicant` is used instead.
3. `ezlynxFields(applicant, dataServiceMaps)` turns the applicant into fields in sections Insured / Contacts / Phones / Emails / Addresses, each routed by its data-service mapping. Row 0 of Contacts is the applicant (primary); row i is slot i+1.
4. Page fields the agent mapped on EZLynx pages ("Page fields") are harvested from the tab; mapped ones only.
5. `mergeIngestedFields` (6.4). Quotes merge into `quotes`, the run is stored as `dataService` (SSN stripped), and secured values go to the holding area.

### 6.2 Any other site (page harvest)

`ingestPortalTab` injects mapper + fill + ingest into all frames and calls `__bettersPortalIngest(taught, controls)` with the site's mappings. The collector reads:

- **Form controls:** inputs, selects, textareas, comboboxes, checkboxes and switches with their labels. Mapped controls carry `mapped`.
- **Taught picks and labelled fields:**
  - array teachings expand to every row;
  - note teachings take whole grid columns;
  - one-off repeated labels next to different fields ("Month") get combined labels.
- **Grids:**
  - tables with 3+ headers become `Row N` fields;
  - label/value rows, definition lists, review rows and bold-label prose;
  - money lines, "Label: value" lines, and sale facts (policy number, VIN, address, effective dates).

These are excluded: payment fields, consent UI, site chrome, grid chrome, identifier fields (moved to the secured channel only if mapped secured), and notes that look like identifiers.

### 6.3 Auto-capture

`portal-autocap.js` watches for DOM mutations and URL changes, debounced 1.5 s. When the page's value signature changes, it sends `portal/autoCaptured { url }`. The worker (`autoIngest`) runs the real ingest one at a time, with at most one queued follow-up:

- **EZLynx:** the data-service ingest.
- **Other sites:** the page harvest, keeping only mapped, non-empty values.

Turning auto-capture on runs one read immediately and returns any error to the panel. Enabled tabs are listed in `chrome.storage.session["autocap/tabs"]` and re-armed after full page loads.

### 6.4 Merge rules (`mergeIngestedFields`, `src/boldpenguin/ingest.ts`)

1. Sanitize: trim, drop empty values and exact duplicates.
2. **Align people** (`alignPeople`, `people.ts`):
   - each incoming person slot is matched to the held person with the same name (spelling-tolerant, with prefix, email and DOB checks);
   - a row the page flags as primary ("Primary: Yes", type Owner / Named Insured) goes to slot 1;
   - unmatched people take the next free related-contact slot, so there are no gaps;
   - `slotMap` is returned so secured values follow their people.
3. Strip identifier columns from incoming and held fields.
4. **Identity guard:** if the incoming page is a different person, the capture is replaced (`replaced: true`) and the CRM link and secured values are cleared.
5. A re-read slot (`section|group|label`) replaces the held value; new slots are appended.
6. `normalized` is re-merged, with held values winning.

---

## 7. Load into CRM (`LoadToCrm.tsx` + worker routes)

Order:

1. **Find or create the insured account.**
   - `panel/searchAccounts` matches by name + ZIP;
   - or create with `panel/createAccount` (insured type, owner, lead source, address from the chosen Account address).
2. **Insured profile** (`panel/appCommit`, `enrich.ts ensureInsuredData`):
   - fill-if-empty the account (phones, email, address, insured names);
   - match or create the applicant contact and related contacts (by name / phone / email);
   - set the primary contact (an existing primary changes only on an explicit pick);
   - write taught CRM columns per record in hierarchy order;
   - write extra addresses as `customeraddress` rows on the applicant contact (`upsertRecordAddress`, addressnumber N; rows 1 and 2 auto-exist and mirror address1/2);
   - write secured values to their columns.
3. **Opportunity per line:**
   - reuse an open one for the line (`panel/getOpportunities`) or create one (`panel/createOpportunity`) with the line's pipeline stage (`getStagesForLob`);
   - `crm:opportunity` columns ride along as `extra`.
4. **Policies** (`panel/createPolicy`): from `crm:policyN` drafts or a sale page (`policyFromCapture`). Prior-policy values never feed the new policy.
5. **Quotes** (`panel/writeQuotes`): selected held quotes, with carrier, Firm / Estimated, coverage lines and carrier Q&A, each attached to its line's opportunity.
6. **Prior Coverage** (`panel/upsertPriorCoverage`, `dataverse.upsertPriorCoverage`):
   - one record per captured `Prior <Line> Policy` (`priorCoveragesFromCapture`);
   - columns: name `Prior <Line> Policy - <Carrier>`, prior carrier name, policy number, effective and expiration dates, term (298400000 = 6 Month, 298400001 = 12 Month, 298400002 = Other), premium, liability limits, years with carrier, years continuous, source;
   - columns mapped directly to `crm:priorcoverage.*` override the label guess, and unknown ones ride along as `extra`;
   - links: account, that line's opportunity, line of business (by name), carrier (by name, when it is one of the agency's);
   - upsert key: account + line (or name) + carrier + expiration. Same key fills empty columns; a new term or carrier creates a new record.
7. **Assets** (`panel/upsertAsset`, `dataverse.upsertAsset`):
   - each `crm:<asset>N` row becomes one record on the insured (`iacrm_accountid@odata.bind`);
   - match key: VIN, hull ID, address line 1 or serial number, else the name;
   - the name is derived when unmapped ("2019 Honda Civic", the street, maker + model).
8. **Child records** (`panel/upsertChild`, `dataverse.upsertChildRecord`):
   - additional interests attach to the asset's insured item (`insuredItemOf` reads `_iacrm_insureditemid_value`, set by the CRM plug-in);
   - renovations, losses and parties attach to the property;
   - the parent is the asset mapped on the same page section (`rowSections`), else the only candidate; otherwise the row is reported and skipped;
   - upsert key: parent + name.
9. **Timeline notes** (`panel/upsertNote`, `dataverse.upsertRecordNote`):
   - one rich-text note per record per source (`noteHtml`), containing that record's note-mapped values and filtered to the opportunity's line;
   - per-contact notes for `note:contacts[]`;
   - dated subjects: unchanged content writes nothing, the same day updates today's note, a later day creates a new note (history is kept).

Every step reports a result row. Failures don't stop later steps. Optional extra columns that the CRM rejects are retried without them (`withExtrasFallback`). All column writes go through the live catalog and `coerceGroup`; unknown columns are dropped.

Write principles:
- Fill-if-empty (`fillIfEmpty`).
- Never write `iacrm_amsexternalid`, `iacrm_synctoams` or `iacrm_lastsyncon`.
- Lookup bind names differ by table: Prior Coverage uses schema case (`iacrm_AccountId@odata.bind`), the asset tables lower case (`iacrm_accountid@odata.bind`).

CRM read paths:
- `panel/crmSearch` and `panel/crmPull` pull an existing insured into the capture for Fill from CRM (`crmSource.ts`).
- `panel/getCarriers`, `getLobs`, `getStagesForLob`, `searchUsers`.

---

## 8. Fill

`panel/portalFill` injects the filler and fills every mapped control from the capture:
- `PATH` targets come from `normalized`;
- `label:` targets come from captured fields, section-scoped first;
- row targets come from `contactN` and similar slots.

Behaviour:
- Overwrite is off by default, so existing page values are kept.
- Options are matched through choice mappings.
- Auto-advance clicks only Next or Continue, never submit, bind or pay.
- Secured targets are read live from CRM by the worker and typed into the one mapped control; counts only are returned.

Known gaps:
- Styled dropdowns (EZLynx Year/Make/Model) are deferred.
- Driver cards fill by card order, not by name.

---

## 9. Messages

All are in `src/messages.ts` (`PanelRequest`, `BridgeRequest`, broadcasts). Grouped:

- **Environment and auth:** `env/list`, `env/setActive`, `auth/signIn`.
- **Context:** `panel/getPageContext`, `panel/getEzlynxContext`, `panel/getCrmLink`, `panel/securePending`.
- **Capture:** `panel/portalIngest`, `panel/autoCapture`, `panel/bpCapture`, `panel/bpGetCaptured`, `panel/bpClear`, `panel/crmSearch`, `panel/crmPull`, `panel/updateQuote`.
- **Mapping:** `panel/portalScan`, `panel/portalPick`, `panel/portalPickCancel`, `panel/portalPeek`, `panel/portalPeekUnmapped`, `panel/portalChoices`, `panel/saveFieldMap`, `panel/crmFieldCatalog`, `panel/saveCarrierAlias`.
- **CRM writes:** `panel/searchAccounts`, `panel/createAccount`, `panel/appCommit`, `panel/getOpportunities`, `panel/createOpportunity`, `panel/createPolicy`, `panel/createQuote`, `panel/writeQuotes`, `panel/upsertPriorCoverage`, `panel/upsertAsset`, `panel/upsertChild`, `panel/upsertNote`, `panel/createLead`, `panel/findMatches`, `panel/commit`.
- **Lookups:** `panel/getCarriers`, `panel/getLobs`, `panel/getStagesForLob`, `panel/searchUsers`.
- **Fill:** `panel/portalFill`.
- **EZLynx bridge (worker to content script):** `ezlynx/getContext`, `ezlynx/listRuns`, `ezlynx/captureRun`, `ezlynx/getApplicant`.
- **Broadcasts:** `portal/captureUpdated`, `ezlynx/applicantChanged`, and `portal/autoCaptured` (page to worker).

Response envelope: `{ ok: true, data } | { ok: false, error, kind: "session"|"auth"|"normalize"|"unknown", detail? }`.

---

## 10. Storage keys

| Area | Key | Contents |
|---|---|---|
| session | `bp/capturedApplication` | the capture |
| session | `bp/crmLink` | the CRM record the capture came from or was loaded to |
| session | `secure/pending` | secured values held for load/fill (`{ path: value }`), session memory only |
| session | `autocap/tabs` | tab ids with auto-capture on |
| session | `token:<orgUrl>` | OAuth token set per org |
| local | `portal/fieldMap` | page mappings per origin |
| local | `portal/optionMap` | choice mappings per scope |
| local | `dataservice/fieldMap` | data-service mappings |
| local | `crm/fieldCatalog/v7/<envId>` | live column catalog |
| local | `env/list`, `env/active` | CRM environments (default DEV `agentcrmdev.crm.dynamics.com`) |
| local | `panel/selections` | load-flow selections (cleared on environment change) |
| local | `portal/autoAdvance` | fill preference |
| local | carrier aliases | EZLynx carrier id to CRM carrier per org (`carrierAliases.ts`) |

---

## 11. Security and privacy invariants (must hold for every change)

1. **SSN** is never stored in the capture, `normalized`, `dataService.run`, notes, Excel export, share files or the panel; it is shown masked only. It may move only as a secured value to a field-secured CRM column.
2. **License numbers and identifier-class columns** (government ID, `iacrm_driverslicense`, any field-secured column, SSN/ITIN/passport-labelled columns) travel only on the secured channel. They are never plain targets; old mappings are converted by `securedIfIdentifier`, and held captures are scrubbed.
3. **Secured mappings and values** never appear in share files, peek labels, notes or exports.
4. **Payment data** (bank, routing, card, CVV, ACH...) is never captured, filled or mapped.
5. **AMS-owned columns** (`iacrm_amsexternalid`, `iacrm_synctoams`, `iacrm_lastsyncon`) are never written.
6. **AMS isolation:** Prior Coverage, and the planned Policy Driver and Driving Incident tables, never sync to NowCerts (the CRM side enforces this through roles; don't add sync paths).
7. **Auto-advance** never submits, binds or pays.
8. **Identity guard:** one person's page never merges into another person's capture.
9. **Environments:** DEV by default; production only when Nathan configures and promotes it.

---

## 12. Auth and environments

OAuth 2.0 auth-code + PKCE against Entra ID (`src/crm/auth.ts`, `APP_CONFIG`) with `chrome.identity.launchWebAuthFlow`, scope `<orgUrl>/user_impersonation offline_access`, and `prompt=select_account`. Tokens and refresh tokens are cached per org in session storage. Writes that may need interactive sign-in use the long panel timeout. Environments are user-configured (`env/list`); record ids are environment-specific, so selections are cleared on switch.

---

## 13. Conventions and testing

- Tests:
  - `tests/*.test.ts` (Vitest), 313 tests at v0.1.66;
  - page-script tests use `// @vitest-environment jsdom` and load the IIFEs (see `tests/sections.test.ts`);
  - worker routes are tested with stubbed `chrome` (`tests/helpers/chromeStub.ts`) and fetch.
- Each change runs `npx tsc --noEmit -p .`, `npx vitest run` and the dash check, then commit, push and publish (locally).
- Comments explain intent in plain sentences.
- No em or en dashes anywhere.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **CRM schema** (tables, columns, forms, views, roles) is owned by the CRM project (`bettersflyguy/BettersInsuranceCRM`, Git > PR > dev, ADO tracked). This repo writes handoff briefs and builds only against the agreed contract.

---

## 14. Roadmap and known gaps

1. **Policy Driver and Driving Incident:** contract in `docs/crm-handoff-policy-drivers.md`.
   - Person facts stay on contact; per-policy driver role (rating status, SR-22/FR-44 filed, carrier driver number) goes on `iacrm_policydriver`; accidents and violations on `iacrm_drivingincident`.
   - The extension adds "Policy drivers (all rows)" and "Driving incidents (all rows)" targets.
   - Load upserts a Policy Driver per driver row (contact + account + the line's opportunity + line of business) and incidents per contact + type + date.
   - Waiting on the CRM session's report (entity sets, bind navigation names, choice values).
2. **Live verification** of v0.1.59 to v0.1.66 on real EZLynx pages.
3. **Fill by person on driver cards** (match cards to contacts by name).
4. **Not yet covered:** property to opportunity link (N:N `iacrm_property_opportunity`) and vehicle primary driver (`iacrm_primarydriverid`).
5. **Styled-dropdown fill:** deferred until ingestion is validated.
