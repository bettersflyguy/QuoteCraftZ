# EZLynx Choice mapping browser audit — 2026-11-21

The source/CRM-name search is installed in both mapping editors. The browser audit resumed after Nathan signed in and covered the applicant, rendered Home application screens, and rendered Auto application screens for the existing sample application. The saved configuration now contains **262 page mappings and 63 data-service mappings**. PL Rater remains at 42 mappings.

This is a review of the controls available in this application, not proof that every conditional field for every state, carrier, industry, or incident has been exercised. The sample has no incidents. No fictitious accidents or alternate applicant answers were entered to expose conditional controls. Notes fallbacks preserve information; they do not populate dedicated coverage child tables or make unmatched CRM choices ready for reverse fill.

## Search and reader changes

- Search matches source labels, sections, keys, target schema paths and CRM display labels. Filtering preserves saved mappings and page highlights. Selecting a source field clears the filter.
- Changing search closes Choice editors, and only one page Choice reader opens at a time (82383be), avoiding overlapping source menus.
- Checkbox readers return Yes/No without clicking the source checkbox (99d4dfa). The source page must be refreshed to replace an already-injected old reader because of its load guard.
- Build passed. Search delivery full suite: 634 passed, with one existing performance timing assertion failing under parallel load; its isolated 37-test suite passed. After the checkbox fix, all 39 reader tests passed and build passed. Both installed extension directories received the build.

One transient source change occurred during verification: the still-injected old reader toggled Inside City Limits off. Its original checked state was restored immediately, and the page was refreshed to discard the reverted dirty form state. The revised reader then returned Yes/No without changing the checkbox. No quote save was performed for that transient change. Subsequent reads used the refreshed reader.

## Applicant and driver choices

| Field | Browser/metadata verification and saved result |
|---|---|
| DL Status | All seven source choices exactly match CRM: Valid, Permit, Expired, Suspended, Cancelled, Not Licensed, Permanently Revoked. |
| Marital Status | All six source choices exactly match CRM: Separated, Single, Married, Domestic Partner, Widowed, Divorced. |
| Gender | Female/Male match. Not Specified has no CRM equivalent. Added contact-notes targets in page and data-service mappings to preserve the source answer. |
| Education | All ten source choices match; Phd normalizes to PhD. |
| Industry | Read all 24 choices. Saved Homemaker/House person → Homemaker/Houseperson and Travel/Transportation/Warehousing → Travel/Transportation/Storage in both page and data-service option scopes; the other 22 match automatically. |
| Occupation — Medical branch | Read 24 source titles. Saved Doctor → Physician/Surgeon; Nurse - C.N.A. → Nursing Assistant/Home Health Aide; Nurse - LPN → Nurse (RN/LPN). Nine other automatic matches verified. Twelve titles lack a sufficiently precise equivalent; see gaps below. Data-service Occupation (other), a String, retains the full title. |
| Occupation — Student branch | Inspected the additional driver's dropdown: Graduate Student, High school, Other, Undergraduate. Saved Graduate Student → Graduate Student, High school → High School Student, Undergraduate → College Student. Other already matches. Verified active CRM metadata and saved values in the browser Choice editor. |
| Relationship | Insured and additional-driver choices inspected. Child, Domestic Partner, Employee, Other and Parent have exact CRM equivalents. Saved Relative → Other Relative in both option scopes. All three visible drivers use Contacts (all rows). |
| Applicant Type | Prospect/Lead → Prospect verified; saved Active Client → Customer. Unknown and Inactive Client are not relationship types. Added insured-notes fallback to retain the source status without inventing an account relationship. |
| Lead Source | Read 23 available source choices. Active CRM exposes only Default Value. No advertising/referral/provider was assigned to that value. Added primary-contact notes alongside the existing data-service target. |
| Preferred Contact Method | Home Phone on this sample and service Phone both match Phone. Available methods depend on the contact methods present. |
| Contact Time | Morning/Afternoon/Evening match. Anytime has no CRM choice; added contact-notes target to preserve it. |
| Driver flags | Fresh scan verified contact-array mappings across all three drivers for license suspension/revocation, SR-22, FR-44, Good Student, Student Away, Driver Education, Mature Driver and telematics. Active metadata confirms these destinations are Boolean, not Picklist. Age First Licensed is Integer. Rated Driver and Good Driver preserve source wording in each contact's notes. |

