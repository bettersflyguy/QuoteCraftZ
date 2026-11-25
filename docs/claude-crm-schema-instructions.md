# Claude instructions: QuoteCraftZ CRM schema and import gaps

Prepared for Nathan Betters, 2026-11-25. This is the current implementation handoff. It supersedes the **create** recommendations in older QuoteCraftZ handoffs wherever the dispositions below differ. Historical audit documents remain evidence, not a current deployment checklist.

## Assignment and evidence

Implement the missing representations below on the existing CRM tables, expose them to QuoteCraftZ, and replace temporary notes only after typed writes and read-back succeed. Do not create a second Contact, Vehicle, Property, coverage or driver-assignment table.

Evidence used:

- QuoteCraftZ baseline: `925eb2999e736b97dbec4f891929e821cbc06868`, branch `codex/one-lead-capture`, repository <https://github.com/bettersflyguy/QuoteCraftZ>.
- Canonical CRM source inspected: `b76c53f68ac03df076aecad766f554f1a0b6f2b2`, repository <https://github.com/bettersflyguy/BettersInsuranceCRM>. Pull current `dev` before implementing; this commit is an evidence baseline, not an instruction to roll back later work.
- Read-only production metadata check on 2026-11-25: `https://bettersinsurance.crm.dynamics.com`. Contact, Vehicle and Property attribute names, labels, descriptions and types were retrieved; Property foundation/siding/residence choices and Quote attribute existence were checked separately. The six columns in section 1 were absent on the intended tables, including differently named candidates found through their labels/descriptions. This was not a fresh full-environment structural audit of every table.
- The five Property definitions and one Quote definition in section 3 exist in canonical Git XML but were absent from those production attribute responses. **Git existence is not deployment evidence.** Current dev was not inspected during this handoff.
- Source coverage and current fallback details: `docs/pl-rater-mapping-gaps.md`, `public/mappings/quotecraftz-pl-rater.json`, its generator `scripts/build-pl-rater-mappings.mjs`, and `docs/crm-handoff-field-gaps.md` with its dated EZLynx inventories. These cover observed forms and known conditional controls, not every future state/carrier/product.

All names and limits for **new** columns below are proposed implementation specifications, not claims that those definitions already exist. Recheck current dev/canonical metadata for an equivalent before creating. If an equivalent has appeared, document its exact name, type, semantics and limits and use it; do not create both. Every final disposition must say **CREATE**, **REUSE**, **DEPLOY EXISTING**, or **EXTEND CHOICES**, never “create/reuse.”

## 1. CREATE: six confirmed Contact/Vehicle gaps

Use the existing `iacrm` publisher. Proposed schema names equal the logical names shown, matching the existing lowercase convention. Use English display labels and copy the descriptions verbatim into attribute metadata. All six columns are optional, audited and editable/readable through the API. Integer fields have format None and precision zero. No zero/No default should turn an unasked answer into an asserted answer. Character limit is **not applicable** to integers, Boolean or Choice columns; their constraints are given instead.

