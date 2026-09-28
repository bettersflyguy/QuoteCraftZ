# EZLynx Quote Bridge — Design

**Date:** 2026-08-15
**Status:** Approved design, pending implementation plan
**Stakeholder:** Nathan Betters
**Repo:** `C:\Projects\EZLynx-Quote-Bridge` (new; ADO project `D365 Insurance CRM`)

## Problem

Betters Agency rates personal lines in EZLynx (the comparative rater) and manages the
book in the D365 Insurance CRM (`BettersInsuranceCRM`, publisher prefix `iacrm_`).
Quote results are re-keyed by hand today. This is slow, error-prone, and means the
CRM's quote comparison and pipeline views run on stale or partial data.

EZLynx does offer a sanctioned enterprise API (OAuth 2.0, via Applied Systems) that
covers applicants and quote results, but it is partner/sales-gated rather than
self-serve. A browser extension using the agent's own authenticated session needs no
vendor negotiation and no per-seat API fee, and works today.

**Noted risk, accepted by the stakeholder:** automated extraction may brush against
EZLynx's terms of service, even though this reads only the agency's own data, on the
agency's own screen, with the agency's own credentials. This is a business call, not a
technical blocker. If EZLynx grants API access later, the normalizer and mapping layers
in this design port to a server-side sync with the panel and Dataverse client unchanged.

## Goals

- One-click import of an EZLynx rate run into the CRM as `iacrm_quote` records.
- Applicant data captured well enough to match (not silently create) the CRM Account.
- Idempotent: re-importing after a re-rate updates rows rather than duplicating them.
- Internal use first; structured so the later Chrome Web Store / Edge Add-ons publish is
  a packaging job, not a rewrite.

## Non-goals

- **No `iacrm_quotecoverage` child rows in v1.** Coverage detail lands as rendered text
  in `iacrm_coveragelimitsummary`, plus the full capture in `iacrm_rawpayload`.
  Structured coverage rows are deferred — see Deferred work.
- No per-vehicle coverage rows. EZLynx's `vehicleCoverageBreakdown` is preserved in
  `iacrm_rawpayload` but not rendered — it is absent for Travelers and for every
  alternate quote.
- ~~No Contact creation or update.~~ **Reversed 2026-08-15 (Nathan):** commit now
  enriches the insured — fill-if-empty on account fields (incl. `iacrm_mobilephone`,
  `iacrm_insuredfirstname/lastname`, the columns the Insured form actually binds) and
  find-or-create Contacts for applicant + co-applicants, applicant set as primary
  contact when none exists. Never overwrites non-empty values.
- No writes back to EZLynx. Read-only against EZLynx, always.
- No AMS (Momentum/NowCerts) involvement. This is a quote-results path, not an AMS sync.
- No commercial lines. `isCommercial` is captured but CL is out of scope for v1.

## Recon findings (2026-08-15, live session, org 62859)

Verified against a real Auto/Home rate run (applicant 219851561, quote 513228997).

### Endpoint map

| Endpoint | Method | Returns |
|---|---|---|
| `/RatingApi/api/quote-result/recent-quotes-for-applicant/{applicantId}` | GET | **Preferred list.** One row per rate run: `applicationId`, `autoApplicantQuoteId`, `homeApplicantQuoteId`, `applicantQuoteId`, `lobs` (`"Auto, Home"`), `created`, `isManualQuote`, `description` |
| `/RatingApi/v1/completed-quotes/agency` | POST `{pageIndex,pageSize}` | Agency-wide fallback list, paged. One row **per LOB**: `applicantQuoteId`, `openApplicationId`, `applicantId`, `created`, `lineOfBusiness`, applicant name, `stateCode`, `zipCode`, quoting user |
| `/RatingApi/v1/applicant/{applicantId}` | GET | Applicant: name, `dateOfBirth`, `primaryAddress` (street/city/state/postalCode/county/lat/long), `phoneNumbers[]`, `emailAddresses[]`, `contacts[]` (co-applicants w/ own address + relationship), `maritalStatus`, `gender`, `assignedTo` (producer), `leadSource`, `isCommercial`, `ratingState` |
| `/RatingApi/api/quote-result/{applicantQuoteId}` | GET | **Array** of LOB blocks |