The primary driver's disabled Relationship control exposes only Insured to the automatic reader. The additional driver's dropdown was inspected separately. The Medical and Student occupation branches were inspected without changing the client's Industry.

## Vehicle choices

| Field | Saved result |
|---|---|
| Was the car new? | Corrected Yes → New; No → Used. |
| Performance | Standard/Sports/Intermediate match; High Performance → High verified. |
| Ownership Type | Owned/Leased match; saved Lien → Financed. |
| Vehicle Use | Saved To/From Work → Commute; existing To/From School → Commute verified. Business → Business, Farming → Farm, Pleasure → Pleasure. Added Opportunity-notes target to preserve the work/school distinction. |
| Anti-Theft | None, Active, Alarm Only, Passive and Vehicle Recovery System have equivalents. Both Active and Passive and VIN# Etching do not. Added Opportunity-notes target for the full source wording. |
| Passive Restraints → Airbags | Corrected Airbag (Drvr Side) → Driver; Airbag Both Sides → Driver and passenger. Saved combination values to their airbag component. None matches. Automatic Seatbelts has no Airbags equivalent; added Opportunity-notes target to preserve restraint details. |

Vehicle-array bindings remain Vehicles (all rows). Anti-lock brakes, daytime running lights, car pool, telematics, transportation-network company, delivery use and prior damage have Boolean CRM destinations. Days per week and weeks per month are Integer; year/make/model/trim retain their appropriate number/text representations. They do not require a Picklist editor simply because the source uses a dropdown.

## Home choices and incorrect targets corrected

| Field | Saved result |
|---|---|
| Usage | Primary/Secondary/Seasonal/Farm match. COC has no equivalent. Added Properties notes alongside the choice target. |
| Occupancy | Owner Occupied → Owner, Unoccupied/Vacant match. Saved Renter Occupied → Tenant. |
| Foundation Type | Fourteen construction types were incorrectly mapped to a CRM Open/Closed/None choice. Replaced with Properties (all rows) notes. |
| Exterior Walls | Siding materials were incorrectly mapped to a Boolean Walls column. Replaced with Properties (all rows) notes. |
| Number of Occupants | Replaced notes fallback with existing Household residents, iacrm_householdresidents, Properties (all rows). |
| Feet From Hydrant | Range such as 1-500 was incorrectly mapped to an exact Integer distance. Replaced with Properties notes. |
| Number of Stories / Protection Class | Active CRM types are Decimal / String, preserving fractional stories and alphanumeric protection classes. |
| Burglar Alarm / Smoke Detector | Central/Direct/Local match. Fire Detection remains a separate notes field. |
| Sprinklers | Partial/Full match. A blank placeholder is not an explicit None answer. |
| Secondary Heating | Read 15 choices. Saved Natural Gas → Gas and both Coal installation variants → Solid Fuel. Existing Electric and automatic Electric Portable, Propane variants, Oil, Other and Wood variants verified. Kerosene/Solar lack exact choices. Added Properties notes to retain fuel, installation and portable detail. |
| Inside City Limits | Saved Yes → Inside, No → Outside. Verified safe checkbox reader after source refresh. |
| Pool presence | Checkbox Yes/No cannot determine Above Ground versus In Ground. Replaced Swimming Pool type mapping with notes on the current property. |

Roof material, architectural Construction Style and Heating Type retain source text. Dwelling type, roof design, fire detection, bath/stove counts and renovation selections retain property notes where no appropriate active structured mapping is configured.

## Policy, coverage, endorsements and carrier screens

