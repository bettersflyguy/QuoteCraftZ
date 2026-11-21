# Home property notes: live schema audit — 2026-11-21

Fresh read-only Dataverse metadata was compared with the installed extension's exported EZLynx mappings. No customizations, client records or saved mappings were changed.

## Result

- Of 24 reviewed Home Property fields, **19 columns exist only in dev**, **one exists in both environments**, and **four planned Choice columns are absent in both**.
- The active extension is using `https://bettersinsurance.crm.dynamics.com`, labelled Prod in its settings. Dev-only columns cannot be mapped or written there until the existing schema is delivered.
- The current export contains **240 EZLynx page rules**, **90 of which still target Property notes**. These 90 include coverages, endorsements, renovations, interests and carrier questions; they do not represent 90 missing Property columns.

## Evidence

| Environment | UTC retrieval | Tables | Attributes |
|---|---|---:|---:|
| `https://agentcrmdev.crm.dynamics.com` | 2026-11-21T22:25:50.6869365Z | 2,184 | 92,434 |
| `https://bettersinsurance.crm.dynamics.com` | 2026-11-21T22:27:18.2354489Z | 2,146 | 90,222 |

Current mapping export UTC: `2026-11-21T22:26:05.163Z`. Export SHA-256: `c654c12f7a70d1588540eb9742d2901ba1aa0f47e713d7ea6fd74821f6c98655`.

All table and attribute names, display labels and descriptions were retrieved across publisher prefixes. Candidate equivalents and the relevant Property, Renovation and Quote Coverage choices were examined. The snapshot files contain metadata only and remain local temporary audit artifacts.

## Property column disposition

All columns below belong to `iacrm_property`. Present columns have both IsValidForCreate and IsValidForUpdate enabled. CREATE means absent, not an instruction to duplicate any existing dev column.

| ID | Source field currently in notes | Exact existing or planned column | Type | Dev | Active CRM | Required action |
|---|---|---|---|---|---|---|
| F001 | Dwelling Type | `iacrm_dwellingtype` | Choice (planned; absent) | No | No | CREATE after defining source choices |
| F002 | Number of Occupants | `iacrm_householdresidents` | Integer | Yes | Yes | REMAP existing column |
| F003 | Roof Design | `iacrm_roofdesign` | Choice (planned; absent) | No | No | CREATE after defining source choices |
| F004 | Number Of Full Baths | `iacrm_fullbathroomcount` | Integer | Yes | No | DEPLOY existing dev column, then remap |
| F005 | Number Of Half Baths | `iacrm_halfbathroomcount` | Integer | Yes | No | DEPLOY existing dev column, then remap |
| F006 | # of Wood Burning Stoves | `iacrm_woodburningstovecount` | Integer | Yes | No | DEPLOY existing dev column, then remap |
| F007 | Fire Detection | `iacrm_firedetectiontype` | Choice (planned; absent) | No | No | CREATE after defining source choices |
| F008 | Dwelling Address: Unit | `iacrm_addressunit` | String | Yes | No | DEPLOY existing dev column, then remap |
| F009 | Dwelling Address: Postal Code Suffix | `iacrm_zip4suffix` | String | Yes | No | DEPLOY existing dev column, then remap |
| F010 | Within Fire District | `iacrm_withinfiredistrict` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F011 | Number of Units in Fire Division | `iacrm_firedivisionunitcount` | Integer | Yes | No | DEPLOY existing dev column, then remap |
| F012 | Multipolicy Discount | `iacrm_multipolicydiscount` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F013 | Retirees Credit | `iacrm_retireecredit` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F014 | Mature Discount | `iacrm_maturehomeownerdiscount` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F015 | Retirement Community | `iacrm_retirementcommunity` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F016 | Limited Access Community | `iacrm_limitedaccesscommunity` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F017 | Gated Community | `iacrm_gatedcommunity` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F018 | Property insurance cancelled, declined or non-renewed in the last 5 years | `iacrm_adverseinsurancehistory5years` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F019 | Is the home under construction? | `iacrm_underconstruction` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F020 | Trampoline | `iacrm_trampoline` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F021 | Business or daycare on the premises | `iacrm_businessordaycareonpremises` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F022 | # of Employees | `iacrm_employeesonpremises` | Integer | Yes | No | DEPLOY existing dev column, then remap |
| F023 | Are dogs on the premises? | `iacrm_dogsonpremises` | Picklist | Yes | No | DEPLOY existing dev column, then remap |
| F024 | Foremost: Number of Animals on Premises? | `iacrm_animalsonpremises` | Choice (planned; absent) | No | No | CREATE after defining source choices |

## Equivalent names and choices