### `quote-result` shape

```
[ { lob: "Auto", scriptStartTime, scriptResults: [ {
      scriptName, carrier: { id, name, siteUrl, smallImageUrl, crossRefId },
      execId, hasError, errorMessage, execStatusText, execDuration,
      requestedQuotes: [ { quoteNumber, quoteIdentifier, creditScored,
        coverages: [{name, value}], premiumDetails: { premiums: [{lob, term, amount,
        totalPremium}], payments: [...] }, discountsApplied[], underwritingMessages[],
        marketingMessages[], quickAccessUrl, vehicleCoverageBreakdown } ],
      alternateQuotes: [ ...same shape... ] } ] },
  { lob: "Home", ... } ]
```

### Facts that shaped the design

1. **Auth is cookie-session.** A `credentials:'include'` fetch from page context
   succeeds. No bearer token to extract, no interception required — a content script on
   the EZLynx origin can call these endpoints directly on demand.
2. **One rate run spans multiple LOBs.** `quote-result/513228997` returned both an Auto
   and a Home block. `completed-quotes/agency` lists the same run *twice*, once per LOB
   (513228997 = Auto, 513228998 = Home, same millisecond), which would require
   client-side de-duplication. **`recent-quotes-for-applicant` avoids this entirely** —
   it returns one row per run carrying `autoApplicantQuoteId`, `homeApplicantQuoteId`,
   and a combined `lobs` string. It is therefore the preferred list endpoint, with the
   agency-wide one as fallback when no applicant is in context.
3. **No NAIC code anywhere in the payload.** Carrier matching must key on EZLynx's
   `carrier.id` — a stable integer, consistent across LOBs (13 Travelers, 35 Liberty
   Mutual, 348 Nationwide, 692 The Hartford, 7 Foremost ARS, 404 Stillwater).
4. **`quoteNumber` is not an identity.** It is `null` for Liberty Mutual, and Travelers
   returned the *same* `0007684600833` on both its Auto and Home results. `execId` is
   unique per carrier per LOB per run and is the correct key.
5. **Carrier errors are the common case.** 5 of 11 results in the sample run errored
   (Stillwater and Foremost aborted; Nationwide Home refused pending UW review).
6. **Terms vary within a run.** Hartford Auto returned 6 mo; everything else 12 mo.
7. **Alternates are frequent and are what the UI headlines.** 6 of 11 results carried an
   alternate. EZLynx's own screen shows Travelers as $1,798 (the alternate), not the
   $2,273 as-requested premium.
8. **Coverage detail arrives in three distinct structures**, only the first of which is
   in scope:
   - `coverages[]` — flat name/value limits and deductibles, present on **every**
     successful quote in both LOBs. Auto keys: `BI`, `PD`, `UM`, `UIM`, `MP`, `PIP`,
     `PIPDeductible`, `WorkLoss`, `PIPOptions`, `PIPStacking`. Home keys:
     `Dwelling`, `OtherStructures`, `PersonalProperty`, `LossOfUse`,
     `PersonalLiability`, `MedicalPayments`, `Deductible`, `WindDeductible`,
     `TheftDeductible`, `ReplacementCost`, `NumberOfFamilies`.
   - `homeCoveragePremiums[]` — Home only, ACORD codes A–F with per-coverage premium.
     Out of scope; its limits duplicate `coverages[]`.
   - `endorsementPremiums[]` / `vehicleCoverageBreakdown` — out of scope.
9. **Carrier value formatting is inconsistent for identical values.** The same dwelling
   limit came back as `$606,900` (Liberty Mutual), `$606900` (Hartford), and `606900`
   (Travelers). Non-numeric values are meaningful too: `No Coverage`, `Excluded`,
   `INCLUDED`, `One Family`, `1%`, `BASIC+10K MED EXP`. v1 sidesteps this by writing
   values verbatim as text; it becomes a real problem only for the deferred structured
   rows, which is why parsing is deferred with them.