| Target table | Display name / proposed logical and schema name | Dataverse type and constraints | Description to include in field schema | Source and current fallback |
| --- | --- | --- | --- | --- |
| Contact `contact` | Years at occupation — `iacrm_yearsatoccupation` | Whole Number; minimum 0, maximum 100; character limit N/A; no default | Completed years the person has worked in their occupation, across employers. Distinct from years with the current employer and years with a prior employer. Preserve an unasked or unknown answer as blank; zero means less than one completed year. | PL Rater driver `rniYearsAtOccupation`; matching primary/additional contact timeline data. Do not reuse `iacrm_yearsemployed` or `iacrm_prioryearsemployed`. |
| Vehicle `iacrm_vehicle` | License plate number — `iacrm_licenseplatenumber` | Single Line of Text, Text format, **30 characters** | Vehicle registration plate identifier as supplied by the source, including meaningful letters, digits, spaces and punctuation. Distinct from VIN and registration state. Preserve leading zeros; do not store as a number. Blank means not supplied. | PL Rater License Plate Number; matching vehicle timeline data. Existing registration state/expiry do not hold the identifier. |
| Vehicle `iacrm_vehicle` | Ownership years — `iacrm_ownershipyears` | Whole Number; minimum 0, maximum 150; character limit N/A; no default | Completed years the current owner has owned this vehicle at the time of capture. Used with Ownership months for the source-reported ownership duration. Distinct from owned, financed or leased status. Do not infer from model year or purchase date. Blank means not supplied. | PL Rater Length of Ownership, Years; matching vehicle timeline data. |
| Vehicle `iacrm_vehicle` | Ownership months — `iacrm_ownershipmonths` | Whole Number; minimum 0, maximum 11; character limit N/A; no default | Additional completed months after Ownership years in the source-reported vehicle ownership duration. Valid values are zero through eleven. Do not store total months here or infer a missing component. Blank means not supplied. | PL Rater Length of Ownership, Months; matching vehicle timeline data. |
| Vehicle `iacrm_vehicle` | Four-wheel drive — `iacrm_fourwheeldrive` | **Choice**, single select: Yes `298400000`, No `298400001`, Unknown / not asked `298400002`; character limit N/A; no selected default | Whether the source explicitly identifies this vehicle as four-wheel drive. Do not infer from make, model, trim or an all-wheel-drive label. Preserve an unasked or unknown answer separately from No. | PL Rater 4 Wheel Drive; matching vehicle timeline data. |
| Vehicle `iacrm_vehicle` | Company car — `iacrm_companycar` | **Choice**, single select: Yes `298400000`, No `298400001`, Unknown / not asked `298400002`; character limit N/A; no selected default | Whether this vehicle is explicitly identified as a company car. Distinct from vehicle use, ownership status, carpooling and transportation-network-company use. Preserve an unasked or unknown answer separately from No. | PL Rater Company Car; matching vehicle timeline data. |

The older PL Rater gap list called the last two fields Yes/No. This handoff deliberately specifies three-state Choices, following the existing Property intake pattern, so unknown is representable. Update the extension catalog and explicit checkbox/choice transforms accordingly. An unchecked checkbox is No only when the source actually provides a completed answer, not merely because a new form starts unchecked. Never silently truncate overlength text or clamp out-of-range numbers: keep the raw scoped fallback and report validation failure.

Ownership duration is a captured assertion and will age; do not run a job that increments these components. If the CRM team instead adopts a dated ownership-history model, record that decision and its exact capture-date contract before replacing these two proposed fields.

## 2. CREATE: proposed Property representations for known semantic gaps

These are additional design proposals supported by observed source mismatches. They are not delivered schema. Refresh metadata and check alternative property attributes before authoring. Keep source-specific text where a complete cross-service vocabulary has not been established; do not manufacture a supposedly complete ACORD Choice list from one screen.

