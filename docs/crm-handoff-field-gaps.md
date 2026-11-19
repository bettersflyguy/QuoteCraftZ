# EZLynx to CRM: complete fields, representations and current fallbacks

**Owner:** Nathan Betters
**As of:** 2026-11-19, QuoteCraftZ 0.1.80
**Purpose:** one self-contained implementation handoff identifying exactly what to reuse, what to create, and what to extend before replacing temporary extension mappings. Use this document instead of assembling the earlier separate handoffs.

The inventory reconciles **all 136 page-note rules and all 22 Data Service note rules**. The shared Months rule represents two fields, so the catalog below has **159 source-field entries**. A matrix rule represents every driver/vehicle cell. This is not a request to create 159 new columns: some entries need new attributes, others need existing child tables and mappings exposed.

## Verified disposition: create or reuse

**Cross-environment schema audit:** 2026-11-19. Read-only Dataverse v9.2 requests retrieved every table definition and its complete attribute collection in both AgentCRMDev and production. The comparison searched logical/schema names, display labels, descriptions and field structures across all publisher prefixes; candidate equivalents also had their lookup targets, choice options and table capabilities inspected. Role-configuration reads checked whether Co-applicant already exists. No CRM customizations or client records were changed.

| Environment | Full snapshot UTC | Tables | Attributes | Result |
|---|---|---|---|---|
| AgentCRMDev — `https://agentcrmdev.crm.dynamics.com` | 2026-11-19 20:40:04 | 2,182 | 92,258 | Complete response; no continuation link. |
| Production — `https://bettersinsurance.crm.dynamics.com` | 2026-11-19 20:40:29 | 2,146 | 90,217 | Complete response; no continuation link. |

An additional unfiltered relationship read covered **32,899 many-to-one relationships in dev and 30,880 in production**. It identified every table with an actual Contact lookup target (116 dev / 110 production), independent of what that lookup was named. Those tables' value/type/context fields were checked for a contact-method alternative; the review did not rely solely on searching for the words Contact Point.

The earlier dev-only audit was insufficient to justify every new-table proposal. This wider audit removes the proposed Quote Participant table: existing **Connection** provides that representation once Quote connections are enabled and the missing role is configured. Contact Point remains the only proposed new table after checking both names and structural alternatives.

The Required work column now uses these explicit instructions:

| Instruction | What to do |
|---|---|
| **REUSE** | The named field/table/relationship exists in both environments, except where explicitly marked REUSE + DEPLOY. Do not create a duplicate. Implement or correct its extension mapping. |
| **CREATE** | The required representation has no equivalent on the audited target entity. Create the named proposed column, then map it. |
| **EXTEND** | Reuse the existing model and add only the named missing columns, choice options, capability or role configuration. Then implement the mapping. |
| **CREATE TABLE** | No same-purpose repeating model was found in either environment after the alias/structure check. Create the one proposed Contact Point table and its listed columns. |
| **REUSE + DEPLOY** | The definition exists in dev but is absent in production. Deploy that existing definition; do not create another field. |

New names marked **proposed** are implementation names to author in the canonical solution; they do not exist yet. Existing logical names below were checked against both environments, with dev-only exceptions explicitly marked REUSE + DEPLOY. A missing extension mapping alone was not treated as evidence that a CRM column is missing.

Examples: **occupant count reuses `iacrm_property.iacrm_householdresidents`**; **Retirees Credit needs new `iacrm_property.iacrm_retireecredit`**; **Preferred Language reuses `contact.iacrm_preferredlanguage`**; and the complete driver/vehicle matrix reuses **`iacrm_vehicleassignment`**, including `iacrm_percentuse`.

**Production access corrected:** the earlier HTTP 401 came from using the dev principal against production. The documented production principal was used for the successful full read above. Missing in production does not automatically mean create: Contact Preferred Language and Maiden Name already exist in dev and need deployment of those existing definitions, rather than duplicate columns.

### Same-purpose tables and alternative names reviewed

| Candidate / aliases | Dev / production | Decision and evidence |
|---|---|---|
| `connection`, `connectionrole` — Connection / Connection Role | Present / present | **EXTEND and REUSE for Co-applicant.** Existing `record1id`, `record2id`, `record1roleid`, `record2roleid` represent two parties and their contextual roles. Contact connections are enabled; Quote and Application connections are disabled, with change permitted. Each environment has 35 configured Connection Roles and none named Co-applicant or equivalent applicant/insured/borrower role. Enable Quote connections and add a solution-owned Co-applicant role. Do not create `iacrm_quoteparticipant`. |
| `customeropportunityrole`, `relationshiprole` — Opportunity Relationship / Relationship Role | Present / present | Existing `customerid` can target Contact; `opportunityid` identifies an Opportunity; `opportunityroleid` supplies a role. No Relationship Role definitions exist in either environment. This is a genuine alternate relationship model, but it has Opportunity context rather than the required per-Quote context. Use Connection for this handoff; do not silently widen a quote-specific answer to every quote on an Opportunity. |
| `customerrelationship` — Customer Relationship | Present / present | Links customer/partner Accounts or Contacts and their roles; no Quote context. It is not the selected Co-applicant representation. |
| `iacrm_servicingteammember` — Servicing Team Member | Present / present | Reuse for Producer and CSR: Account parent and both role values exist in both. Its purpose is staffing/AMS servicing, so do not add Co-applicant as a staffing role. |
| `iacrm_policydriver`, `iacrm_vehicleassignment`, `iacrm_drivingincident` | Present / present | Reuse the existing driver, matrix-assignment and incident models. Their required existing columns and relevant choices agree across both environments. Do not create renamed equivalents. Only the specific missing incident columns in this document are additions. |
| `iacrm_propertyrenovation`, `iacrm_quoteitem`, `iacrm_quotecoverage`, `iacrm_riskanswer`, `iacrm_carrierquestion` | Present / present | Reuse these existing models and the specifically listed attributes. Existing renovation choices agree across both; only Not Updated and Cooling need adding. Quote Item already links Quote and Insured Item. |
| `msdynmkt_contactpointconsent`, `...consent2`, `...consent3`, `...consent4`, `msdynmkt_contactpointsettings` | Present / present | These similarly named tables describe marketing consent/settings. The current consent table links purpose/topic/message, without a Contact-owner lookup, typed phone/email usage, extension and sequence model. They do not replace a Contact Point child row. |
| `msdyn_channelinstance`, channel-instance provider tables, `msdynmkt_preferencecenterlink`, `msdynmkt_trackingcontext` | Present / present | Contact-point strings here belong to channel/provider configuration, preference links or marketing tracking. Channel Instance relates to channel definition/account/provider configuration, not an owning Contact. Do not repurpose them. |
| `socialprofile`, `msdyn_ocphonenumber`, `msdyn_ocvoicemail`, `phonecall`, `email`, `activityparty` | Present / present | Social identity, organization phone, voicemail/activity and activity-participant records have different ownership/context contracts. Social Profile can link a customer and a messaging phone, but it is not a general typed phone/email/extension collection. Activities are communications, not reusable contact methods. |
| `msdyn_contactprofilerdetail`, `msdyn_contactkpiitem`, `iacrm_propertyresident` | Present / present | Profiler Detail has Contact, phone/email, profiler-result, citation, rank and reasoning fields; it has no usage-type/extension method contract. KPI Item stores communication metrics. Property Resident is a research-provider person at a Property. These are not general contact-method collections, despite containing phone/email-related fields. |
| `contact`, `customeraddress` | Present / present | Contact's fixed phone/email slots and Address's phone slots cannot preserve arbitrary typed phone/email rows with extension and order. Reuse Address for actual addresses; do not fabricate addresses to store contact methods. |
| Proposed `iacrm_contactpoint` — Contact Point | Absent / absent | **CREATE one new table** for arbitrary Contact-owned method rows, using the eight authored columns below. No same-purpose table was found after the name/description/field-structure and relationship checks above. |

### Existing dev definitions awaiting production deployment

| Source / definition | Dev | Production | Required action |
|---|---|---|---|
| F099 Preferred Language — `contact.iacrm_preferredlanguage` | Picklist exists; communication-language description | Absent | **REUSE dev and DEPLOY its existing definition.** Do not create a second language field. `mspp_userpreferredlcid` is portal UI language and is not equivalent. |
| F145 Maiden name — `contact.iacrm_maidenname` | String exists; description Last name before marriage | Absent | **REUSE dev and DEPLOY its existing definition.** Do not create a renamed equivalent. |
| Contact `iacrm_prefix` / `iacrm_suffix` | Picklists exist | Absent | **REUSE dev and DEPLOY.** [3744](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3744) specifies these as canonical choices; legacy `salutation`/`suffix` stay for old free text. Follow through with the extension mapping described below. |
| Account/Contact SMS-consent definitions | Present in dev | Absent | Existing dev changes outside this gap implementation scope. Preserve/reconcile through the normal release baseline; do not recreate or remove them here. |

The 53 proposed additions on existing tables are absent on their named target entity in **both** full schema snapshots. This is distinct from the existing dev Contact definitions above. The current instructions are tied to the target representation; metadata cannot establish that an unrelated business label means the same thing without comparing its context. Refresh the audit before implementation if either environment changes.

**Snapshot evidence:** complete responses were retained locally, without tokens or client values. SHA-256: dev `51865c1850294c7617b9794a323250d8d5356fa9a4ab46345f3a9fe7a3cfb614`; production `64afc6c373cd83bfec3fd8d43df2ade279b16ce7b7fc46c8dc0820a88e892d8a`. The read shape was `EntityDefinitions` with all table names/labels/descriptions and expanded `Attributes` names/types/labels/descriptions; there was no table-name filter. Additional GETs inspected candidate relationships, choices, capabilities and role definitions. Managed dependencies and actual capture/load/read-back still require the normal pipeline and acceptance checks.

## ADO wiki and backlog reconciliation

**Live ADO audit:** 2026-11-19, using the required ADO-PowerPlatform-Deploy principal; full wiki read completed at 20:52:44 UTC, with work-item/discussion follow-ups in this session. Read all **123 actual pages** in `D365InsuranceCRM.wiki` (the root directory is not a page; no page read failed), searched titles/descriptions using extension/entity terms plus every proposed logical name and source-field synonyms, retrieved **113 distinct matched work items**, and reviewed relevant descriptions and discussions on 17 items. This was read-only: no wiki page, work item, state or comment was changed.