- **Number of Occupants** maps to existing `iacrm_householdresidents` (Household residents, Integer) in both environments. Do not create an occupant-count duplicate.
- **Dwelling Type** is not the existing `iacrm_residencetype`: its choices are Dwelling, Apartment, Condominium, Townhouse, Rowhouse, Co-op, Mobile Home and Other, rather than the source's one-family/duplex classifications. Construction type contains Frame/Masonry/Masonry Veneer/Other and is also not equivalent.
- **Fire Detection** and **Smoke Detector** are distinct controls. `iacrm_smokedetector` has None/Local/Central/Direct choices but is already mapped to Smoke Detector. Reusing it would overwrite that answer.
- **Roof Design** is distinct from roof material and roof condition; no writable equivalent was found under another name.
- **Wood-burning stove count** is distinct from existing `iacrm_woodstoveinserts`; the dev `iacrm_woodburningstovecount` is the correct delivered column.
- Dev yes/no additions such as Retirees credit are **Picklist**, not Boolean: Yes = 298400000, No = 298400001, Unknown / not asked = 298400002. The mapping must translate source answers and must not turn an unknown answer into No.

## Other Home fields currently in Property notes

| Source group | Correct representation | Current live schema finding |
|---|---|---|
| Heating, electrical, plumbing and roofing updates and their years | `iacrm_propertyrenovation`: Property lookup + system + extent + year, one row per system | Core columns exist in both. Dev adds extent Not Updated (298400002) and system Cooling (298400005); active CRM lacks these options. Electrical uses the Wiring system value, 298400000. Do not create duplicate Property year columns. |
| Dwelling, personal property, other structures, loss of use, liability, medical payments, deductibles and endorsement limits | `iacrm_quotecoverage` rows linked to the quote, with code, numeric value, original text, and unit/context | Core coverage code/limit value/limit text/quote lookup columns exist in both. `iacrm_limitunit`, `iacrm_quoteitemid`, `iacrm_election`, `iacrm_breakageelection`, `iacrm_optiontext` and `iacrm_deductiblepercentage` exist in dev and are absent in active CRM. The notes fallbacks must be replaced by a coverage-row writer with correct quote/property context, not arbitrary new Property columns. |
| Mortgagees and other interests | Existing `iacrm_propertyparty`, linked to Property, with role and loan/reference fields | Table and core columns exist in both. Expose the child-row mapping rather than treating each interest as a Property scalar. |
| Carrier-specific product, underwriting and eligibility answers | Question/answer records retaining carrier, quote and line provenance | Existing risk-answer model is available; the dev `iacrm_riskanswer.iacrm_quoteid` lookup is absent in active CRM. These answers are not automatically new Property columns. |

## Complete current Property-notes rule inventory

These are the exact 90 rules exported from the installed extension. A selector rule may address a calculated display value; selector identity alone is not sufficient to assign a new scalar column.