| Target table | Display name / proposed logical and schema name | Type and limits | Description to include in field schema | Current fallback / reason existing field is unsuitable |
| --- | --- | --- | --- | --- |
| Property `iacrm_property` | Foundation construction type — `iacrm_foundationconstructiontype` | Single Line of Text, Text format, **100 characters**, optional, no default | Source-reported physical foundation construction, such as slab, basement or crawlspace. Preserve the original description. Distinct from the Open, Closed or None foundation classification. Blank means not supplied; do not infer one classification from the other. | Property-scoped notes where no safe typed mapping exists. Live `iacrm_foundation` options are Open `298400000`, Closed `298400001`, None `298400002`; these do not mean slab/basement/crawlspace. Recheck the current PL Rater foundation binding against its actual source options before leaving any typed conversion enabled. |
| Property `iacrm_property` | Fire hydrant distance range — `iacrm_firehydrantdistancerange` | Single Line of Text, Text format, **100 characters**, optional, no default | Source-reported distance band to a fire hydrant, preserving its unit and inclusive or exclusive wording, for example 1–500 feet. Distinct from a measured exact distance. Do not convert a range boundary or midpoint into an exact distance. Blank means not supplied. | Property-scoped notes for range answers. Existing `iacrm_distancetofirehydrantfeet` is an exact Whole Number; retain it for actual exact measurements. |
| Property `iacrm_property` | Hot tub present — `iacrm_hottubpresent` | Choice: Yes `298400000`, No `298400001`, Unknown / not asked `298400002`; character limit N/A; optional; no selected default | Whether a hot tub or Jacuzzi is explicitly reported at the property. Presence does not establish the number of units. Preserve an unasked or unknown answer separately from No. | PL Rater `chkHotTub` currently goes to Property 1 notes. Existing `iacrm_jacuzzis` is a count. Never convert Yes into a count of one. |
| Property `iacrm_property` | Guarded community — `iacrm_guardedcommunity` | Choice: Yes `298400000`, No `298400001`, Unknown / not asked `298400002`; character limit N/A; optional; no selected default | Whether the property is explicitly reported as being in a guarded community. Distinct from gated or limited-access community, twenty-four-hour security and a count of guards or watchmen. Preserve an unasked or unknown answer separately from No. | PL Rater `chkGuarded` currently goes to Property 1 notes. Existing `iacrm_guardsorwatchmen` is a count, not community presence. |

Enable auditing for these four proposed additions. Do not change the types or meanings of the existing foundation, exact-distance or count columns to accommodate these sources.

**Exterior walls is a mapping/choice review first, not an automatic new field.** Live Property `iacrm_siding` already has Aluminum Siding, Stucco, Vinyl or Plastic, Cedar or Wood Shingle, EIFS on cinder block, EIFS on studs and Other. Reuse that field for equivalent material answers and extend its vocabulary only for reviewed missing meanings. `iacrm_walls` is Boolean and must not receive a material name. Preserve unmatched material text in the property's notes until the crosswalk is approved.

## 3. DEPLOY EXISTING: definitions already in Git, absent from checked production

Do not author alternative columns. Inspect dev and the release history, then deliver the existing canonical definitions through the authorized release path. These are single-select Choices, optional, audited, with no selected default. Character limit is N/A; labels below are the existing option vocabulary, not text-column lengths. Preserve the existing numeric option values from XML.

| Target | Existing field / display name | Existing choices | Existing schema description / current fallback |
| --- | --- | --- | --- |
| Property | `iacrm_dwellingtype` — Dwelling type | One Family; Two Family; Three Family; Four Family | `QuoteCraftZ intake. Dwelling type. Do not infer an unasked answer.` Property notes until deployment/mapping acceptance. Distinct from Residence type. |
| Property | `iacrm_roofdesign` — Roof design | Dormer; Flat; Gable; Gambrel; Hip; Mansard; Other; Pyramid; Shed; Turret | `QuoteCraftZ intake. Roof design. Do not infer an unasked answer.` Property notes or unverified typed targets depending on saved site configuration; verify actual read-back. |
| Property | `iacrm_firedetectiontype` — Fire detection type | Central; Direct; Local | `QuoteCraftZ intake. Fire detection type. Do not infer an unasked answer.` Property notes. Distinct from smoke-detector type. |
| Property | `iacrm_animalsonpremises` — Animals on premises | None; 1; 2; 3 | `QuoteCraftZ intake. Animals on premises. Do not infer an unasked answer.` Property notes. The existing numeric-looking choices are not a general Yes/No answer; do not map Yes to 1 or infer a quantity. Review any count outside the current vocabulary explicitly. |
| Property | `iacrm_poolpresent` — Pool present | Yes; No; Unknown / not asked | `QuoteCraftZ intake. Pool present. Do not infer an unasked answer.` Property notes where the source only establishes presence; do not invent construction or quantity. |
| Quote `iacrm_quote` | `iacrm_policyformtype` — Policy form type | HO3 - Dwelling; HO4 - Renters; HO5; HO6 - Condo | `QuoteCraftZ intake. Policy form type. Do not infer an unasked answer.` Opportunity notes until the correct quote context is available. Extend choices for verified additional forms rather than forcing business/life/health/travel into a home form. |