10. **An Auto application endpoint exists but is the wrong source.**
    `GET /RatingApi/v1/auto-risk-application/{applicationId}` returns the coverage-page
    inputs (`coverage.generalCoverage` with display text, `coverage.stateSpecificCoverages[]`)
    plus drivers, vehicles, violations, accidents, and losses. **Evaluated and rejected
    for v1** on two grounds:
    - It returns the *requested* coverage — one set, identical across every carrier row —
      so it cannot show carrier deviations. Nationwide rated property damage at `500000`
      against a request of `No Coverage`; only the results `coverages[]` reveals that.
    - It is unreliable: application `85576023` returned 200 while the newer Auto+Home
      application `85576570` returned **500**. Any use would need a fallback.

    Retained in Deferred work as a source for driver/vehicle detail, which the results
    payload does not carry.

## Architecture

Self-contained MV3 extension. All logic in the extension; no relay, no server, no
CRM-hosted page.

**Stack:** MV3, TypeScript, Vite + `@crxjs/vite-plugin`, React 18, Fluent UI v9 (matches
the CRM's visual language), MSAL Browser for PKCE. One codebase builds both the Chrome
and Edge artifacts; only store listings differ.

### Components

| Component | Context | Responsibility |
|---|---|---|
| `ezlynx/client.ts` | Content script on `app.ezlynx.com` | Calls the three endpoints with the session cookie. The only code that knows EZLynx URLs. |
| `ezlynx/normalize.ts` | Content script | Maps raw EZLynx payloads to the canonical `CapturedRun` shape. The only code that knows EZLynx's wire format. |
| `worker.ts` | Service worker | Entra token acquisition and refresh, all Dataverse HTTP, session state. Assumes it is killed every 30s idle — nothing survives in memory; state lives in `chrome.storage.session`. |
| `crm/dataverse.ts` | Service worker | Typed Dataverse Web API client: search, `$batch` upsert, retry/backoff. |
| `panel/` | Side panel | React UI: pick run, match Account, pin Opportunity per LOB, map carriers, review, commit. |
| `config/` | — | `endpoints.json` (EZLynx URL patterns), tenant ID, client ID, and the **environment list** (see below). Shipped as data with defaults, overridable in options. |
| `crm/environments.ts` | Shared | Named environment registry, active-environment state, per-org token cache keying. |

Keeping EZLynx knowledge confined to `client.ts` + `normalize.ts` + `endpoints.json` is
what makes a EZLynx-side change a small, well-bounded edit. The panel and the Dataverse
client never see a raw EZLynx object.

### Auth

Multi-tenant Entra app registration, SPA platform, redirect URI
`https://<extension-id>.chromiumapp.org/`. Delegated scope
`https://<org>.crm.dynamics.com/user_impersonation`, acquired via
`chrome.identity.launchWebAuthFlow`, refreshed silently. Writes are attributed to the
signed-in agent and their security roles apply. No service principal, no stored secret.

**The Dataverse scope names the environment.** A token issued for
`agentcrmdev.crm.dynamics.com` is not valid against any other org, so the extension must
resolve its active environment before it can request a token at all. Tokens are cached
**per org** in `chrome.storage.session`, keyed by org URL — switching environments never
reuses a stale token, and switching back does not force a fresh interactive sign-in
inside the same session.

**Access gate:** the signed-in agent needs a Dataverse security role *in the targeted
environment*. This is a rollout consideration in Phase 5 — an agent added to the tool
must exist in whichever org it is aimed at.

### Environments

Environment is a first-class switchable setting, not a build-time constant.

- **Named environment list** in options: display name, org URL, and a colour token.
  Ships with `Dev — agentcrmdev.crm.dynamics.com` and an empty Production slot.
- **Active environment persists** across sessions in `chrome.storage.local`.
- **Always visible.** The panel header shows the active environment name, colour-coded,
  at all times — not only while the picker is open.
- **The commit button names the target**: "Write 6 quotes to **DEV**". The agent cannot
  reach a write without the destination being on the button they press.
- **Switching environments clears the pinned CRM target** (Account, Opportunities,
  carrier map results), because those record IDs are meaningless in another org. The
  captured EZLynx run survives — only the CRM-side selections reset.

Rationale: DEV is the target through Phase 5 and prod thereafter, with DEV still wanted
for testing afterward. A baked constant would need a rebuild to switch, and the real
failure it invites is silent — a real client's quotes written to DEV, or test quotes
written to prod, with nothing on screen naming the destination.

### Known risk — resolve first

**Dataverse Web API CORS from a `chrome-extension://` origin.** Microsoft documents CORS
support for SPAs; extension origins are an edge case not verified. Phase 0 exists to
answer this before anything else is built. If it fails, Approach A needs a relay and the
design returns for revision.

## Data flow

```
completed-quotes/agency ─┐
applicant/{id} ──────────┼─► normalize ─► CapturedRun ─► panel review ─► $batch upsert
quote-result/{id} ───────┘                (session storage)              (Dataverse)
```

### Panel flow

1. **Pick the rate run.** When an applicant is in context (the normal case — the agent
   is on an EZLynx applicant page), runs come from
   `recent-quotes-for-applicant/{applicantId}`, newest first, showing LOBs and date, one
   row per run. With no applicant in context, falls back to `completed-quotes/agency`
   and collapses rows sharing `applicantId` + `created`.
2. **Applicant → Account.** Search Dataverse by name, narrow on postal code. Ranked
   matches shown with address and open-opportunity count. **Create-new is an explicit
   button, never automatic** — a wrong-account write is the expensive failure, and
   silent creation is how books get duplicated.
3. **Pin one Opportunity per LOB block.** Auto results to the Auto Opportunity, Home to
   the Home Opportunity. Open Opportunities on the matched Account, ranked by LOB match.
   A LOB block with no pinned Opportunity is skipped, not blocked — the agent can import
   Auto today and Home tomorrow.
4. **Map carriers.** Match on `carrier.id` against a local alias map; unmatched carriers
   get a picker, and the choice persists so each carrier is mapped once, ever.
5. **Review and commit.** Editable grid, per-row deselect, then write. The active
   environment is shown in the header throughout, and the commit button names the
   destination ("Write 6 quotes to **DEV**").

### Write

One `$batch` per import, non-atomic (`Prefer: odata.continue-on-error`) so a single bad
row does not sink the rest. Each row is an upsert on the existing alternate key
`iacrm_quote_provider_amsexternalid` = (`iacrm_provider`, `iacrm_amsexternalid`).

- Requested quote → `iacrm_amsexternalid = "ezlynx:{execId}:req"`
- Alternate quote *n* → `iacrm_amsexternalid = "ezlynx:{execId}:alt{n}"`

Both requested and alternate quotes are written as separate `iacrm_quote` records
(decision, 2026-08-15). The suffix is required because a carrier's requested and
alternate quotes share one `execId`.

### Field mapping

| CRM field | Source |
|---|---|
| `iacrm_quote_name` | `{Carrier} – {LOB} – {EffectiveDate}`, suffixed ` – Alt` for alternates |
| `iacrm_provider` | literal `EZLynx` *(key half)* |
| `iacrm_amsexternalid` | `ezlynx:{execId}:req` / `:alt{n}` *(key half)* |
| `iacrm_sourcetype` | `Comparative Rater` (100000002) |
| `iacrm_status` | `Quote Received` (738590002) |
| `iacrm_premium_status` | `Estimated` (738590000) — **hardcoded, never derived** (see invariant below) |
| `iacrm_carrierid` | `carrier.id` → alias map → `iacrm_carrier` |
| `iacrm_premium` | `premiumDetails.premiums[].totalPremium` |
| `iacrm_term` | `premiums[].term` → 6 Months (738590203) / 12 Months (738590205) |
| `iacrm_effectivedate` | EZLynx effective date, else Opportunity `iacrm_desiredeffectivedate` |
| `iacrm_expirationdate` | effective date + term |
| `iacrm_coveragelimitsummary` | rendered coverage text — see Coverage summary (5000 char cap) |
| `iacrm_quotelink` | `/web/account/{applicantId}/rating/quote-results/{openApplicationId}/{applicantQuoteId}` |
| `iacrm_rawpayload` | normalized capture JSON (1 MB cap) |
| `iacrm_opportunityid` | pinned Opportunity for that LOB block **(required)** |
| `iacrm_accountid` | matched Account |
| `iacrm_lineofbusinessid` | inherited from the pinned Opportunity |
| `iacrm_quotingmethodid` | `iacrm_quotingmethod` = EZLynx |
| `iacrm_submissionid` / `iacrm_submissionlineid` | **null** — these are carrier-direct rater quotes with no submission |

`iacrm_rawpayload` is load-bearing: if a mapping proves wrong months from now, the
original capture is on the record and can be re-derived without re-rating in EZLynx.

### Invariant: premium status is always Estimated

A EZLynx result is a comparative-rater indication, never a bound or carrier-confirmed
premium — including results carrying a carrier quote number, and including the
`Paid-In-Full` and packaged variants. **`iacrm_premium_status` is written as `Estimated`
(738590000) unconditionally.** It is not derived from any EZLynx field, and the
extension never writes `Firm` (738590002) under any condition. A premium becomes Firm
only through carrier confirmation outside this pipeline, and that transition stays a
human action in the CRM — the extension must not overwrite it on re-import.

Consequence for re-import: the upsert payload omits `iacrm_premium_status` when the
target row already exists and its value is `Firm`, so a re-rate never downgrades a
premium an agent has already confirmed.

### Coverage summary

v1 writes coverage detail as **rendered text into `iacrm_coveragelimitsummary`** on the
quote — the COVERAGE cell of the Quotes (Quick Compare) matrix. No child rows, no CRM
schema change, nothing blocking on the CRM repo.

The rendering mirrors what EZLynx shows the agent, one coverage per line:

```
{label}: {limits}: {amountText}
```

| LOB | Source arrays | Label |
|---|---|---|
| Home | `homeCoveragePremiums[]` then `endorsementPremiums[]` | `Cov {code}` for A–F; `name` for endorsements |
| Auto | `coverages[]` | `name` (`BI`, `PD`, `UM`, …) |

Both sources are **per carrier**, taken from that carrier's own result. This is
deliberate: it shows what each carrier actually rated rather than what was requested,
so a deviation is visible in the comparison matrix instead of hidden behind a single
requested set repeated on every row. Auto renders as `BI: 500 CSL`, `PD: No Coverage` —
two segments rather than Home's three, since `coverages[]` carries no premium column.

Producing, for a real Home quote:

```
Cov A: $293000: INCLUDED
Cov B: $29300: INCLUDED
Cov C: $219750: INCLUDED
Cov D: INCLUDED: INCLUDED
Cov E: $500000: INCLUDED
Cov F: $5000: INCLUDED
Deductible: $2500: INCLUDED
WindDeductible: $5000: INCLUDED
IdentityTheft: INCLUDED: $45
WaterBackup: INCLUDED: $52.09
```

Values are written **verbatim as EZLynx returns them** — no parsing, no normalizing, no
currency reformatting. Finding #9's inconsistent formatting is therefore not a v1
problem: text is text. It becomes a problem only when structured rows arrive, which is
why parsing is deferred with them.

Home renders endorsements because they are what differentiates two home quotes at
similar premium — `IdentityTheft` at $45 and `WaterBackup` at $52.09 are the kind of
line an agent compares on. Auto has no endorsement array; `coverages[]` is the whole of
its detail.

Field cap is 5000 characters; a rendered Home quote runs ~400. Truncation is not a
realistic concern, but the renderer truncates on a line boundary with a trailing `…` if
it ever approaches the cap.

`iacrm_rawpayload` still carries the complete capture, including
`homeCoveragePremiums[]`, `endorsementPremiums[]`, `coverages[]`, and
`vehicleCoverageBreakdown` — so deferring structured rows loses no data, and the
backfill when they arrive needs no re-rating in EZLynx.

## Error handling

| Failure | Behavior |
|---|---|
| Carrier returned an error (`hasError`) | **Skipped — nothing written.** Panel shows a "5 carriers returned no quote" line with each carrier's message so the agent knows the import was not lossy. |
| EZLynx payload fails schema validation | Fail loud. Panel shows "couldn't read EZLynx results — extension needs an update" with the unrecognized payload copyable. **Never** partial-writes a half-parsed run. |
| EZLynx session expired | Panel prompts the agent to re-authenticate in the EZLynx tab; no captured state is lost. |
| Entra token expired / consent revoked | Silent refresh; on failure, panel drops to a sign-in button. Captured run survives in session storage. |
| Dataverse write rejected (validation, privilege) | Per-row status in the panel; failed rows stay selected for retry. |
| Dataverse 429 | Honor `Retry-After` with exponential backoff. |
| Agent has no security role in the active environment | Message names the environment explicitly — "your account has no access to **DEV**" — rather than a bare 401/403. The most likely cause is a wrong active environment, so the message offers the environment switcher directly. |
| Carrier unmatched | Row writes with `iacrm_carrierid` null and a visible warning. A quote with a premium and no carrier link beats no quote. |
| No Opportunity pinned for a LOB block | That block is skipped; others still import. |

## Testing

- **Vitest over the normalizers**, driven by captured payload fixtures — real EZLynx
  responses scrubbed of PII in `tests/fixtures/`. This is the layer that will break, so
  this is the suite that matters. The Hinrichs Auto/Home run is fixture #1: it covers
  multi-LOB, alternates, mixed terms, null `quoteNumber`, duplicate `quoteNumber` across
  LOBs, and 5 distinct carrier error modes.
- **Coverage rendering tests** assert the Home path (`homeCoveragePremiums[]` then
  `endorsementPremiums[]`, `Cov A`–`Cov F` labels) and the Auto path (`coverages[]`),
  and that values pass through **verbatim** — a test that `$606,900` is not silently
  reformatted to `606900` is the one that catches a well-meaning normalizer being added
  later.
- **Mapping tests** assert the field table above, including both key-suffix forms.
- **One Playwright end-to-end** against a DEV Opportunity, run manually before each
  release. Not in CI.
- **No mocked-Dataverse integration tests** — they would test the mock.

## Phasing

| Phase | Work | Gate |
|---|---|---|
| **0** | CORS spike: PKCE sign-in + one authenticated `GET /api/data/v9.2/accounts?$top=1` from a `chrome-extension://` origin. Also asserts (a) SSO pass-through — whether an existing Entra session in the profile satisfies `launchWebAuthFlow` without re-entering credentials, in **both** Chrome and Edge, and (b) that a second token for a different org URL can be acquired in the same session | **Blocks everything.** ~1 hr |
| **1** | Recon | ✅ Complete 2026-08-15 |
| **2** | EZLynx client + normalizers + fixtures + unit tests | Verifiable with zero CRM writes |
| **3** | Entra app registration, token handling, Dataverse client, `$batch` upsert, carrier alias map | |
| **4** | Side panel UI (Fluent v9, five-step flow) | |
| **5** | Internal rollout: unpacked/private install, real quotes into DEV, then live | |
| **6** | Store readiness — privacy policy, listing assets, multi-tenant admin consent, Chrome Web Store + Edge Add-ons review | Deferred until internal use has settled |

## Deferred work

**Structured coverage rows (`iacrm_quotecoverage`).** v1 ships coverage as rendered
text. Breaking it into child rows is what enables sorting, filtering, and side-by-side
coverage comparison across carriers — worth doing, but not worth blocking v1 on.

Deferred because it is **cross-repo**: `iacrm_quotecoverage` is presently a four-column
stub (`iacrm_quotecoverage_name`, `iacrm_amsexternalid`, `iacrm_lastsyncon`,
`iacrm_lineofbusinessid`) with **no lookup to `iacrm_quote`**. It would need, in
`C:\Projects\D365-CRM-V3` under that repo's ALM contract:

| Column | Type | Notes |
|---|---|---|
| `iacrm_quoteid` | Lookup → `iacrm_quote` | Required. Cascade **Parental**. |
| `iacrm_coveragecode` | Text (50) | Raw EZLynx key |
| `iacrm_limittext` | Text (100) | Verbatim value |
| `iacrm_limitvalue` | Decimal | Nullable — null for `No Coverage`, `INCLUDED`, `1%` |
| `iacrm_displayorder` | Whole number | |
| alternate key | (`iacrm_amsexternalid`) | Upsert without a pre-read |

When it lands, the extension side adds: a limit parser handling finding #9's format
variants, child upsert keyed `{parent quote key}:cov:{code}`, and orphan deletion so a
coverage dropped on re-rate does not leave a stale row implying coverage that no longer
exists.

**Backfill is possible without re-rating** — `iacrm_rawpayload` holds the complete
original capture on every quote already written, so historical quotes can be expanded
into rows retroactively.

**Driver / vehicle detail.** `GET /RatingApi/v1/auto-risk-application/{applicationId}`
carries `drivers`, `vehicles`, `vehicleAssignments`, `accidents`, `violations`, and
`comprehensiveLosses` — none of which appear in the results payload. If the CRM ever
wants risk detail alongside quotes, that is the source. It needs a fallback path: the
endpoint returned 500 for at least one real application during recon.

`iacrm_policycoverage` already carries `iacrm_sourcequotecoverageid`, so quote→policy
coverage lineage on bind works the moment these columns exist. No extra relationship.

## Open items

- **Production org URL.** The environment list ships with DEV
  (`agentcrmdev.crm.dynamics.com`) as the default active environment and an empty
  Production slot. The prod URL is needed before Phase 5 cutover, not before Phase 3 —
  the switchable-environment design removed this as a build-time blocker.
- **Carrier alias map seeding.** The six carrier IDs observed are a starting set; the
  full map builds up as agents encounter carriers. No pre-seeding planned.
- **SSO pass-through behavior.** Assumed to work from an existing profile session;
  Phase 0 verifies in Chrome and Edge. If it does not, the agent faces an interactive
  sign-in per session — annoying but not blocking, and worth knowing before Phase 4.

## Decisions log

| Date | Decision |
|---|---|
| 2026-08-15 | Capture scope: applicant + rating results; no coverage drill-down |
| 2026-08-15 | Ingest path: direct Dataverse Web API via Entra PKCE (no relay, no staging table) |
| 2026-08-15 | Trigger: start in EZLynx, pick CRM target in the panel |
| 2026-08-15 | Extraction: active fetch of EZLynx's JSON API (revised from interception after recon proved cookie-session auth) |
| 2026-08-15 | Distribution: internal first, store-ready structure, publish deferred |
| 2026-08-15 | No submission/submissionline — carrier-direct rater quotes attach straight to the Opportunity |
| 2026-08-15 | Requested and alternate quotes both written, as separate records |
| 2026-08-15 | Errored carriers skipped, surfaced as a count with messages *(assumption — confirm)* |
| 2026-08-15 | Premium status is always `Estimated`, never derived, never downgrades an agent's `Firm` on re-import |
| 2026-08-15 | Environment is a switchable first-class setting — named list, per-org token cache, always-visible colour-coded indicator, destination named on the commit button |
| 2026-08-15 | Coverage detail captured as **rendered text in `iacrm_coveragelimitsummary`**, not child rows. Home from `homeCoveragePremiums[]` + `endorsementPremiums[]`, Auto from `coverages[]`. Values verbatim, no parsing. Removes the cross-repo CRM schema dependency from v1 entirely |
| 2026-08-15 | Structured `iacrm_quotecoverage` rows deferred — `iacrm_rawpayload` makes backfill possible without re-rating |
| 2026-08-15 | Auto coverage sourced from results `coverages[]` (per carrier), not `auto-risk-application` (requested set) — per-carrier shows deviations, e.g. Nationwide rating PD at 500000 against a request of No Coverage |
| 2026-08-15 | `recent-quotes-for-applicant` is the preferred run list; `completed-quotes/agency` is the no-applicant-context fallback |
| 2026-08-15 | Servicing agent: required owner picker, sticky per-env default, always overridable |
| 2026-08-15 | Panel creates insureds and per-LOB opportunities via API — explicit buttons, never automatic |
| 2026-08-15 | Quoting method resolve-or-create per org; effective date falls back to rate-run date |
| 2026-08-15 | **Non-goal reversed:** insured enrichment at commit — fill-if-empty account fields + find-or-create contacts, applicant as primary. Agent-entered data always wins |
| 2026-09-25 | **Bold Penguin merged as source adapter #2** (from the "Betters Application Assistant" concept, C:\Projects\Betters Insurance Agency Application Assistant): commercial-application DOM capture (`src/boldpenguin/`, TS port, declared content script) + on-demand carrier-portal fill (`public/portal/*.js`, plain UMD scripts injected via `chrome.scripting` after a per-origin `chrome.permissions.request` at click time). Panel switches mode by active tab; capture held in `chrome.storage.session` only. Concept's webhook forwarding dropped (CRM is the destination; JSON download retained). CRM write of the captured application (account match/enrich + `iacrm_riskanswer` upserts under provider `boldpenguin`) deferred to the risk-data architecture phases |
| 2026-09-25 | **Portal ingest**: the portal card offers "Ingest this page" on any eligible carrier site (https, not EZLynx/BP/Dynamics/login) — a generic visible-data harvester (`public/portal/portal-ingest.js`) injected after the same per-origin grant as fill; worker normalizes and MERGES into the held application (`src/boldpenguin/ingest.ts`): dedupe by section/group/label/value, existing normalized values always win, capture identity (source.system) survives later ingests. Ingest→fill round-trips insured data between any two carrier sites |
| 2026-09-25 | **CRM load for captured applications** (deferral reversed): "Load into CRM" on both the Bold Penguin and carrier-portal cards. Pick/create the insured Account (search prefilled from the capture), then worker `panel/appCommit` runs the existing enrichment (fill-if-empty + find-or-create contacts via `applicantFromCapture`) and logs every captured field to the knowledge tables (`src/crm/appCommit.ts`): question rows `capture:{canonicalLabel}`, answer rows `capture:{accountId}:{canonicalLabel}` — re-loads update, never duplicate. No opportunity/quote rows yet — insured + risk data only |
| 2026-09-26 | **Sale-screen policy capture**: normalizer gains `policy.number`/`policy.premium`; a captured policy number flags the ingest as a sale and pre-checks "Create policy" on the CRM load review — editable number/premium/effective/expiration, carrier dropdown (preselected from the source host), LOB (falls back to the opportunity's). `createPolicy` writes `iacrm_policies` as **Active**, bind date today, bound to InsuredId/CarrierId/LineOfBusinessId and the just-created OpportunityId (all schema-cased, metadata-verified). Full-site walker adapters for FAO/GEICO/Tivly remain pending live-tab mapping — generic ingest stays per-page by the never-click-Next safety rule |
| 2026-09-26 | **Passive auto-capture** replaces per-page Ingest clicking AND the planned per-site walkers: one click arms an observer on the granted tab (MutationObserver + URL poll, 1.5s settle) that harvests each page the AGENT navigates to and merges it worker-side (identity guard included), with live field-count updates in the panel. Chosen over synthetic navigation because it can never touch the carrier's form; survives full page loads via worker re-injection (tabs.onUpdated), stops on tab close |
| 2026-09-26 | **CRM as a fill source**: "Fill from CRM…" on the portal card searches accounts + contacts, pulls the pick's profile (account + primary contact + logged iacrm_riskanswer rows, best-effort on custom pieces) into the held application via the same merge/identity-guard path (`src/crm/crmSource.ts` builds normalizer-aliased fields), then Fill populates any carrier quote sheet. Round trip complete: portal → CRM (load) and CRM → portal (fill) |
| 2026-09-28 | **Portal quote capture -> iacrm_quote**: a captured premium with no policy number pre-checks "Create quote on an opportunity" (premium/carrier/LOB editable, coverage summary from $-valued and coverage-labeled fields verbatim). Picking the insured then offers the account's open opportunities or create-new; quote upserts with provider "Portal", alt key {host}:{opportunityId} (re-captures update), status Quote Received, premium status Estimated, source type unset (carrier direct), quotelink = portal URL |