- Auto Prior Policy Term: reader verified 6 Month / 12 Month exact matches. New Policy Term has the same source choices and existing explicit aliases to Quote Term 6 Months / 12 Months.
- Prior carrier, prior liability limits and prior/continuous coverage years use String targets, preserving labels such as More than 15. Other policy answers preserve notes.
- Home Coverage: all eight selectors (Other Structures, Personal Property, Loss Of Use, Personal Liability, Medical Payments, All Perils, Theft and Wind Deductibles), Building Settlement and financial-interest checkboxes have property-notes bindings after a fresh scan.
- Home Endorsements: all 13 selector bindings, including disabled Business Class, earthquake zone/deductible, equipment breakdown, card/jewelry/mold limits, replacement percentage, loss assessment, ordinance/law, package, service line and water backup, preserve Properties notes. Checkbox endorsements retain property notes.
- Home Carrier Questions: all 15 rendered choice controls now preserve Properties notes. Oil Storage was taught with the page selector. Fourteen additional source-specific selectors were imported using the supported Settings transfer. Every control was verified green on the source page, including Foremost, Liberty Mutual and Nationwide sections.
- Auto Coverage: general limits, Minnesota PIP options/deductible/work loss, credits, and all three vehicle coverage sections were checked after a fresh scan. Their selectors preserve Opportunity notes, including No Coverage, Unlimited, and compound rental limits. Apply Coverage to all Vehicles is a procedural control marked Never fill.
- Auto Carrier Questions: all ten rendered choice controls now have specific bindings. Existing Nationwide telematics consent retains its CRM targets. Liberty coverage level / other-policy type, Nationwide life/financial products / payment / multiline, Travelers IntelliDrive and the three Stillwater rideshare answers preserve Opportunity notes. The rideshare family highlights all three rows.
- Two old positional carrier selectors incorrectly outlined unrelated agent-input boxes, including a vehicle-use target around agent IDs. They and the ambiguous shared text:questionInput mapping are now Never fill. Specific selector/label mappings replace them. Fresh browser verification shows agent IDs no longer outlined as transportation-network-company data.

These notes mappings preserve source labels for all choices without forcing them into an unrelated enum. Blank source answers remain blank. Carrier agent-code/name and other-policy-number text controls need separate precise mappings; this Choice audit does not mark those done.

## Evidence and remaining limits

The final browser export was read back and compared with the prepared import: all **260 shareable page targets and 61 shareable data-service targets** match exactly. Two secured targets in each scope are retained locally, explaining the UI totals 262 / 63. Existing PL Rater mappings are unchanged. No CRM client records or customizations were written.

- `audits/ezlynx-choice-options-2026-11-21.json`: exported saved option values for page and data-service scopes, without customer values.
- `audits/ezlynx-choice-mapping-corrections-2026-11-21.json`: 37 page-target additions/corrections since the vehicle-audit checkpoint; schema and selectors only.
- The local Downloads folder holds the full before/after backups. They are not committed because full settings include environment configuration.

Remaining CRM representation gaps include: Anytime, Not Specified gender, lead-source taxonomy, Unknown/Inactive applicant status versus relationship, COC usage, foundation construction type, exterior-wall material, hydrant-distance ranges, pool presence versus pool construction, Kerosene/Solar heating, combined anti-theft/VIN etching, and automatic-seatbelt details. Notes/full occupation text preserve these source answers; reverse fill still requires an equivalent structured representation.

Medical occupation gaps: Assistant - Medic/Dent/Vet; Clerk; Client Care Worker; Hospice Volunteer; Mortician; Nurse Practitioner; Optometrist; Paramedic/E.M. Technician; Receptionist/Secretary; Support Services; Technician; Therapist. Other industry-dependent occupation branches, conditional incident forms and carriers/states absent from the sample have not been exhaustively exercised. The current sample has no accidents, violations or comprehensive losses; none were invented during this audit. Operational rating templates/carrier selection and final quote submission were not changed.