Source XML is under `powerplatform/solutions/BettersInsuranceCRM/Entities/<table>/Entity.xml` in the CRM repository. This handoff does not claim these six definitions are absent in dev, nor does their absence in production authorize a direct production import.

## 4. REUSE: existing columns and child tables

The following are not new schema requests. Implement or fix the mapping/writer. Preserve note fallbacks until round-trip acceptance passes.

| Source information | Existing destination and implementation instruction | Current fallback or limitation |
| --- | --- | --- |
| Driver identity, education and license status | Drivers are Contact records. Reuse `contact.educationcode`, `iacrm_dlstatus`, name/DOB/gender/marital-status fields, driver education, good student, telematics and secured identifiers. Use the explicit reviewed source-to-CRM choice maps. | A driver note section does not mean the entire driver is unmapped. Education already has an explicit ten-option PL Rater crosswalk. |
| Employer tenure / prior employer tenure | `contact.iacrm_yearsemployed` / `iacrm_prioryearsemployed`. These are distinct from occupation tenure in section 1. | Current-employer tenure is typed; occupation tenure stays in that contact's notes. |
| Residence type | Property `iacrm_residencetype`; eight live choices: Dwelling, Apartment, Condominium, Townhouse, Rowhouse, Co-op, Mobile Home, Other. | Already mapped for all eight observed PL Rater options; do not recreate or route back to notes. |
| Retirees credit, wood stoves, occupants and bathrooms | Existing Property retiree/retirement-community choices, `iacrm_woodburningstovecount`, `iacrm_householdresidents`, `iacrm_fullbathroomcount`, `iacrm_halfbathroomcount`; inspect the current canonical definitions. | Older handoffs requesting these columns are obsolete. Stove inserts and fireplaces remain separate quantities. |
| Driver-to-vehicle association | `iacrm_vehicleassignment`, plus `iacrm_policydriver` when the context is a policy. See section 5. | Assigned-vehicle selection and EZLynx percentage matrix remain scoped notes until an association writer exists. |
| Excluded/principal/occasional driver status | Use Policy Driver rating status with its policy context; Vehicle Assignment has principal-operator status. Do not reuse deprecated Contact `iacrm_driverratingstatus`. | Contact-scoped notes pending contextual routing. |
| Comprehensive/collision deductible, limits and optional coverages | `iacrm_quotecoverage`, associated quote/item/risk, coverage code, units and elections. Use `iacrm_policycoverage` after sale. | Vehicle-specific coverage details stay on that vehicle's notes; policy-wide details on opportunity notes. Comprehensive deductible is not a missing Vehicle scalar. |
| Incidents / property losses / renovations | Existing `iacrm_drivingincident`, `iacrm_propertyloss`, `iacrm_propertyrenovation`. Preserve each row and its date, system/type, amount and contact/vehicle/property/quote context. | Opportunity or Property notes as configured. Do not create one new scalar column per repeating incident or renovation. |
| Additional insured / co-applicant / additional interests | Existing Contact/Connection role and `iacrm_additionalinterest` with insured-item resolution. | Named-insured/first driver is the primary Contact; subsequent driver columns are additional Contacts. Resolve lookup IDs rather than writing display text into lookup columns. |
| Additional phone/email / previous address | Existing `iacrm_contactpoint` and `customeraddress`, including address duration and ZIP suffix columns. Preserve person ownership, usage and sequence. | Current fallback notes where these child writers/routing are unavailable. Do not add custom address columns to Contact to avoid routing work. |
| Carrier questions / underwriting answers | Existing Risk Answer / Carrier Question model; preserve source question, value and quote/risk/subject context. Check the actual relationship contract before writing. | Scoped notes remain for unsupported contexts. Do not create hundreds of carrier-specific Property/Contact columns by treating every note rule as a schema gap. |
| Credit/report authorization | Existing Application `iacrm_creditreportsauthorized`; add Application context to the extension before routing. | Opportunity notes; do not repurpose unrelated consent fields. |
| Prior-carrier / continuous coverage duration | Existing Prior Coverage months-with-carrier and months-continuous-coverage fields. Teach the two native controls independently. | Ambiguous Months mapping retains opportunity notes. |
| Exterior material | Existing Property `iacrm_siding`, with reviewed choice translation/extensions. | Unmatched values stay in Property notes; Boolean `iacrm_walls` is unsuitable. |