**Answer: parts of this are already accounted for, especially in the work items.** The wiki documents the core coverage and servicing models but has no November field-by-field QuoteCraftZ handoff. Do not interpret a work item in **New** state as proof that its schema is missing: several descriptions were corrected by later delivery/grooming comments. Conversely, a delivered table does not prove the extension writer or owner acceptance is complete.

| Area / catalog IDs | Existing wiki / ADO source | What is already accounted for and what remains |
|---|---|---|
| Quote Coverage, F042–F071, F079–F092, F102–F118 | [BRD](https://dev.azure.com/BettersAgencyLLC/0cd94258-a698-4a84-919a-1eeff6676829/_wiki/wikis/6eecb195-08e7-4ace-aa6a-1f8905355830?pagePath=%2FBRD) §data model and DL-021; [2852](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/2852) Closed; [2886](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/2886) Closed; [3713](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3713) New | The existing coverage table and structured fields are documented. Story 3713 explicitly requests repeatable coverage-row mapping/writes and both components of split limits, linked to the Quote; agent permissions and owner dev acceptance are included. Reuse this item for the coverage writer and the missing additions above. Credits/carrier questions were explicitly outside 3713's initial scope; do not mark them complete under it. Historical 2852's separate side-solution instruction is not a current delivery instruction. |
| Policy Driver / Vehicle Assignment, F100, F129, F147 | [3554](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3554) New; [3561](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3561) New; [3705](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3705) New | Delivery comments already describe the three driver/incident/assignment tables reaching production on 2026-11-10; grooming comment **7492138** on 3554 confirms this despite its older description. 3561 covers driver naming and carrying assignments to a new policy. 3705 grooming comment **7476317** says all 22 vehicle columns already exist, with panel/label/extension acceptance work remaining. The live two-environment audit agrees on the schema. Do not recreate these tables/vehicle fields. |
| Driving incidents and four amounts, F130–F137 | [3711](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3711) New; [3712](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3712) Closed | Story 3711 covers incident collection mapping, driver/vehicle identity, repeat loads and agent permissions. Comment **7476484** explicitly records the owner's direction to retain BI, PD, Collision and MP separately in CRM; Bug 3712 covers distinguishing the four source inputs. Add the four missing Money columns under this existing incident scope. **Do not adopt the comment's unconfirmed assumption that Amount Paid is their total**; this handoff preserves Amount Paid unless an independent source/approved calculation supplies it. Also replace the initial driver/date/type matching assumption with a rule that preserves multiple same-day incidents. |
| Prior Coverage, F033–F034 | [3552](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3552) New | The record documents delivered Prior Coverage and its entity-set/lookup contract. The two month-component additions are still absent in both environments. Extend the existing representation; no new Prior Coverage table. |
| Property base model, renovation, notes, interests: F001–F032 and F093–F098 | [3549](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3549) New; [3555](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3555) New | These already account for Property/children, loss history, mortgagees and property editing; 3555's production comment **7438062** records notes/timelines and Purchase date in production. They support the current per-Property note fallback. They do not document the specific 23 new Home columns in this catalog as already delivered. No field-level wiki entries were found for Retirees Credit, wood-stove count or Roof Design. Scope the remaining Home additions explicitly instead of rebuilding Property. |
| Quote/Policy asset context and real interests | [3565](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3565) New | The item specifies Quote Items / Policy Items and interests at insured-item, policy-item and policy levels; production comment **7452273** records release 1.3.0.304. This supports reusing Quote Item as the asset context for coverage. Category-only scheduled totals still do not identify individual Scheduled Item assets or lender parties. |
| Producer / CSR, F139–F140 | [ADR-014](https://dev.azure.com/BettersAgencyLLC/0cd94258-a698-4a84-919a-1eeff6676829/_wiki/wikis/6eecb195-08e7-4ace-aa6a-1f8905355830?pagePath=%2FADRs%2FADR-014) Accepted; [BRD](https://dev.azure.com/BettersAgencyLLC/0cd94258-a698-4a84-919a-1eeff6676829/_wiki/wikis/6eecb195-08e7-4ace-aa6a-1f8905355830?pagePath=%2FBRD) servicing/security sections; [2340](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/2340) Closed | ADR-014 is the canonical servicing model: a party in a role on a parent, not a dedicated Account Producer/CSR lookup. Reuse `iacrm_servicingteammember` and the live Account target/roles. The wiki's original Opportunity-first scope is older than the now-present Account/Policy targets. |
| Contact name/language fields, F099, F145, plus Prefix/Suffix | [3744](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3744) New, including comments **7509099**, **7509117**, **7510283** | The owner added communication language; the architect specified `iacrm_prefix`, `iacrm_suffix`, `iacrm_maidenname`, `iacrm_preferredlanguage` (ADR-053 / PR481 design). Standard `salutation`/`suffix` remain legacy free text. These four definitions are present in current dev and absent in production. Reuse/deploy the existing dev definitions and implement the QuoteCraftZ mapping follow-up **F2**; do not create duplicates or keep treating legacy text as the canonical new choices. Owner acceptance/deployment is not inferred from their presence in dev. |
| Extension permissions / live field catalog | [3704](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3704) New; [3745](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3745) Closed; [3755](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3755) New | 3704 covers Risk Answer Append / Insured Item Append To and Quote access, and overlaps incident permissions. 3745 was closed after the wrong-tenant sign-in diagnosis. 3755 retains Lead fields, visible account/environment and field-catalog refresh. A failed picker/permission is not evidence that an entity/column is absent. No privilege changes or acceptance tests were performed by this audit. |
| Vehicle Purchase date / existing typed vehicle fields | [3723](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3723) New; [3705](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3705) New; [3706](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3706) New; [3709](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3709) New | 3723 comments **7493071/7493073** correct the earlier name-only search: Purchase date already exists as `iacrm_acquireddate`. Use this existing field. Airbags and anti-theft choice requests have their own items; they must not create duplicate physical columns or silently change stored choice values. |
| Occupation canonical choice vs free text | [3550](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3550) New; [3707](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3707) New | 3550 records the Contact occupation choice plus Other/free text. 3707 covers the six requested occupation options, including nursing distinctions. Reuse `iacrm_occupation` for known choices and `iacrm_employmentoccupation` for Other/history; do not collapse explicit source distinctions while the requested choices remain pending. |
| Co-applicant, F146 | [ADR-014](https://dev.azure.com/BettersAgencyLLC/0cd94258-a698-4a84-919a-1eeff6676829/_wiki/wikis/6eecb195-08e7-4ace-aa6a-1f8905355830?pagePath=%2FADRs%2FADR-014) Alternatives; no dedicated matched implementation item | ADR-014 rejects OOB Connections **for sync/commission-bearing servicing staff specifically**, while retaining their broader role-association use. It does not approve a Co-applicant feature. The Connections representation in this handoff remains a **proposed implementation**, requiring Quote capability/role configuration and acceptance; it is not claimed as already implemented or wiki-approved. Do not create the previously proposed Quote Participant table or misuse a servicing-team role. |
| New Contact Point, F153–F159, and remaining intake/address gaps | No dedicated same-purpose wiki decision or matched implementation item found in this search | The live alias audit found no existing Contact Point model. The wiki/backlog search did not supply an approved typed phone/email/usage/extension model or a complete specification for the remaining new Account/address columns. Keep the current fallbacks and establish explicit implementation scope/acceptance before schema delivery. This is a searched-scope finding, not a claim that every historical ADO attachment/repository was reviewed. |

### Documentation differences that matter

- **Wiki freshness:** the wiki contains ADR-031 but no page for ADR-053, Policy Driver, Driving Incident, Vehicle Assignment, Preferred Language, Maiden Name, Co-applicant or the full 159-field inventory. The newer work-item discussions carry those decisions; some underlying specifications are linked repository files, not wiki pages.
- **Separate decisions from live facts:** the current two-environment metadata audit establishes schema presence. ADO state, old source snapshots and historical promotion comments do not establish current permissions, mapping completeness, owner acceptance or authorization for a new release.
- **Current delivery rules win:** [ADR-031](https://dev.azure.com/BettersAgencyLLC/0cd94258-a698-4a84-919a-1eeff6676829/_wiki/wikis/6eecb195-08e7-4ace-aa6a-1f8905355830?pagePath=%2FADRs%2FADR-031) supports the single CRM solution. Historical wiki/manual-deployment and side-solution instructions do not supersede the current user-provided `AGENTS.md` and GitHub pipeline. This audit authorizes no import/publish/promotion.
- **Implementation tracking:** reuse the existing coverage, incident, Property, Contact and permissions items above. Add this handoff's exact missing fields and mapping/read-back criteria to the appropriate implementation scope when that work begins; do not open duplicates merely because an existing item's state is still New. No ADO state was changed or acceptance claimed here.

## Exact current fallback destinations

| Mapping target | Destination / behavior |
|---|---|
| `note:properties[]` | Notes: Properties (all rows); each source property gets its own timeline note. |
| `note:property1` | Notes: Property 1; explicit singleton mapping on the configured Home property. |
| `note:contacts[]` | Each contact's own timeline; EZLynx applicant first, then related contacts. |
| `note:opportunity` | Opportunity timeline; repeated fields retain source labels, order and available context. |
| `note` | Insured Account timeline; additional phone/email/address rows retain their owner/type labels there. |

Fallback notes preserve original labels and answers. Keep blank/unknown, zero, No, No Coverage and Included distinct. Property notes require the matching loaded Property; a missing match produces a visible error. Replace a fallback only after typed capture, load and read-back succeed; retain prior notes as history.

**Configuration evidence:** saved 2026-11-19 page preset and a fresh Settings Data Service export at 18:25 UTC on 2026-11-19. These are configuration exports, without client values. Secured mappings are deliberately excluded from share exports.

**Schema work proposed:** 53 new columns across 10 existing tables; **one** new child table (Contact Point, with eight authored columns); two added choice options (Not Updated and Cooling); and configuration of existing Connections for Quote plus a new Co-applicant Connection Role. Deploy the existing dev Preferred Language, Maiden Name and canonical Prefix/Suffix definitions to production; these are reuse/deployment work, not additions to the 53 proposed new columns. The 53 proposed column names are absent on their respective target tables in both snapshots. Platform-generated table/ID/system columns are additional to the eight authored Contact Point columns.

**Catalog dispositions:** 13 REUSE; 41 CREATE; 98 EXTEND; 7 CREATE TABLE source-field entries. The seven CREATE TABLE entries share the one Contact Point table. REUSE for F099/F145 includes deploying their existing dev definitions to production. These are row dispositions, not unique column counts: shared additions and child-table columns are listed once in the representation sections.

## Complete implementation catalog

### Home Property

These 24 source entries require 23 new Property columns and one existing occupant-count column. Eligibility answers retain source/quote provenance; they must not overwrite unrelated driver discounts. Separate source controls remain separate: Fire Detection and Smoke Detector cannot share one destination, even when choice captions overlap.

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F001 | Dwelling Type | Property (`iacrm_property`) | Dwelling type: Choice, e.g. one family / duplex; distinct from construction style. Proposed new column: `iacrm_dwellingtype`. | `note:properties[]` | **CREATE** — Property `iacrm_dwellingtype`; no equivalent in audited dev metadata. |
| F002 | Number of Occupants | Property (`iacrm_property`) | Occupant count: existing Property `iacrm_householdresidents` (Household residents), whole number. | `note:properties[]` | **REUSE** — Property `iacrm_householdresidents` (Integer); expose the mapping. Do not create `iacrm_occupantcount`. |
| F003 | Roof Design | Property (`iacrm_property`) | Roof design: Choice, e.g. hip / gable; distinct from roof material. Proposed new column: `iacrm_roofdesign`. | `note:properties[]` | **CREATE** — Property `iacrm_roofdesign`; no equivalent in audited dev metadata. |
| F004 | Number Of Full Baths | Property (`iacrm_property`) | Full bathroom count: Whole number. Proposed new column: `iacrm_fullbathroomcount`. | `note:properties[]` | **CREATE** — Property `iacrm_fullbathroomcount`; no equivalent in audited dev metadata. |
| F005 | Number Of Half Baths | Property (`iacrm_property`) | Half bathroom count: Whole number. Proposed new column: `iacrm_halfbathroomcount`. | `note:properties[]` | **CREATE** — Property `iacrm_halfbathroomcount`; no equivalent in audited dev metadata. |
| F006 | # of Wood Burning Stoves | Property (`iacrm_property`) | Wood burning stove count: Whole number; do not substitute wood stove inserts. Proposed new column: `iacrm_woodburningstovecount`. | `note:properties[]` | **CREATE** — Property `iacrm_woodburningstovecount`; no equivalent in audited dev metadata. |
| F007 | Fire Detection | Property (`iacrm_property`) | Fire detection type: Choice for the source's local / central / direct monitoring values; distinct from smoke detector. Proposed new column: `iacrm_firedetectiontype`. | `note:properties[]` | **CREATE** — Property `iacrm_firedetectiontype`; no equivalent in audited dev metadata. |
| F008 | Dwelling Address: Unit | Property (`iacrm_property`) | Address unit: Text; keep separate from address line 2. Proposed new column: `iacrm_addressunit`. | `note:properties[]` | **CREATE** — Property `iacrm_addressunit`; no equivalent in audited dev metadata. |
| F009 | Dwelling Address: Postal Code Suffix | Property (`iacrm_property`) | ZIP+4 suffix: Text, four digits, preserving leading zeroes. Proposed new column: `iacrm_zip4suffix`. | `note:properties[]` | **CREATE** — Property `iacrm_zip4suffix`; no equivalent in audited dev metadata. |
| F010 | Within Fire District | Property (`iacrm_property`) | Within fire district: Yes / No; distinct from fire district name/code. Proposed new column: `iacrm_withinfiredistrict`. | `note:properties[]` | **CREATE** — Property `iacrm_withinfiredistrict`; no equivalent in audited dev metadata. |
| F011 | Number of Units in Fire Division | Property (`iacrm_property`) | Fire division unit count: Whole number; distinct from dwelling unit count. Proposed new column: `iacrm_firedivisionunitcount`. | `note:properties[]` | **CREATE** — Property `iacrm_firedivisionunitcount`; no equivalent in audited dev metadata. |
| F012 | Multipolicy Discount | Property (`iacrm_property`) | Multipolicy discount: Yes / No. Proposed new column: `iacrm_multipolicydiscount`. | `note:properties[]` | **CREATE** — Property `iacrm_multipolicydiscount`; no equivalent in audited dev metadata. |
| F013 | Retirees Credit | Property (`iacrm_property`) | Retiree credit: Yes / No. Proposed new column: `iacrm_retireecredit`. | `note:properties[]` | **CREATE** — Property `iacrm_retireecredit`; no equivalent in audited dev metadata. |
| F014 | Mature Discount | Property (`iacrm_property`) | Mature homeowner discount: Yes / No; distinct from driver mature-course completion. Proposed new column: `iacrm_maturehomeownerdiscount`. | `note:properties[]` | **CREATE** — Property `iacrm_maturehomeownerdiscount`; no equivalent in audited dev metadata. |
| F015 | Retirement Community | Property (`iacrm_property`) | Retirement community: Yes / No. Proposed new column: `iacrm_retirementcommunity`. | `note:properties[]` | **CREATE** — Property `iacrm_retirementcommunity`; no equivalent in audited dev metadata. |
| F016 | Limited Access Community | Property (`iacrm_property`) | Limited access community: Yes / No. Proposed new column: `iacrm_limitedaccesscommunity`. | `note:properties[]` | **CREATE** — Property `iacrm_limitedaccesscommunity`; no equivalent in audited dev metadata. |
| F017 | Gated Community | Property (`iacrm_property`) | Gated community: Yes / No. Proposed new column: `iacrm_gatedcommunity`. | `note:properties[]` | **CREATE** — Property `iacrm_gatedcommunity`; no equivalent in audited dev metadata. |
| F018 | Property insurance cancelled, declined or non-renewed in the last 5 years | Property (`iacrm_property`) | Adverse property insurance history: Yes / No; retain the source question's time window. Proposed new column: `iacrm_adverseinsurancehistory5years`. | `note:property1` | **CREATE** — Property `iacrm_adverseinsurancehistory5years`; no equivalent in audited dev metadata. |
| F019 | Is the home under construction? | Property (`iacrm_property`) | Under construction: Yes / No. Proposed new column: `iacrm_underconstruction`. | `note:property1` | **CREATE** — Property `iacrm_underconstruction`; no equivalent in audited dev metadata. |
| F020 | Trampoline | Property (`iacrm_property`) | Trampoline on premises: Yes / No. Proposed new column: `iacrm_trampoline`. | `note:property1` | **CREATE** — Property `iacrm_trampoline`; no equivalent in audited dev metadata. |
| F021 | Business or daycare on the premises | Property (`iacrm_property`) | Business/daycare on premises: Yes / No; do not infer business type. Proposed new column: `iacrm_businessordaycareonpremises`. | `note:property1` | **CREATE** — Property `iacrm_businessordaycareonpremises`; no equivalent in audited dev metadata. |
| F022 | # of Employees | Property (`iacrm_property`) | Total employees on premises: Whole number; full-time and part-time counts are different fields. Proposed new column: `iacrm_employeesonpremises`. | `note:property1` | **CREATE** — Property `iacrm_employeesonpremises`; no equivalent in audited dev metadata. |
| F023 | Are dogs on the premises? | Property (`iacrm_property`) | Dogs on premises: Yes / No. Proposed new column: `iacrm_dogsonpremises`. | `note:property1` | **CREATE** — Property `iacrm_dogsonpremises`; no equivalent in audited dev metadata. |
| F024 | Foremost: Number of Animals on Premises? | Property (`iacrm_property`) | Animals on premises: Count/range choice; preserve None and carrier wording. Proposed new column: `iacrm_animalsonpremises`. | `note:properties[]` | **CREATE** — Property `iacrm_animalsonpremises`; no equivalent in audited dev metadata. |

### Home systems

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F025 | Heating Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Heating; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | **EXTEND** — REUSE `iacrm_system` and `iacrm_extent`; ADD Not Updated to the extent choice. Expose one child row per system. |
| F026 | Heating: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Heating renovation row; preserve displayed disabled values. | `note:property1` | **REUSE** — Renovation `iacrm_year`, `iacrm_system`, `iacrm_propertyid`; expose child mapping. |
| F027 | Electrical Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Electrical; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | **EXTEND** — REUSE `iacrm_system` and `iacrm_extent`; ADD Not Updated to the extent choice. Expose one child row per system. |
| F028 | Electrical: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Electrical renovation row; preserve displayed disabled values. | `note:property1` | **REUSE** — Renovation `iacrm_year`, `iacrm_system`, `iacrm_propertyid`; expose child mapping. |
| F029 | Plumbing Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Plumbing; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | **EXTEND** — REUSE `iacrm_system` and `iacrm_extent`; ADD Not Updated to the extent choice. Expose one child row per system. |
| F030 | Plumbing: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Plumbing renovation row; preserve displayed disabled values. | `note:property1` | **REUSE** — Renovation `iacrm_year`, `iacrm_system`, `iacrm_propertyid`; expose child mapping. |
| F031 | Roofing Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Roofing; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | **EXTEND** — REUSE `iacrm_system` and `iacrm_extent`; ADD Not Updated to the extent choice. Expose one child row per system. |
| F032 | Nationwide: year updated for cooling type | Property Renovation (`iacrm_propertyrenovation`) | System = Cooling; nullable whole year, Property lookup and carrier/question identity. | `note:property1` | **EXTEND** — REUSE `iacrm_year`/`iacrm_system`/`iacrm_propertyid`; ADD Cooling to system choice; use a question-specific selector. |

### Shared policy and application

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F033 | Months with Prior Carrier | Prior Coverage (`iacrm_priorcoverage`) | Whole number 0-11, separate from years; proposed iacrm_monthswithpriorcarrier. The current shared Months rule also captures Months with Continuous Coverage. | `note:opportunity` | **CREATE** — Prior Coverage `iacrm_monthswithpriorcarrier`; split the shared Months selector by neighboring caption. |
| F034 | Months with Continuous Coverage | Prior Coverage (`iacrm_priorcoverage`) | Whole number 0-11, separate from years; proposed iacrm_monthscontinuouscoverage. Independent from Months with Prior Carrier. | `note:opportunity` | **CREATE** — Prior Coverage `iacrm_monthscontinuouscoverage`; split the shared Months selector by neighboring caption. |
| F035 | Credit Check and Other Underwriting Reports Authorized | Insurance Application (`iacrm_application`) | Explicit credit-check/other-underwriting-reports authorization: Yes/No, proposed `iacrm_creditreportsauthorized`. No inferred consent or fabricated consent timestamp. | `note:opportunity` | **CREATE** — Application `iacrm_creditreportsauthorized` (Yes/No); no authorization attribute exists. |
| F036 | Quote as Package | Quote (`iacrm_quote`) / existing package relationship | Package election: proposed Quote `iacrm_quoteaspackage` (Yes/No). Existing Quote `iacrm_submissionid` can retain the package submission grouping. | `note:opportunity` | **CREATE** — Quote `iacrm_quoteaspackage` (Yes/No). REUSE `iacrm_submissionid` for grouping; grouping alone does not store the checkbox. |
| F037 | Paperless (Home and Auto) | Risk Answer (`iacrm_riskanswer`), Quote context | Yes/No election with carrier/question and line identity; not contact communication consent. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F038 | Home: Policy/Form Type | Quote (`iacrm_quote`) | Policy-form choice/code such as HO-3: proposed Quote `iacrm_policyformtype`. This is not the policy term or line of business. | `note:opportunity` | **CREATE** — Quote `iacrm_policyformtype`; no policy/form-type equivalent exists. |
| F039 | Foremost Home: Product type | Risk Answer (`iacrm_riskanswer`), Quote context | Carrier product code/choice such as Standard; distinct from Dwelling Type. | `note:properties[]` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F040 | Stillwater Auto: Multi-Policy Discount? (60-day eligibility question) | Risk Answer (`iacrm_riskanswer`), Quote context | Carrier/question plus category answer such as Home (Largest Discount); not a Boolean. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F041 | Travelers Auto: Is this quote part of a book transfer? | Risk Answer (`iacrm_riskanswer`), Quote context | Yes/No with carrier/question identity. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |

### Home coverage

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F042 | Dwelling | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency coverage limit; retain stable coverage code and original limit text. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F043 | Other Structures percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percent, paired with its calculated Amount on the SAME coverage row; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` (percent) and `iacrm_limitperoccurrence` (calculated amount); CREATE `iacrm_limitunit`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F044 | Personal Property basis | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Basis/option choice such as Custom, paired with Personal Property Amount; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F045 | Personal Property Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit on the Personal Property coverage row; retain stable coverage code and original limit text. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F046 | Loss Of Use percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percent, paired with its calculated Amount on the SAME coverage row; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` (percent) and `iacrm_limitperoccurrence` (calculated amount); CREATE `iacrm_limitunit`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F047 | Personal Liability | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency/split-limit representation as supplied; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F048 | Home: Medical Payments | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit in Home/Property context; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F049 | All Perils Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Deductible type, nullable numeric value, text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_deductibledisplay`, `iacrm_deductibleamount`, `iacrm_deductiblebasis`; CREATE `iacrm_deductiblepercentage`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F050 | Theft Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Theft deductible value, original text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_deductibledisplay`, `iacrm_deductibleamount`, `iacrm_deductiblebasis`; CREATE `iacrm_deductiblepercentage`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F051 | Wind Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Wind deductible value, original text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_deductibledisplay`, `iacrm_deductibleamount`, `iacrm_deductiblebasis`; CREATE `iacrm_deductiblepercentage`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F052 | Foremost: Build Property Loss Settlement | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Loss-settlement basis choice/text with carrier/question identity; retain stable coverage code and original limit text. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F053 | Other Structures: calculated Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency amount on the same Other Structures coverage row as its percentage; derived-value provenance; not another Property record; retain stable coverage code and original limit text. | `note:property1` | **EXTEND** — REUSE `iacrm_limitperoccurrence` (amount) / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F054 | Loss Of Use: calculated Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency amount on the same Loss Of Use coverage row as its percentage; derived-value provenance; not another Property record; retain stable coverage code and original limit text. | `note:property1` | **EXTEND** — REUSE `iacrm_limitperoccurrence` (amount) / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |

### Home endorsements

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F055 | Building Additions or Alterations | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F056 | Increased Replacement Cost Dwelling Percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percentage and percent unit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_limitunit`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F057 | Loss Assessment | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F058 | Ordinance or Law | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Limit plus the actual percentage/currency unit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_limitunit`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F059 | Increased Coverage on Credit Card | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency insurance-coverage limit; no payment-card data with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F060 | Increased Limit on Jewelry, Watches and Furs | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F061 | Water Backup | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F062 | Increased Mold Property Damage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F063 | Earthquake Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Earthquake deductible value, text and currency/percent unit with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_deductibledisplay`, `iacrm_deductibleamount`, `iacrm_deductiblebasis`; CREATE `iacrm_deductiblepercentage`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F064 | Equipment Breakdown | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Coverage election/option; preserve source choice with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F065 | Service Line Coverage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Coverage election/option; preserve source choice with endorsement/coverage code. | `note:properties[]` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F066 | Identity Theft | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F067 | Replacement Cost Content | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F068 | Increase Liability | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F069 | Personal Injury | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F070 | Special Personal Property | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F071 | Sinkhole Collapse | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F072 | Earthquake Zone | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Zone choice/code; retain carrier/question identity. | `note:properties[]` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F073 | Percent Veneer | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Decimal percentage 0-100; retain carrier/question identity. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F074 | Exclude Masonry Veneer | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Yes/No exclusion election; retain carrier/question identity. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F075 | Business Name | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Text for the property business; separate from insured account legal name; retain carrier/question identity. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F076 | Business Class | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Business class choice/code/text; retain carrier/question identity. | `note:properties[]` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F077 | Incidental Business | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Yes/No election; retain carrier/question identity. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F078 | Safeco: Package Option | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Carrier package option choice/code; retain carrier/question identity. | `note:properties[]` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |

### Home scheduled property

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F079 | Coins: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Coins; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F080 | Coins: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Coins on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F081 | Fine Arts: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Fine Arts; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F082 | Fine Arts: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Fine Arts on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F083 | Furs: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Furs; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F084 | Furs: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Furs on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F085 | Guns: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Guns; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F086 | Guns: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Guns on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F087 | Jewelry: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Jewelry; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F088 | Jewelry: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Jewelry on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F089 | Music: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Music; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F090 | Music: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Music on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F091 | Silverware: Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Currency category total for Silverware; one coverage row identified by scheduled category code, paired with breakage. This is not an individually identified Scheduled Item. | `note:property1` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F092 | Silverware: Breakage | Quote Coverage (`iacrm_quotecoverage`), Quote + matching Property insured item | Yes/No/unknown breakage election for Silverware on the SAME category coverage row as its amount; proposed `iacrm_breakageelection` choice. | `note:property1` | **EXTEND** — REUSE `iacrm_coveragecode` (same category row); CREATE `iacrm_breakageelection`, `iacrm_quoteitemid`; expose coverage-row mapping. |

### Home financial interests

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F093 | First mortgagee | Risk Answer (`iacrm_riskanswer`), Quote + Property insured item | Presence answer for First mortgagee; store its caption/ordinal in Carrier Question identity and answer in Risk Answer `iacrm_value`. No actual party identity is supplied; do not create a lender/interest row from a checkbox. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F094 | Second mortgagee | Risk Answer (`iacrm_riskanswer`), Quote + Property insured item | Presence answer for Second mortgagee; store its caption/ordinal in Carrier Question identity and answer in Risk Answer `iacrm_value`. No actual party identity is supplied; do not create a lender/interest row from a checkbox. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F095 | Third mortgagee | Risk Answer (`iacrm_riskanswer`), Quote + Property insured item | Presence answer for Third mortgagee; store its caption/ordinal in Carrier Question identity and answer in Risk Answer `iacrm_value`. No actual party identity is supplied; do not create a lender/interest row from a checkbox. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F096 | Cosigner | Risk Answer (`iacrm_riskanswer`), Quote + Property insured item | Presence answer for Cosigner; store its caption/ordinal in Carrier Question identity and answer in Risk Answer `iacrm_value`. No actual party identity is supplied; do not create a lender/interest row from a checkbox. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F097 | Equity line of credit | Risk Answer (`iacrm_riskanswer`), Quote + Property insured item | Presence answer for Equity line of credit; store its caption/ordinal in Carrier Question identity and answer in Risk Answer `iacrm_value`. No actual party identity is supplied; do not create a lender/interest row from a checkbox. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F098 | # of Other Interests | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Nonnegative whole-number count; do not create unidentified party records from this count. | `note:property1` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |

### Contacts and drivers

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F099 | Preferred Language | Contact (`contact`) | Existing Contact `iacrm_preferredlanguage` choice; English = 298400000, Spanish = 298400001; map other values from live choices. | `note:contacts[]` | **REUSE + DEPLOY** — Contact `iacrm_preferredlanguage` exists in dev and is absent in production. Deploy the existing definition via the CRM pipeline; expose Contacts (all rows). |
| F100 | Rated Driver | Policy Driver (`iacrm_policydriver`) | Existing Policy Driver rating choice: Rated = 298400000 / Excluded = 298400001 / Non-Driver = 298400002, with Contact and quote/policy context. | `note:contacts[]` | **REUSE** — Policy Driver `iacrm_ratingstatus`, `iacrm_contactid`, `iacrm_quoteid` / `iacrm_opportunityid`; expose Policy drivers (all rows). |
| F101 | Good Driver | Policy Driver / Risk Answer, Quote/Policy context | Yes/No eligibility answer with source question, carrier and applicable window. | `note:contacts[]` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid` and `iacrm_contactid`; expose contextual answer mapping. |

### Auto coverage

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F102 | Bodily Injury | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Split per-person/per-accident limits; retain text and parsed components; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` / `iacrm_limitbasis`; CREATE `iacrm_limitperperson`, `iacrm_limitperaccident`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F103 | Uninsured Motorist | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Coverage/split-limit text and component amounts; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` / `iacrm_limitbasis`; CREATE `iacrm_limitperperson`, `iacrm_limitperaccident`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F104 | Underinsured Motorist | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Coverage/split-limit text and component amounts; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` / `iacrm_limitbasis`; CREATE `iacrm_limitperperson`, `iacrm_limitperaccident`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F105 | Property Damage | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Currency liability limit; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F106 | Auto: Medical Payments | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Currency limit; Auto context; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F107 | MN: Personal Injury Protection Options | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | State-specific option code/text and benefit components; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F108 | MN: PIP Deductible | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Deductible amount, text and unit; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_deductibleamount`, `iacrm_deductibledisplay`, `iacrm_deductiblebasis`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F109 | MN: Work Loss | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Benefit option retaining Included / Excluded; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F110 | Vehicle: Comprehensive | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle deductible value, text and unit; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_deductibleamount`, `iacrm_deductibledisplay`, `iacrm_deductiblebasis`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F111 | Vehicle: Collision | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle deductible value, text and unit; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_deductibleamount`, `iacrm_deductibledisplay`, `iacrm_deductiblebasis`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F112 | Vehicle: Towing & Labor | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle election/limit; preserve No Coverage; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F113 | Vehicle: Rental Expense | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle daily/total limit or option; preserve No Coverage; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limittext` (source option); CREATE `iacrm_optiontext`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F114 | Vehicle: Stated Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle currency stated value; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_limitvalue` / `iacrm_limittext`; CREATE `iacrm_quoteitemid`; expose coverage-row mapping. |
| F115 | Vehicle: Loan/Lease Coverage | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F116 | Vehicle: Liability Not Required | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election, not a blank limit; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F117 | Vehicle: Full Glass | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election; retain coverage code. | `note:opportunity` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |
| F118 | MN: PIP Stacking | Quote Coverage (`iacrm_quotecoverage`), Quote context | Yes/No stacking election, MN state and PIP coverage identity. | `note:opportunity` | **EXTEND** — REUSE `iacrm_coveragecode` / `iacrm_limittext`; CREATE `iacrm_election`, `iacrm_quoteitemid`; expose coverage-row mapping. |

### Auto application and carrier answers

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F119 | Residence is | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Choice preserving owned/rented/home/other distinctions; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F120 | Auto: Multipolicy Discount | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No application answer; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F121 | Auto: Retirement Community | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No Auto application answer; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F122 | AAA Membership Discount | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No eligibility/election; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F123 | Applicant has a company car insured elsewhere | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No answer; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F124 | Nationwide: Auto currently insured in agency? | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No answer; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F125 | Nationwide: Special Physical Damage for Vehicle | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Per-vehicle election/answer; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F126 | Vehicle branded title (salvage/dismantled/flood/junk/buyback/rebuilt/reconstructed) | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Per-vehicle Yes/No; retain full question, not an inferred title brand; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F127 | Foremost: Product to be quoted | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Product category/code such as Combo Auto; store carrier/question/context. | `note:opportunity` | **EXTEND** — REUSE Risk Answer `iacrm_value` and Carrier Question identity/type; CREATE Risk Answer `iacrm_quoteid`; expose contextual answer mapping. |
| F128 | Alternate Garage | Vehicle (`iacrm_vehicle`) | Existing Vehicle `iacrm_alternategarage` Yes/No flag. The observed disabled source supplies no alternate-address value; do not fabricate one. | `note:opportunity` | **REUSE** — Vehicle `iacrm_alternategarage` (Boolean); expose Vehicles (all rows). No address lookup is needed for the observed flag-only source. |
| F129 | Every Driver / Vehicle use percentage | Vehicle Assignment (`iacrm_vehicleassignment`) | Existing Vehicle Assignment row per Contact + Vehicle + quoting/policy context; `iacrm_percentuse` is Decimal 0–100. Quote context can resolve through the existing Policy Driver link. | `note:opportunity` | **REUSE** — `iacrm_vehicleassignment`: `iacrm_contactid`, `iacrm_vehicleid`, `iacrm_percentuse`, `iacrm_policydriverid`, `iacrm_opportunityid` / `iacrm_policyid`; expose all matrix cells. |

### Auto incidents

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F130 | Date of Accident | Driving Incident (`iacrm_drivingincident`) | Date only, preserving source value; same incident row as its other fields. | `note:opportunity` | **EXTEND** — REUSE Driving Incident `iacrm_incidentdate`; CREATE `iacrm_opportunityid` and `iacrm_quoteid` for pre-policy context; expose Driving incidents (all rows). |
| F131 | Accident: Driver | Driving Incident (`iacrm_drivingincident`) | Contact lookup resolved from selected source driver; same incident row as its other fields. | `note:opportunity` | **EXTEND** — REUSE Driving Incident `iacrm_contactid`; CREATE `iacrm_opportunityid` and `iacrm_quoteid` for pre-policy context; expose Driving incidents (all rows). |
| F132 | Accident Description | Driving Incident (`iacrm_drivingincident`) | Reuse `iacrm_description` for the original accident subtype/description. Existing `iacrm_incidenttype` = Accident; set `iacrm_atfault` only from an explicit source answer. | `note:opportunity` | **EXTEND** — REUSE Driving Incident `iacrm_description`; CREATE `iacrm_opportunityid` and `iacrm_quoteid` for pre-policy context; expose Driving incidents (all rows). |
| F133 | PD Amount | Driving Incident (`iacrm_drivingincident`) | Separate currency Property Damage amount; same incident row as its other fields. | `note:opportunity` | **CREATE** — Driving Incident `iacrm_propertydamageamount` (Money); REUSE the existing incident table/identity. Context additions are shared with F130. |
| F134 | BI Amount | Driving Incident (`iacrm_drivingincident`) | Separate currency Bodily Injury amount; same incident row as its other fields. | `note:opportunity` | **CREATE** — Driving Incident `iacrm_bodilyinjuryamount` (Money); REUSE the existing incident table/identity. Context additions are shared with F130. |
| F135 | Collision Amount | Driving Incident (`iacrm_drivingincident`) | Separate currency Collision amount; same incident row as its other fields. | `note:opportunity` | **CREATE** — Driving Incident `iacrm_collisionamount` (Money); REUSE the existing incident table/identity. Context additions are shared with F130. |
| F136 | MP Amount | Driving Incident (`iacrm_drivingincident`) | Separate currency Medical Payments amount; same incident row as its other fields. | `note:opportunity` | **CREATE** — Driving Incident `iacrm_medicalpaymentsamount` (Money); REUSE the existing incident table/identity. Context additions are shared with F130. |
| F137 | Vehicle Involved | Driving Incident (`iacrm_drivingincident`) | Vehicle lookup resolved from selected source vehicle; same incident row as its other fields. | `note:opportunity` | **EXTEND** — REUSE Driving Incident `iacrm_vehicleid`; CREATE `iacrm_opportunityid` and `iacrm_quoteid` for pre-policy context; expose Driving incidents (all rows). |

### Intake account, contact and address

Address additions belong on existing `customeraddress`; live metadata confirms `CanCreateAttributes = true`. Do not create a replacement Address table. Primary Account address fields below remain associated with the Account's primary address.

| ID | Source field | Target entity | Required representation / exact existing or proposed field | Current fallback | Required work |
|---|---|---|---|---|---|
| F138 | Customer since | Account (`account`) | Date only; not CRM createdon. Proposed `iacrm_customersince`. | `note` | **CREATE** — Account `iacrm_customersince`; no equivalent exists in the audited entity. |
| F139 | Assigned producer | Servicing Team Member (`iacrm_servicingteammember`), Account context | Existing `iacrm_regardingid` → Account, `iacrm_partyid` → systemuser/contact, `iacrm_role` = Producer (738590002), `iacrm_scope` = Account (738590001). Resolve the source producer to an existing party. | `note` | **REUSE** — Servicing Team Member Account/party links and Producer role; expose the mapping. Do not create Account `iacrm_assignedproducerid`. |
| F140 | CSR | Servicing Team Member (`iacrm_servicingteammember`), Account context | Existing `iacrm_regardingid` → Account, `iacrm_partyid` → systemuser/contact, `iacrm_role` = CSR (738590004), `iacrm_scope` = Account (738590001). Resolve the source CSR to an existing party. | `note` | **REUSE** — Servicing Team Member Account/party links and CSR role; expose the mapping. Do not create Account `iacrm_csrid`. |
| F141 | VIP | Account (`account`) | Yes/No. Proposed `iacrm_isvip`. | `note` | **CREATE** — Account `iacrm_isvip`; no equivalent exists in the audited entity. |
| F142 | Primary address: ZIP suffix | Account (`account`), primary address | Text(4), leading zeroes preserved. Proposed `iacrm_address1zip4`. | `note` | **CREATE** — Account `iacrm_address1zip4`; no equivalent exists in the audited entity. |
| F143 | Primary address: Years at address | Account (`account`), primary address | Whole number, nonnegative. Proposed `iacrm_yearsatprimaryaddress`. | `note` | **CREATE** — Account `iacrm_yearsatprimaryaddress`; no equivalent exists in the audited entity. |
| F144 | Primary address: Months at address | Account (`account`), primary address | Whole number 0–11. Proposed `iacrm_monthsatprimaryaddress`. | `note` | **CREATE** — Account `iacrm_monthsatprimaryaddress`; no equivalent exists in the audited entity. |
| F145 | Maiden name | Contact (`contact`) | Existing Contact `iacrm_maidenname` (Maiden Name): Text. | `note:contacts[]` | **REUSE + DEPLOY** — Contact `iacrm_maidenname` exists in dev and is absent in production. Deploy the existing definition; expose Contacts (all rows). |
| F146 | Co-applicant | Connection (`connection`) + Connection Role (`connectionrole`), Quote context | Existing Contact ↔ Quote connection using `record1id` / `record2id`, with the Contact side assigned Co-applicant through `record1roleid` / `record2roleid`. Preserve per-Quote context. | `note:contacts[]` | **EXTEND** — REUSE Connection; ENABLE connections on Quote and ADD the missing Co-applicant Connection Role. Do not create `iacrm_quoteparticipant`. |
| F147 | Driver flag | Policy Driver (`iacrm_policydriver`) | Presence of an existing Policy Driver relationship row means driver membership; keep `iacrm_ratingstatus` separate. | `note:contacts[]` | **REUSE** — membership row in `iacrm_policydriver`, linked by `iacrm_contactid` and quote/opportunity/policy; no new driver Boolean. |
| F148 | Deceased | Contact (`contact`) | Yes/No; preserve unknown separately from No. Proposed `iacrm_isdeceased`. | `note:contacts[]` | **CREATE** — Contact `iacrm_isdeceased`; no equivalent exists in the audited entity. |
| F149 | Every address: Person | Address (`customeraddress`) | Existing Address Contact parent lookup, plus source address sequence. Resolve the Person label to the owning Contact; do not store its display name as an address fact. | `note` | **REUSE** — Address `parentid` (Contact binding `parentid_contact`) and `addressnumber`; implement owner resolution. |
| F150 | Every address: ZIP suffix | Address (`customeraddress`) | Text(4), per-address suffix. Proposed `iacrm_zip4suffix`. | `note` | **CREATE** — Address `iacrm_zip4suffix`; no equivalent exists in the audited entity. |
| F151 | Every address: Years at address | Address (`customeraddress`) | Whole number, nonnegative, per address. Proposed `iacrm_yearsataddress`. | `note` | **CREATE** — Address `iacrm_yearsataddress`; no equivalent exists in the audited entity. |
| F152 | Every address: Months at address | Address (`customeraddress`) | Whole number 0–11, per address. Proposed `iacrm_monthsataddress`. | `note` | **CREATE** — Address `iacrm_monthsataddress`; no equivalent exists in the audited entity. |
| F153 | Additional phone: Person | Contact Point (new `iacrm_contactpoint`) | Owning Contact lookup. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F154 | Additional phone: Phone type | Contact Point (new `iacrm_contactpoint`) | Usage-type choice/text, e.g. Home/Work/Mobile. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F155 | Additional phone: Number | Contact Point (new `iacrm_contactpoint`) | Phone/text preserving source value. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F156 | Additional phone: Extension | Contact Point (new `iacrm_contactpoint`) | Text preserving leading zeroes. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F157 | Additional email: Person | Contact Point (new `iacrm_contactpoint`) | Owning Contact lookup. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F158 | Additional email: Email type | Contact Point (new `iacrm_contactpoint`) | Usage-type choice/text. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |
| F159 | Additional email: Email address | Contact Point (new `iacrm_contactpoint`) | Email/text value. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | **CREATE TABLE** — proposed `iacrm_contactpoint`; use the shared columns listed below. Existing Contact scalar slots cannot preserve every typed/extended row. |

## Required child-record and relationship representations

The following tables separate **verified existing** schema from **specific missing additions**. CREATE means missing from the audited target entity in both environments, not missing from a picker. Shared additions are created once, even when referenced by many catalog rows. Lookup names in the existing-bindings table are navigation property names; attribute logical names alone are not always valid `@odata.bind` names.

### Quote Coverage (`iacrm_quotecoverage`)

**REUSE the existing table**, entity set `iacrm_quotecoverages`. All coverage and endorsement rows retain the existing `iacrm_quoteid` relationship. The actual existing lookup attribute is `iacrm_quoteid`, not `iacrm_quote`.

| Disposition | Exact column | Verified type / purpose |
|---|---|---|
| REUSE | `iacrm_quotecoverage_name`, `iacrm_coveragecode` | String display name and stable coverage/endorsement/category code. |
| REUSE | `iacrm_limittext`, `iacrm_limitdisplay` | Original limit/option text and display text. Preserve the original source wording. |
| REUSE | `iacrm_limitvalue` | Decimal scalar limit; can hold the percentage when a paired calculated amount occupies the Money column below. |
| REUSE | `iacrm_limitperoccurrence`, `iacrm_limitaggregate`, `iacrm_limitcsl` | Money columns with the meanings in their names. Do not relabel an aggregate as a per-person amount. |
| REUSE | `iacrm_limitbasis` | Picklist: Per Occurrence 329910000; Per Claim 329910001; Per Person 329910002; Per Accident 329910003; Per Unit 329910004; Not Applicable 329910005. It describes basis, not currency/percent units. |
| REUSE | `iacrm_deductibleamount`, `iacrm_deductibledisplay` | Money amount and original deductible display text. |
| REUSE | `iacrm_deductiblebasis` | Picklist: Per Claim 329910000; Per Occurrence 329910001; Per Policy 329910002; Percentage 329910003; Other 329910004. |
| REUSE | `iacrm_notcovered` | Boolean for explicit Not Covered only. It cannot encode every unknown/election/option answer. |
| REUSE | `iacrm_displayorder`, `iacrm_sortorder`, `iacrm_lineofbusinessid`, `iacrm_quoteid` | Order, line and Quote identity. |
| CREATE | proposed `iacrm_quoteitemid` | Lookup to existing `iacrm_quoteitem`, which already links Quote and Insured Item. Quote Coverage currently has no asset/Quote Item link. Reuse the Quote Item to identify the matching Property/Vehicle. |
| CREATE | proposed `iacrm_limitunit` | Choice: Currency / Percentage / Count / Option, with blank/unknown preserved. No existing unit choice has these meanings. |
| CREATE | proposed `iacrm_optiontext` | String for basis/option answers such as Custom, loss-settlement basis, PIP option, Included/Excluded, towing/rental option. `iacrm_limitbasis` cannot store these categories. Preserve original text in `iacrm_limittext` too. |
| CREATE | proposed `iacrm_election` | Choice: Yes / No / Unknown or Not Asked. For endorsement/election flags; do not turn an unasked question into No. |
| CREATE | proposed `iacrm_deductiblepercentage` | Decimal 0–100 for percentage deductibles. The existing Money amount is not a percentage. |
| CREATE | proposed `iacrm_limitperperson`, `iacrm_limitperaccident` | Two Money columns for the separate components of Auto split limits. These exact representations are absent. |
| CREATE | proposed `iacrm_breakageelection` | Choice: Yes / No / Unknown or Not Asked, on a scheduled-category coverage row. |

**REUSE existing Quote Item (`iacrm_quoteitem`, entity set `iacrm_quoteitems`)** for the asset schedule: `iacrm_quoteid` identifies the Quote and `iacrm_insureditemid` identifies the asset. Its existing `iacrm_limit`, `iacrm_deductible` and `iacrm_coveragedescription` describe the item as a whole; they cannot hold multiple separately coded coverage rows. The proposed Quote Coverage link attaches those rows to the existing scheduled item without introducing a second asset relationship model.

Other Structures percentage and calculated Amount share **one** coverage row: percentage in `iacrm_limitvalue`, calculated currency in `iacrm_limitperoccurrence`, unit = Percentage. Loss Of Use uses the same representation. Personal Property option and Amount share **one** coverage row using `iacrm_optiontext` and `iacrm_limitvalue`. Do not create extra Property rows or write new-policy limits to Prior Coverage.

For rental daily/total and PIP compound options, keep the complete option in `iacrm_optiontext`/`iacrm_limittext`; parsing must not discard a component. This handoff does not propose additional numeric component columns for source values that are only supplied as a combined option.

### Risk Answer and Carrier Question

**REUSE `iacrm_riskanswer` and `iacrm_carrierquestion`.** Neither requires a replacement table. Existing answers are stored as String `iacrm_value` with the question defining the answer type; do not invent additional Boolean/number columns merely to duplicate that representation.

| Disposition | Exact existing / proposed column | Representation |
|---|---|---|
| REUSE | Risk Answer `iacrm_value` | Original answer text. Interpret its type and allowed options using the associated question metadata. Keep unknown, No and zero distinct. |
| REUSE | Risk Answer `iacrm_carrierquestionid` | Lookup to the question definition. |
| REUSE | Carrier Question `iacrm_questionid`, `iacrm_canonicalkey`, `iacrm_carrierquestion_name` | Stable question ID/key plus full display caption. Different mortgagee ordinals and carrier/state versions need distinct identities. |
| REUSE | Carrier Question `iacrm_answertype`, `iacrm_optionsjson` | Existing answer-type String and choice-options Memo; use for Boolean, number, date, choice and text interpretation. |
| REUSE | Carrier Question `iacrm_carriername`, `iacrm_state`, `iacrm_lob`, `iacrm_source` | Carrier/state/line/source context. |
| REUSE | Risk Answer `iacrm_accountid`, `iacrm_insureditemid` | Insured and matching Property/Vehicle wrapper. The insured-item link already exists. |
| REUSE | Risk Answer `iacrm_source`, `iacrm_sourceapplicationid`, `iacrm_capturedon` | Provenance and source application ID. A String application ID is not a Quote lookup. |
| CREATE | proposed Risk Answer `iacrm_quoteid` | Quote lookup for quote-scoped questions. No Quote/Application/Policy relationship is present on the existing answer table. |
| CREATE | proposed Risk Answer `iacrm_contactid` | Contact lookup for driver-specific eligibility answers such as Good Driver. No Contact/Policy Driver link exists on Risk Answer. |

For F093–F097, capture the checkbox as a Risk Answer with Property insured-item context and question identity. Actual lender data, when independently supplied, can reuse Additional Interest. Presence flags and counts do not identify parties.

### Property Renovation (`iacrm_propertyrenovation`)

**REUSE all four needed columns:** `iacrm_propertyid` (lookup), `iacrm_system` (choice), `iacrm_extent` (choice), `iacrm_year` (Integer). Entity set `iacrm_propertyrenovations`; existing parent navigation `iacrm_propertyid` binds to `iacrm_properties`.

| Existing choice | Verified options | Exact missing work |
|---|---|---|
| `iacrm_system` | Wiring 298400000; Plumbing 298400001; Heating 298400002; Roofing 298400003; Exterior Paint 298400004 | **ADD Cooling** for F032. Map source Electrical to existing Wiring. Do not create another system column. |
| `iacrm_extent` | Partial 298400000; Complete 298400001 | **ADD Not Updated** for the explicit source choice. Blank is unknown and cannot substitute for Not Updated. Do not create another extent column. |

New choice integers must be allocated in the canonical solution and returned after deployment. Pair each system's extent and year on one row. **Roofing: Year Updated already uses Property `iacrm_roofyear`**; preserve it and associate it with Roofing history when child mapping is implemented.

### Scheduled category totals and actual Scheduled Items

F079–F092 supply Coins, Fine Arts, Furs, Guns, Jewelry, Music and Silverware **category totals and breakage elections**, without individual item identity. Use one **Quote Coverage** row per category, linked to the matching Property insured item. Reuse its code/limit columns and create only the shared coverage additions listed above.

The existing `iacrm_scheduleditem` table is for actual assets. It has `iacrm_itemclass`, `iacrm_value`, owner and its **own** `iacrm_insureditemid` wrapper, but has no Quote lookup, containing-Property lookup or breakage attribute. Its own insured-item link is not a parent Property link. Do not fabricate individually identified item records from category totals, and do not create a second Scheduled Item table. Real item details can reuse that existing table when supplied by a future source.

### Additional Interest (`iacrm_additionalinterest`)

**REUSE for actual identified interests:** `iacrm_insureditemid`, `iacrm_interestedpartyid`, `iacrm_interesttype`, `iacrm_ismortgagee`, `iacrm_priority`, `iacrm_loanoraccountnumber`, existing lender/contact/address fields, and the existing Policy/Policy Item links. Entity set `iacrm_additionalinterests`. Its insured-item navigation is `iacrm_insureditemid`; interested-party navigation is `iacrm_InterestedPartyId`.

The source in this inventory supplies presence checkboxes, not identified lenders; F093–F097 therefore use Risk Answer. **No new Additional Interest column is required for these source flags.** Other Interests count also uses Risk Answer. Existing Property Party (`iacrm_propertyparty`) represents identified accounts with an interest in a property; it is not an unidentified checkbox or a quote participant.

### Policy Driver (`iacrm_policydriver`)

**REUSE; this table already exists in current dev.** Entity set `iacrm_policydrivers`. No new Policy Driver table, membership Boolean or rating-status column is needed for F100/F147. Expose Policy drivers (all rows) in the extension.

| Existing columns | Verified representation / source use |
|---|---|
| `iacrm_name`, `iacrm_contactid`, `iacrm_accountid` | Name and Contact/Account lookups; resolve actual identities. |
| `iacrm_quoteid`, `iacrm_opportunityid`, `iacrm_policyid`, `iacrm_lineofbusinessid` | Existing quote/opportunity/policy/line context. |
| `iacrm_ratingstatus` | Rated 298400000; Excluded 298400001; Non-Driver 298400002. |
| `iacrm_sr22filed`, `iacrm_fr44filed` | Existing Boolean Filed columns. Observed source supplies Required, which already maps to Contact `iacrm_sr22` / `iacrm_fr44`; do not infer Filed. |
| `iacrm_carrierdrivernumber`, `iacrm_effectivedate`, `iacrm_enddate`, `iacrm_source` | Existing provenance/lifecycle fields; no observed source answer for carrier number or membership dates. |

Use one row per Contact + quote/policy context. Excluded people remain Contacts with Excluded relationship rows. Preserve the legacy Contact `iacrm_driverratingstatus` until a separate migration review; metadata inspection did not read populated driver records or establish migration counts.

### Driving Incident (`iacrm_drivingincident`)

**REUSE the existing table**, entity set `iacrm_drivingincidents`. Do not create it again.

| Disposition | Exact columns | Representation |
|---|---|---|
| REUSE | `iacrm_name`, `iacrm_contactid`, `iacrm_accountid`, `iacrm_vehicleid`, `iacrm_policyid` | Existing row label and driver/insured/vehicle/policy lookups. |
| REUSE | `iacrm_incidentdate` | Existing DateTime attribute for the incident date; retain the date-only source meaning without a timezone shift. |
| REUSE | `iacrm_incidenttype` | Accident 298400000; Violation 298400001; Comprehensive Claim 298400002; Suspension 298400003; Other 298400004. |
| REUSE | `iacrm_description`, `iacrm_atfault` | Memo source subtype/description and Boolean explicit fault answer. No separate coded subtype is supplied by the observed source. |
| REUSE | `iacrm_amountpaid`, `iacrm_points`, `iacrm_source` | Money total, Integer points, String provenance. No observed separate total/points answer; do not put a component in Amount Paid or fabricate a total. |
| CREATE | proposed `iacrm_propertydamageamount`, `iacrm_bodilyinjuryamount`, `iacrm_collisionamount`, `iacrm_medicalpaymentsamount` | Four separate Money columns for F133–F136. None exists in dev. |
| CREATE | proposed `iacrm_opportunityid`, `iacrm_quoteid` | Pre-policy context lookups. Only the Policy lookup currently exists. |

No stable source incident ID was exposed in this audit. Before enabling repeat loads, define reconciliation that preserves multiple same-day incidents; driver + date + incident type alone is not unique. If a later source exposes an incident ID, scope its persisted representation to that observed contract instead of inventing IDs from row order.

### Vehicle Assignment (`iacrm_vehicleassignment`)

**REUSE the complete existing relationship**, entity set `iacrm_vehicleassignments`. Its description explicitly covers which driver uses which vehicle/boat/equipment and what percent of use. No new assignment table or percentage column is required.

| Existing column | Representation / use |
|---|---|
| `iacrm_contactid`, `iacrm_vehicleid` | Driver and Vehicle lookups; resolve both matrix axes. |
| `iacrm_percentuse` | Decimal percent 0–100; one row per matrix cell. |
| `iacrm_policydriverid` | Existing Policy Driver link, including Quote context through that row. |
| `iacrm_opportunityid`, `iacrm_policyid`, `iacrm_accountid`, `iacrm_insureditemid` | Existing quoting/policy/insured/asset context. |
| `iacrm_isprincipaloperator`, `iacrm_source`, `iacrm_name` | Existing principal-operator flag, source and row label. |

Implement the collection writer and identity/upsert rule. Preserve all matrix cells and source totals without silently normalizing. Vehicle `iacrm_primarydriverid` alone does not capture the matrix. The source only exposes an Alternate Garage flag; reuse Vehicle `iacrm_alternategarage` without adding an unused address column.

### Assigned Producer and CSR: REUSE Servicing Team Member

**REUSE `iacrm_servicingteammember`**, entity set `iacrm_servicingteammembers`. Both an Account parent and the Producer/CSR roles already exist. Do not create new Account producer/CSR columns or a second staffing model.

| Existing column | Verified representation |
|---|---|
| `iacrm_regardingid` | Polymorphic parent with an existing Account target; navigation `iacrm_regardingid_Account_account`. Opportunity and Policy targets also exist. |
| `iacrm_partyid` | Existing party lookup to systemuser or contact; navigation `iacrm_partyid_systemuser` or `iacrm_partyid_contact`. Resolve a unique existing party from the source; never create a user from a name. |
| `iacrm_role` | Existing choice: Producer = 738590002; CSR = 738590004. Other roles are Service Manager 738590000, Account Manager 738590001 and Additional Agent 738590003. |
| `iacrm_scope` | Existing Account = 738590001; Opportunity = 738590000; Policy = 738590002. |
| `iacrm_name` | Existing display name. |

Map F139/F140 to Account-scoped team rows and preserve existing/manual staffing assignments under an explicit reconciliation rule. The separate Producer table does not need to be duplicated, and a Producer record must resolve to the linked internal user or appropriate existing external contact for this party lookup. Leave the AMS identity/sync and dormant commission columns under their existing contracts; capturing an EZLynx assignment does not authorize an AMS synchronization.

### Additional contact methods: CREATE Contact Point

**CREATE proposed `iacrm_contactpoint`**, one child per typed phone/email row. It is absent from both environments, and the alternate models reviewed above do not supply this ownership/type/value/extension contract. Standard Contact has a finite set of scalar phone/email slots; those slots cannot preserve an arbitrary number of rows with usage type, extension and sequence. The existing `msdynmkt_contactpointconsent*` tables store marketing consent, not contact-owned method rows, and must not be repurposed.

| Proposed new column | Representation |
|---|---|
| `iacrm_name` | Required String display name, derived from channel/type. |
| `iacrm_contactid` | Required Contact lookup; Person resolves to this owner. |
| `iacrm_channel` | Choice Phone / Email. |
| `iacrm_usagetype` | String source usage label, preserving Home/Work/Mobile/Other. |
| `iacrm_value` | String preserving phone number or email, with channel-specific validation. |
| `iacrm_extension` | String phone extension, preserving leading zeroes. |
| `iacrm_sourcesequence` | Integer source sequence for display/reconciliation, not a stable identity by itself. |
| `iacrm_source` | String provenance. |

Expose Contact points (all rows) and return the actual deployed entity set/navigation names. Repeated loads need an explicit owner/channel/value matching strategy that preserves intentional duplicates and does not rely only on row position.

### Co-applicant: EXTEND and REUSE Connections

**Do not create `iacrm_quoteparticipant`.** Both environments already have the standard `connection` and `connectionrole` tables. They support a role-bearing link from Contact to the existing custom Quote once Connections are enabled on Quote. Microsoft documents this capability for customizable tables: [Connections](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/connection-entities) and [connection-role configuration](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/configure-connection-roles).

| Disposition | Existing representation / exact configuration |
|---|---|
| REUSE | `connection.record1id` and `connection.record2id`: Contact and `iacrm_quote` endpoints. |
| REUSE | `connection.record1roleid` / `connection.record2roleid`: apply Co-applicant to the Contact endpoint, rather than the Quote endpoint. |
| REUSE | `connection.description`, `effectivestart`, `effectiveend`, `statecode` when applicable; do not fabricate missing dates. |
| ENABLE CAPABILITY | Set `iacrm_quote.IsConnectionsEnabled.Value = true` through the canonical solution/pipeline. It is false in both snapshots, with change permitted. Contact is already enabled. A disabled capability does not mean the relationship model is absent. |
| ADD CONFIGURATION | Add solution-owned Connection Role **Co-applicant**, scoped to Contact and the intended Quote connection. Both environments have 35 Connection Roles, none providing this applicant role. Return the actual role identity/row-type configuration after deployment. Do not hard-code an unrelated role ID. |
| IMPLEMENT MAPPING | Resolve Contact + Quote and upsert the contextual connection. The platform maintains a reciprocal record; reconciliation must not count or create the reciprocal twice. |

F146 retains `note:contacts[]` until Quote identity, capability/role deployment and mapping are available. Application already has a Quote Source lookup; use that Quote context. The existing Opportunity Relationship (`customeropportunityrole`) is an alternate relationship table, but its Opportunity context would broaden a per-Quote answer; it is not the chosen destination. Servicing Team Member is for staffing and must not receive a Co-applicant staffing role.

### Verified existing lookup navigation names

| Table / entity set | Attribute → `@odata.bind` navigation |
|---|---|
| Quote Coverage / `iacrm_quotecoverages` | `iacrm_quoteid` → `iacrm_QuoteId` |
| Quote Item / `iacrm_quoteitems` | `iacrm_quoteid` → `iacrm_QuoteId`; `iacrm_insureditemid` → `iacrm_InsuredItemId` |
| Servicing Team Member / `iacrm_servicingteammembers` | `iacrm_regardingid` → `iacrm_regardingid_Account_account` for Account; `iacrm_partyid` → `iacrm_partyid_systemuser` or `iacrm_partyid_contact` |
| Property Renovation / `iacrm_propertyrenovations` | `iacrm_propertyid` → `iacrm_propertyid` |
| Risk Answer / `iacrm_riskanswers` | `iacrm_accountid` → `iacrm_accountid`; `iacrm_carrierquestionid` → `iacrm_carrierquestionid`; `iacrm_insureditemid` → `iacrm_insureditemid` |
| Policy Driver / `iacrm_policydrivers` | `iacrm_contactid` → `iacrm_ContactId`; `iacrm_accountid` → `iacrm_AccountId`; `iacrm_quoteid` → `iacrm_QuoteId`; `iacrm_opportunityid` → `iacrm_OpportunityId`; `iacrm_policyid` → `iacrm_PolicyId` |
| Driving Incident / `iacrm_drivingincidents` | `iacrm_contactid` → `iacrm_ContactId`; `iacrm_accountid` → `iacrm_AccountId`; `iacrm_vehicleid` → `iacrm_VehicleId`; `iacrm_policyid` → `iacrm_PolicyId` |
| Vehicle Assignment / `iacrm_vehicleassignments` | `iacrm_contactid` → `iacrm_ContactId`; `iacrm_vehicleid` → `iacrm_VehicleId`; `iacrm_policydriverid` → `iacrm_PolicyDriverId`; `iacrm_opportunityid` → `iacrm_OpportunityId`; `iacrm_policyid` → `iacrm_PolicyId` |
| Address / `customeraddresses` | `parentid` → `parentid_contact` for Contact; `parentid_account` for Account |

All new lookups still require their actual deployed navigation names to be returned; do not assume a casing convention from these existing examples.

## Existing destinations to reuse and confirmed mapping fixes

These entries complete the handoff but are not requests to duplicate existing CRM columns.

| Source field / area | Current typed representation | Required action |
|---|---|---|
| Prior Employer In Years | `crm:contacts[].iacrm_prioryearsemployed` | Already exists; preserve applicant-first row identity. |
| Prefix / Suffix | Current capture uses `contact.salutation` / `contact.suffix` | **REUSE + DEPLOY / mapping fix:** [3744](https://dev.azure.com/BettersAgencyLLC/D365%20Insurance%20CRM/_workitems/edit/3744) design names existing dev choices `contact.iacrm_prefix` / `contact.iacrm_suffix` as canonical; they are absent in production. Deploy those definitions and map source labels to their choices. Retain standard text columns as legacy free text; do not create duplicate choices or overwrite historical values. QuoteCraftZ follow-up F2 is not delivered by the CRM form story. |
| Contact Time | `contact.preferredappointmenttimecode` | Reuse existing choice values. |
| Applicant Postal Code | `account.address1_postalcode` | Reuse; keep separate from the Property postcode. |
| DL Status / DL State | `contact.iacrm_dlstatus` / `contact.iacrm_dlstate` | Reuse. |
| Age Licensed / License Suspended / SR-22 / FR-44 | Contact `iacrm_agefirstlicensed`, `iacrm_licensesuspended`, `iacrm_sr22`, `iacrm_fr44` | Reuse; Required is different from Filed on a Policy Driver. |
| Good Student / Student Away / Driver Education / Mature Driver / Driver Telematics | Contact `iacrm_goodstudent`, `iacrm_studentaway`, `iacrm_drivereducation`, `iacrm_maturedriver`, `iacrm_telematicsagreement` | Already mapped through Contacts (all rows); retain source meaning and choice type. |
| Defensive Driver Course Date | `contact.iacrm_defensivedrivercoursedate` | Reuse; do not infer completion from an empty date. |
| Prior carrier / expiry / premium / years with carrier / years continuous | Prior Coverage `iacrm_priorcarriername`, `iacrm_expirationdate`, `iacrm_premium`, `iacrm_yearswithpriorcarrier`, `iacrm_yearscontinuouscoverage` | Reuse; add only missing month components from the catalog. |
| Prior liability / prior term | Prior Coverage `iacrm_liabilitylimits`, `iacrm_policyterm` | Reuse. Prior term and new Quote term use different choice contracts. |
| New policy term / effective date / description | Quote `iacrm_term`, `iacrm_effectivedate`, `iacrm_description` | Reuse. Verified dev choices: 6 Months = 738590203; 12 Months = 738590205. |
| Primary-address Unit AND Address line 2 | Data Service maps BOTH `applicant.unit` and `applicant.address2` to `address.street2` | **REUSE / mapping fix:** retain Line 2 in Account `address1_line2`; use existing Account `address1_line3` for Unit, matching every-address `customeraddress.line3`. Expose the corresponding primary-address key and stop both source fields writing `street2`. No new Account unit column is required. |
| Every-address Unit | `crm:addresses[].line3` | Existing representation; reconcile primary-address handling without losing Unit or Line 2. |
| Est. Replacement Cost | Saved preset: `crm:property1.iacrm_value` | **REUSE:** verified live dev label is Reconstruction cost, type Money. The separate `iacrm_marketvalue` column exists. No new reconstruction-cost column is needed. |
| Occupation | Data Service: `contact.iacrm_employmentoccupation`; page: `contact.iacrm_occupation` | **REUSE / mapping fix:** canonical `iacrm_occupation` is a Picklist described as employment occupation on the EZLynx applicant, filtered by Industry. `iacrm_employmentoccupation` is String Occupation (other), explicitly for Other or historical typed values. Map known choices to `iacrm_occupation`; retain free text in the existing other field. No new occupation column is needed. |
| Property physical fields already mapped | Address lines/city/state/county/ZIP; usage; occupancy; area; year built; construction; stories; roof material; foundation; walls; heat/secondary heat; alarms; smoke/sprinklers; locks/extinguisher; purchase data; fire distances; protection class; city limits; roof year; pool; nonsmoker; neighbor visibility; manned security | Preserve existing typed fields; add only identified gaps. |
| Vehicle fields already mapped | VIN/year/make/model/trim; purchase date; cost new; miles/odometer; modifications; damage/delivery; use; restraints/airbags; theft/ABS/daytime lights; performance; commute frequency; new/used; ownership; carpool; telematics; TNC | Preserve Vehicles (all rows). Alternate garage and assignments are the gaps above. |
| SSN / driver's-license number | Local Secured: Contacts (all rows), separate pass-through channel | Preserve field security; never use ordinary text or notes as fallback. Share exports exclude these bindings. |

## Implementation sequence and return contract

1. Use the cross-environment dispositions above. Refresh metadata if either environment has changed and check managed dependencies. Do not recreate a named REUSE field/table or the existing dev language/maiden-name definitions. Compare the selected production release baseline through the pipeline.
2. Create only missing representations in the canonical CRM solution. Retain existing forms/views/apps and add the required fields/subgrids there.
3. Return exact logical names, entity set names, lookup `@odata.bind` navigation names, choice integers, required fields, matching/upsert keys, security privileges and solution version to the extension implementation.
4. Expose missing extension collection targets, identity resolvers and child writers. A new attribute can appear in the live catalog; a new child table also needs its collection target, parent binding and load behavior implemented.
5. Replace each temporary fallback only after typed capture, CRM write and read-back succeed. Retain old notes as history and define reconciliation before replaying them.
6. Record field-by-field dev acceptance evidence, GitHub PR/commit links and deployment outcome on one accountable ADO work item.

CRM changes follow `bettersflyguy/BettersInsuranceCRM`: feature PR from current `dev`, change note, Deploy dev workflow, observed-state capture/sync, authenticated dev browser acceptance, release PR to `main` and Promote production. Read that repository's current `AGENTS.md` and `docs/PIPELINE.md`. This handoff does not authorize direct customization/import outside that pipeline. Keep AMS-owned columns isolated; verify privileges and avoid granting the Momentum connector access to new driver/incident data by default.

## Acceptance criteria

- Two properties with different answers resolve to the matching Property records. No Property answers land on Account or the other Property.
- Multiple labels survive per Property. System update fields do not create extra Property rows.
- Home and Auto equal captions retain line/context; coverage limits, percent units, bases and deductibles read back with source meaning.
- Driver row 1 resolves to the applicant; other rows resolve to actual Contacts, including after reordering. SSN/DL never enters ordinary notes/captures.
- Every driver/vehicle percentage resolves to both correct identities. Source totals are checked without silently changing them.
- Each incident retains its driver, vehicle, date, subtype and four separate amounts; multiple same-day incidents remain separate.
- Additional phones/emails/addresses retain their owner, type and sequence. Unit and Line 2 do not overwrite each other.
- Repeat loads follow the agreed reconciliation/upsert behavior without duplicate children or loss of manual CRM changes.
- Every catalog field ID has an implementation disposition and evidence; unresolved fields retain their stated fallback.

## Observed scope and limits

The browser configuration has 237 page mappings and 63 mapped Data Service fields. The previous audit found zero unmapped rendered fields across Applicant Details and the observed Home/Auto screens. Search, template, prefill and apply-to-all controls are source configuration controls, not new CRM risk fields.

Home Carrier Questions/Valid exposed no additional data fields. Auto's extra Carrier Questions were gated by existing source validation errors and remain outside this inventory until rendered. Empty violations/comp-loss sections were inspected without creating records; future incident attributes above are marked when no observed source answer exists.

No CRM schema was deployed and no real client load was performed to verify this handoff. QuoteCraftZ 0.1.80 passed 527 tests; Property-note binding uses mocked Dataverse tests. CRM implementation still requires pipeline deployment and actual dev browser/read-back acceptance.