| Current source rule | Current fallback |
|---|---|
| `checkbox:businessOrDaycareOnPremises` | `note:property1` |
| `checkbox:coinsBreakage` | `note:property1` |
| `checkbox:cosigner` | `note:property1` |
| `checkbox:dogInfo` | `note:property1` |
| `checkbox:equityLineOfCredit` | `note:property1` |
| `checkbox:excludeMasonryVeneer` | `note:property1` |
| `checkbox:fineArtsBreakage` | `note:property1` |
| `checkbox:firstMortgagee` | `note:property1` |
| `checkbox:fursBreakage` | `note:property1` |
| `checkbox:gatedCommunity` | `note:properties[]` |
| `checkbox:gunsBreakage` | `note:property1` |
| `checkbox:homeUnderConstruction` | `note:property1` |
| `checkbox:identityTheft` | `note:property1` |
| `checkbox:incidentalBusiness` | `note:property1` |
| `checkbox:increaseLiability` | `note:property1` |
| `checkbox:jewelryBreakage` | `note:property1` |
| `checkbox:limitedAccessCommunity` | `note:properties[]` |
| `checkbox:matureDiscount` | `note:properties[]` |
| `checkbox:multiPolicyDiscount` | `note:properties[]` |
| `checkbox:musicBreakage` | `note:property1` |
| `checkbox:personalInjury` | `note:property1` |
| `checkbox:propertyInsurance` | `note:property1` |
| `checkbox:replacementCostContent` | `note:property1` |
| `checkbox:retireesCredit` | `note:properties[]` |
| `checkbox:secondMortgagee` | `note:property1` |
| `checkbox:silverwareBreakage` | `note:property1` |
| `checkbox:sinkHoleCollapse` | `note:property1` |
| `checkbox:specialPersonalProperty` | `note:property1` |
| `checkbox:thirdMortgagee` | `note:property1` |
| `checkbox:trampoline` | `note:property1` |
| `checkbox:withinFireDistrict` | `note:properties[]` |
| `field:dwelling info&#124;dwelling address>postal code suffix` | `note:properties[]` |
| `field:dwelling info&#124;dwelling address>unit` | `note:properties[]` |
| `field:endorsements&#124;business class` | `note:properties[]` |
| `field:endorsements&#124;deductible` | `note:properties[]` |
| `field:endorsements&#124;earthquake zone` | `note:properties[]` |
| `field:endorsements&#124;equipment breakdown` | `note:properties[]` |
| `field:endorsements&#124;increased coverage on credit card` | `note:properties[]` |
| `field:endorsements&#124;increased limit on jewelry watches and furs` | `note:properties[]` |
| `field:endorsements&#124;increased mold property damage` | `note:properties[]` |
| `field:endorsements&#124;increased replacement cost dwelling percentage` | `note:properties[]` |
| `field:endorsements&#124;loss assessment` | `note:properties[]` |
| `field:endorsements&#124;ordinance or law` | `note:properties[]` |
| `field:endorsements&#124;package option` | `note:properties[]` |
| `field:endorsements&#124;service line coverage` | `note:properties[]` |
| `field:endorsements&#124;water backup` | `note:properties[]` |
| `field:home coverage&#124;all perils deductible` | `note:properties[]` |
| `field:home coverage&#124;build property loss settlement` | `note:properties[]` |
| `field:home coverage&#124;loss of use` | `note:properties[]` |
| `field:home coverage&#124;medical payments` | `note:properties[]` |
| `field:home coverage&#124;other structures` | `note:properties[]` |
| `field:home coverage&#124;personal liability` | `note:properties[]` |
| `field:home coverage&#124;personal property` | `note:properties[]` |
| `field:home coverage&#124;theft deductible` | `note:properties[]` |
| `field:home coverage&#124;wind deductible` | `note:properties[]` |
| `field:home dwelling info&#124;dwelling type` | `note:properties[]` |
| `field:home dwelling info&#124;electrical update` | `note:properties[]` |
| `field:home dwelling info&#124;fire detection` | `note:properties[]` |
| `field:home dwelling info&#124;heating update` | `note:properties[]` |
| `field:home dwelling info&#124;number of full baths` | `note:properties[]` |
| `field:home dwelling info&#124;number of half baths` | `note:properties[]` |
| `field:home dwelling info&#124;number of occupants` | `note:properties[]` |
| `field:home dwelling info&#124;number of units in fire division` | `note:properties[]` |
| `field:home dwelling info&#124;of wood burning stoves` | `note:properties[]` |
| `field:home dwelling info&#124;plumbing update` | `note:properties[]` |
| `field:home dwelling info&#124;retirement community` | `note:properties[]` |
| `field:home dwelling info&#124;roof design` | `note:properties[]` |
| `field:home dwelling info&#124;roofing update` | `note:properties[]` |
| `field:home policy info&#124;number of animals on premises` | `note:properties[]` |
| `field:home policy info&#124;product type` | `note:properties[]` |
| `number:numberOfEmployees` | `note:property1` |
| `number:numberOfOtherInterests` | `note:property1` |
| `number:percentVeneer` | `note:property1` |
| `number:yearUpdatedElectrical` | `note:property1` |
| `number:yearUpdatedHeating` | `note:property1` |
| `number:yearUpdatedPlumbing` | `note:property1` |
| `pick:#step-content-coverage > div:nth-of-type(1) > home-coverage:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > home-general-coverages-fields:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(2) > ez-read-only-field-wrapper:nth-of-type(1) > ez-read-only-field:nth-of-type(1) > span:nth-of-type(2)` | `note:property1` |
| `pick:#step-content-coverage > div:nth-of-type(1) > home-coverage:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > home-general-coverages-fields:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(5) > div:nth-of-type(2) > ez-read-only-field-wrapper:nth-of-type(1) > ez-read-only-field:nth-of-type(1) > span:nth-of-type(2)` | `note:property1` |
| `text:buildingAdditionsOrAlterationsAmount` | `note:property1` |
| `text:businessPursuitsName` | `note:property1` |
| `text:coinsAmount` | `note:property1` |
| `text:dwelling` | `note:property1` |
| `text:fineArtsAmount` | `note:property1` |
| `text:fursAmount` | `note:property1` |
| `text:gunsAmount` | `note:property1` |
| `text:jewelryAmount` | `note:property1` |
| `text:musicAmount` | `note:property1` |
| `text:personal-property-amount` | `note:property1` |
| `text:questionInput` | `note:property1` |
| `text:silverwareAmount` | `note:property1` |

The earlier complete field handoff remains [crm-handoff-field-gaps.md](../crm-handoff-field-gaps.md). This fresh audit confirms that its dev-only delivery and four deferred Home choices still matter in the active environment; a successful dev deployment did not deliver those columns to the active CRM.