Other note-only source controls, including custody, foreign/international-license answers, date first licensed, school-away mileage, heat-tank location, basement classifications, roof layers, pool safety and optional-coverage details, remain in the reviewed mapping manifest. Their presence in notes alone is not evidence that another Contact or Property column is required. Route contextual answers through the appropriate existing child model where possible. In particular, current license issue date is not necessarily first-ever licensing date; a student-away flag is not a distance; a count is not a presence flag. For unresolved concepts, record the source semantics and candidate-equivalent check before proposing additional schema. The ten new columns above are the concrete proposed addition set, not a claim that every conditional carrier question has been exhaustively modeled.

## 5. Driver assignments: schema exists; import is still missing

Vehicle Assignment was previously verified live in production and exists in canonical source. Do not create another assignment table. The current QuoteCraftZ baseline has no Vehicle Assignment / Policy Driver CRM writer; mapping a driver to a Contact does not automatically create these associations.

Use existing `iacrm_vehicleassignment` / entity set `iacrm_vehicleassignments`:

| Existing column | Contract to use |
| --- | --- |
| `iacrm_name` | Text, existing maximum **1,700 characters**. Human-readable assignment label; not the identity key. |
| `iacrm_source` | Text, existing maximum **200 characters**. Source service identifier. |
| `iacrm_accountid` | Lookup to Account; resolve the saved insured account. Character limit N/A. |
| `iacrm_contactid` | Lookup to Contact; resolve the actual driver, including the primary contact. Character limit N/A. |
| `iacrm_vehicleid` | Lookup to Vehicle; resolve the actual saved vehicle. Character limit N/A. |
| `iacrm_insureditemid` | Lookup to Insured Item, when that context exists. Character limit N/A. |
| `iacrm_opportunityid` | Lookup to Opportunity, when shopping context exists. Character limit N/A. |
| `iacrm_policyid` / `iacrm_policydriverid` | Existing Policy / Policy Driver lookups for policy context. Do not fabricate a policy merely to import an opportunity's assignments. Character limit N/A. |
| `iacrm_percentuse` | Decimal, allowed **0–100**, canonical accuracy **2 decimal places**. Confirm deployed precision matches; do not assume an integer percentage or invent a split. Character limit N/A. |
| `iacrm_isprincipaloperator` | Existing Boolean principal-operator assertion. Set only from an explicit source assertion; do not confuse with percentage. Character limit N/A. |

Implementation sequence:

1. Save/resolve Account, primary and additional Contacts, Vehicles and the selected Opportunity context first. Maintain source-record-to-CRM-ID maps.
2. Capture PL Rater Operates selection and EZLynx driver/vehicle matrix into separate association rows. Page column position may identify the source slot during capture, but it is not a durable CRM foreign key.
3. Resolve selected vehicle to its saved CRM ID using captured identity such as VIN/source identity, and driver to the correct saved Contact ID. Distinguish duplicate names; do not attach Alexander's assignment to Tracey by sorting a Contact list.
4. Make repeated imports idempotent using an explicit association identity/context contract; reuse/update the matching assignment rather than appending duplicates. Do not add an alternate key without reviewing existing duplicate data and null/context behavior.
5. Missing/ambiguous driver, vehicle or context must produce a visible unresolved-association result and preserve the source in scoped notes. Never silently switch the note to Account or invent a record/percentage.
6. Read back assignment lookups and values after import. Test adding/removing/reordering source columns, primary plus additional drivers, shared vehicles and repeated ingestion. Absence on one sparse source screen must not delete established CRM assignments.

## 6. Claude delivery instructions

- Read Nathan's current instructions, the CRM repository's `AGENTS.md` and `docs/PIPELINE.md` before solution work. This handoff authorizes no alternate deployment route. Nathan's latest explicit instructions take precedence over older contradictory manual-deployment notes. Follow the currently directed GitHub delivery path and do not manually import to production.
- Start CRM source changes from current `dev`; edit canonical source under `powerplatform/solutions/`, preserve unrelated changes, and add a `docs/changes/` note. Use the existing local checkouts, not a new clone of `C:\Projects\D365-CRM-V3`.
- Reconcile against ADO **3763** for QuoteCraftZ schema gaps and the existing **3756** follow-ups before opening duplicate work. Record owner, scope, acceptance criteria, source/deployment/extension dependencies, PR and commit links, verification and unresolved items. Use Nathan's required service-principal access, not a human browser ADO session. This document does not assert that ADO was updated.
- For every CREATE row, capture before/after metadata: table, schema/logical name, display label, type, maximum length or numeric bounds, required level/default, auditing, description and full Choice values. For DEPLOY EXISTING, preserve the existing managed identity and option numbers. Never interpret PAC XML `Length=1` on a Choice as a one-character answer limit.
- Update existing forms/views where appropriate; do not replace solution-owned forms/apps. Keep optional capture data optional. Do not store SSNs or license numbers in ordinary notes or commit customer values/credentials to Git.
- Update QuoteCraftZ's metadata catalog, generator, shared manifests, transforms and tests to use final deployed names. Refresh the selected environment's metadata cache. Automatic collections must cover all Contacts/Vehicles/Properties, with the first PL Rater driver as primary and later columns as additional contacts; no fixed maximum-column mapping.
- Add explicit Choice crosswalks; preserve source wording when a conversion loses information. Text fields must enforce the stated limits without silent truncation. Keep the proposed numeric bounds and precision in schema and validation. Reject invalid ownership-month values without corrupting adjacent vehicle rows.
- Keep existing scoped fallback/history until successful typed write/read-back. Do not delete historical timeline notes as a migration shortcut. Capture preview should show each source once even with multiple targets, and one horizontal table per risk type with one record per row.
- Run the required solution checks/reviews and the authorized dev deployment/capture process. Validate the authenticated dev user path, not only metadata existence. Do not label production ready from a local build or Git merge.
- Return one disposition ledger with **created**, **existing definition deployed**, **existing field reused**, **choice extended**, or **still unresolved**, exact PR/commit/deployment links, read-back evidence and remaining fallback for each row. Do not report a note-only association as a completed typed import.

## Acceptance checklist

- [ ] Six confirmed Contact/Vehicle additions and four proposed Property representations have exact approved names, types, constraints and descriptions, with no duplicate equivalents.
- [ ] The six already-authored Choice definitions are handled as existing deployment work, with current dev/production status recorded separately.
- [ ] Education, residence type, retirees credit and other already-delivered columns are reused; no duplicate Contact/Property/coverage/assignment tables are created.
- [ ] Primary and additional drivers, arbitrary vehicle counts and source reorder/removal preserve record identity.
- [ ] Typed values and driver/vehicle assignment relationships read back correctly; repeat import creates no duplicates.
- [ ] Unknown is distinguishable from No/zero; ranges are not exact distances and presence is not count.
- [ ] All remaining source-only answers have an explicit correct scoped fallback; incomplete writer/choice work remains visible in the ledger.
- [ ] Git, accountable ADO item, deployment/capture evidence and dev browser acceptance agree.
