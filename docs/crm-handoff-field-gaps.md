# EZLynx to CRM: complete fields, representations and current fallbacks

**Owner:** Nathan Betters
**As of:** 2026-11-19, QuoteCraftZ 0.1.80
**Purpose:** one self-contained implementation handoff for creating/reusing CRM fields and relationships, then replacing temporary extension mappings. Use this document instead of assembling the earlier separate handoffs.

The inventory reconciles **all 136 page-note rules and all 22 Data Service note rules**. The shared Months rule represents two fields, so the catalog below has **159 source-field entries**. A matrix rule represents every driver/vehicle cell. This is not a request to create 159 new columns: some entries need new attributes, others need existing child tables and mappings exposed.

Check current dev metadata and managed dependencies before creating columns. A missing mapping-catalog entry does not prove a CRM column is absent. Proposed logical/schema names below are suggestions, not a deployed contract. Reuse existing equivalents and confirm actual lookup navigation names and choice values.

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

## Complete implementation catalog

### Home Property

The 24 Property proposals include physical facts and Home eligibility answers. Preserve quote provenance for credits/underwriting answers; use an existing property-context Risk Answer representation where that is the CRM canonical model.

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F001 | Dwelling Type | Property (`iacrm_property`) | Dwelling type: Choice, e.g. one family / duplex; distinct from construction style. Suggested `iacrm_dwellingtype`. | `note:properties[]` | Create/reuse column |
| F002 | Number of Occupants | Property (`iacrm_property`) | Occupant count: Whole number. Suggested `iacrm_occupantcount`. | `note:properties[]` | Create/reuse column |
| F003 | Roof Design | Property (`iacrm_property`) | Roof design: Choice, e.g. hip / gable; distinct from roof material. Suggested `iacrm_roofdesign`. | `note:properties[]` | Create/reuse column |
| F004 | Number Of Full Baths | Property (`iacrm_property`) | Full bathroom count: Whole number. Suggested `iacrm_fullbathroomcount`. | `note:properties[]` | Create/reuse column |
| F005 | Number Of Half Baths | Property (`iacrm_property`) | Half bathroom count: Whole number. Suggested `iacrm_halfbathroomcount`. | `note:properties[]` | Create/reuse column |
| F006 | # of Wood Burning Stoves | Property (`iacrm_property`) | Wood burning stove count: Whole number; do not substitute wood stove inserts. Suggested `iacrm_woodburningstovecount`. | `note:properties[]` | Create/reuse column |
| F007 | Fire Detection | Property (`iacrm_property`) | Fire detection type: Choice for the source's local / central / direct monitoring values; distinct from smoke detector. Suggested `iacrm_firedetectiontype`. | `note:properties[]` | Create/reuse column |
| F008 | Dwelling Address: Unit | Property (`iacrm_property`) | Address unit: Text; keep separate from address line 2. Suggested `iacrm_addressunit`. | `note:properties[]` | Create/reuse column |
| F009 | Dwelling Address: Postal Code Suffix | Property (`iacrm_property`) | ZIP+4 suffix: Text, four digits, preserving leading zeroes. Suggested `iacrm_zip4suffix`. | `note:properties[]` | Create/reuse column |
| F010 | Within Fire District | Property (`iacrm_property`) | Within fire district: Yes / No; distinct from fire district name/code. Suggested `iacrm_withinfiredistrict`. | `note:properties[]` | Create/reuse column |
| F011 | Number of Units in Fire Division | Property (`iacrm_property`) | Fire division unit count: Whole number; distinct from dwelling unit count. Suggested `iacrm_firedivisionunitcount`. | `note:properties[]` | Create/reuse column |
| F012 | Multipolicy Discount | Property (`iacrm_property`) | Multipolicy discount: Yes / No. Suggested `iacrm_multipolicydiscount`. | `note:properties[]` | Create/reuse column |
| F013 | Retirees Credit | Property (`iacrm_property`) | Retiree credit: Yes / No. Suggested `iacrm_retireecredit`. | `note:properties[]` | Create/reuse column |
| F014 | Mature Discount | Property (`iacrm_property`) | Mature homeowner discount: Yes / No; distinct from driver mature-course completion. Suggested `iacrm_maturehomeownerdiscount`. | `note:properties[]` | Create/reuse column |
| F015 | Retirement Community | Property (`iacrm_property`) | Retirement community: Yes / No. Suggested `iacrm_retirementcommunity`. | `note:properties[]` | Create/reuse column |
| F016 | Limited Access Community | Property (`iacrm_property`) | Limited access community: Yes / No. Suggested `iacrm_limitedaccesscommunity`. | `note:properties[]` | Create/reuse column |
| F017 | Gated Community | Property (`iacrm_property`) | Gated community: Yes / No. Suggested `iacrm_gatedcommunity`. | `note:properties[]` | Create/reuse column |
| F018 | Property insurance cancelled, declined or non-renewed in the last 5 years | Property (`iacrm_property`) | Adverse property insurance history: Yes / No; retain the source question's time window. Suggested `iacrm_adverseinsurancehistory5years`. | `note:property1` | Create/reuse column |
| F019 | Is the home under construction? | Property (`iacrm_property`) | Under construction: Yes / No. Suggested `iacrm_underconstruction`. | `note:property1` | Create/reuse column |
| F020 | Trampoline | Property (`iacrm_property`) | Trampoline on premises: Yes / No. Suggested `iacrm_trampoline`. | `note:property1` | Create/reuse column |
| F021 | Business or daycare on the premises | Property (`iacrm_property`) | Business/daycare on premises: Yes / No; do not infer business type. Suggested `iacrm_businessordaycareonpremises`. | `note:property1` | Create/reuse column |
| F022 | # of Employees | Property (`iacrm_property`) | Total employees on premises: Whole number; full-time and part-time counts are different fields. Suggested `iacrm_employeesonpremises`. | `note:property1` | Create/reuse column |
| F023 | Are dogs on the premises? | Property (`iacrm_property`) | Dogs on premises: Yes / No. Suggested `iacrm_dogsonpremises`. | `note:property1` | Create/reuse column |
| F024 | Foremost: Number of Animals on Premises? | Property (`iacrm_property`) | Animals on premises: Count/range choice; preserve None and carrier wording. Suggested `iacrm_animalsonpremises`. | `note:properties[]` | Create/reuse column |

### Home systems

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F025 | Heating Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Heating; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | Expose child-row mapping; add update extent only if absent |
| F026 | Heating: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Heating renovation row; preserve displayed disabled values. | `note:property1` | Reuse existing year; expose child mapping |
| F027 | Electrical Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Electrical; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | Expose child-row mapping; add update extent only if absent |
| F028 | Electrical: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Electrical renovation row; preserve displayed disabled values. | `note:property1` | Reuse existing year; expose child mapping |
| F029 | Plumbing Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Plumbing; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | Expose child-row mapping; add update extent only if absent |
| F030 | Plumbing: Year Updated | Property Renovation (`iacrm_propertyrenovation`) | Nullable whole year on the same Plumbing renovation row; preserve displayed disabled values. | `note:property1` | Reuse existing year; expose child mapping |
| F031 | Roofing Update | Property Renovation (`iacrm_propertyrenovation`) | System/type = Roofing; update extent choice = Not Updated / Partial Update / Complete Update; Property lookup. Pair with its own year on ONE renovation row. | `note:properties[]` | Expose child-row mapping; add update extent only if absent |
| F032 | Nationwide: year updated for cooling type | Property Renovation (`iacrm_propertyrenovation`) | System = Cooling; nullable whole year, Property lookup and carrier/question identity. | `note:property1` | Expose child mapping; replace broad questionInput key with question-specific binding |

### Shared policy and application

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F033 | Months with Prior Carrier | Prior Coverage (`iacrm_priorcoverage`) | Whole number 0-11, separate from years; proposed iacrm_monthswithpriorcarrier. The current shared Months rule also captures Months with Continuous Coverage. | `note:opportunity` | Create/reuse two columns; split by neighboring caption |
| F034 | Months with Continuous Coverage | Prior Coverage (`iacrm_priorcoverage`) | Whole number 0-11, separate from years; proposed iacrm_monthscontinuouscoverage. Independent from Months with Prior Carrier. | `note:opportunity` | Create/reuse two columns; split by neighboring caption |
| F035 | Credit Check and Other Underwriting Reports Authorized | Insurance Application (`iacrm_application`) | Yes/No authorization answer; consent source/date-time where the model supports them; do not infer consent. | `note:opportunity` | Create/reuse authorization field |
| F036 | Quote as Package | Quote (`iacrm_quote`) / existing package relationship | Yes/No election and package linkage when applicable. | `note:opportunity` | Reuse package model; expose mapping |
| F037 | Paperless (Home and Auto) | Risk Answer (`iacrm_riskanswer`), Quote context | Yes/No election with carrier/question and line identity; not contact communication consent. | `note:opportunity` | Expose carrier-answer mapping |
| F038 | Home: Policy/Form Type | Quote (`iacrm_quote`) | Policy-form choice/code such as HO-3; proposed iacrm_policyformtype if absent. | `note:opportunity` | Create/reuse field |
| F039 | Foremost Home: Product type | Risk Answer (`iacrm_riskanswer`), Quote context | Carrier product code/choice such as Standard; distinct from Dwelling Type. | `note:properties[]` | Expose carrier-answer mapping |
| F040 | Stillwater Auto: Multi-Policy Discount? (60-day eligibility question) | Risk Answer (`iacrm_riskanswer`), Quote context | Carrier/question plus category answer such as Home (Largest Discount); not a Boolean. | `note:opportunity` | Expose carrier-answer mapping |
| F041 | Travelers Auto: Is this quote part of a book transfer? | Risk Answer (`iacrm_riskanswer`), Quote context | Yes/No with carrier/question identity. | `note:opportunity` | Expose carrier-answer mapping |

### Home coverage

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F042 | Dwelling | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency coverage limit; retain stable coverage code and original limit text. | `note:property1` | Expose typed coverage mapping; reuse existing attributes |
| F043 | Other Structures percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percent, paired with its calculated Amount on the SAME coverage row; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F044 | Personal Property basis | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Basis/option choice such as Custom, paired with Personal Property Amount; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F045 | Personal Property Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit on the Personal Property coverage row; retain stable coverage code and original limit text. | `note:property1` | Expose typed coverage mapping; reuse existing attributes |
| F046 | Loss Of Use percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percent, paired with its calculated Amount on the SAME coverage row; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F047 | Personal Liability | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency/split-limit representation as supplied; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F048 | Home: Medical Payments | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit in Home/Property context; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F049 | All Perils Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Deductible type, nullable numeric value, text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F050 | Theft Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Theft deductible value, original text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F051 | Wind Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Wind deductible value, original text and currency/percent unit; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F052 | Foremost: Build Property Loss Settlement | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Loss-settlement basis choice/text with carrier/question identity; retain stable coverage code and original limit text. | `note:properties[]` | Expose typed coverage mapping; reuse existing attributes |
| F053 | Other Structures: calculated Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency amount on the same Other Structures coverage row as its percentage; derived-value provenance; not another Property record; retain stable coverage code and original limit text. | `note:property1` | Expose typed coverage mapping; reuse existing attributes |
| F054 | Loss Of Use: calculated Amount | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency amount on the same Loss Of Use coverage row as its percentage; derived-value provenance; not another Property record; retain stable coverage code and original limit text. | `note:property1` | Expose typed coverage mapping; reuse existing attributes |

### Home endorsements

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F055 | Building Additions or Alterations | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:property1` | Expose endorsement/coverage mapping |
| F056 | Increased Replacement Cost Dwelling Percentage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Decimal percentage and percent unit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F057 | Loss Assessment | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F058 | Ordinance or Law | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Limit plus the actual percentage/currency unit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F059 | Increased Coverage on Credit Card | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency insurance-coverage limit; no payment-card data with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F060 | Increased Limit on Jewelry, Watches and Furs | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F061 | Water Backup | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F062 | Increased Mold Property Damage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Currency limit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F063 | Earthquake Deductible | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Earthquake deductible value, text and currency/percent unit with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F064 | Equipment Breakdown | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Coverage election/option; preserve source choice with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F065 | Service Line Coverage | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Coverage election/option; preserve source choice with endorsement/coverage code. | `note:properties[]` | Expose endorsement/coverage mapping |
| F066 | Identity Theft | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F067 | Replacement Cost Content | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F068 | Increase Liability | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F069 | Personal Injury | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F070 | Special Personal Property | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F071 | Sinkhole Collapse | Quote Coverage (`iacrm_quotecoverage`), linked to Quote and Property | Nullable Yes/No endorsement election plus endorsement code; preserve unknown versus No. | `note:property1` | Expose endorsement/coverage mapping |
| F072 | Earthquake Zone | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Zone choice/code; retain carrier/question identity. | `note:properties[]` | Expose property/carrier-answer mapping |
| F073 | Percent Veneer | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Decimal percentage 0-100; retain carrier/question identity. | `note:property1` | Expose property/carrier-answer mapping |
| F074 | Exclude Masonry Veneer | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Yes/No exclusion election; retain carrier/question identity. | `note:property1` | Expose property/carrier-answer mapping |
| F075 | Business Name | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Text for the property business; separate from insured account legal name; retain carrier/question identity. | `note:property1` | Expose property/carrier-answer mapping |
| F076 | Business Class | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Business class choice/code/text; retain carrier/question identity. | `note:properties[]` | Expose property/carrier-answer mapping |
| F077 | Incidental Business | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Yes/No election; retain carrier/question identity. | `note:property1` | Expose property/carrier-answer mapping |
| F078 | Safeco: Package Option | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Carrier package option choice/code; retain carrier/question identity. | `note:properties[]` | Expose property/carrier-answer mapping |

### Home scheduled property

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F079 | Coins: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Coins category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F080 | Coins: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Coins category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F081 | Fine Arts: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Fine Arts category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F082 | Fine Arts: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Fine Arts category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F083 | Furs: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Furs category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F084 | Furs: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Furs category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F085 | Guns: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Guns category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F086 | Guns: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Guns category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F087 | Jewelry: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Jewelry category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F088 | Jewelry: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Jewelry category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F089 | Music: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Music category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F090 | Music: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Music category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F091 | Silverware: Amount | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Currency insured amount on the Silverware category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |
| F092 | Silverware: Breakage | Scheduled Item (`iacrm_scheduleditem`), Property + Quote context | Yes/No breakage election on the Silverware category row; pair amount and breakage on that SAME row. Source has category totals, not item serial numbers. | `note:property1` | Expose category-level scheduled-item mapping |

### Home financial interests

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F093 | First mortgagee | Additional Interest (`iacrm_additionalinterest`), Property insured item | Presence flag; type = Mortgagee; ordinal = 1. Parent via iacrm_insureditemid. Presence does not identify a lender; retain as Risk Answer if an actual party is required. | `note:property1` | Reuse interest relationship; do not fabricate lender records |
| F094 | Second mortgagee | Additional Interest (`iacrm_additionalinterest`), Property insured item | Presence flag; type = Mortgagee; ordinal = 2. Parent via iacrm_insureditemid. Presence does not identify a lender; retain as Risk Answer if an actual party is required. | `note:property1` | Reuse interest relationship; do not fabricate lender records |
| F095 | Third mortgagee | Additional Interest (`iacrm_additionalinterest`), Property insured item | Presence flag; type = Mortgagee; ordinal = 3. Parent via iacrm_insureditemid. Presence does not identify a lender; retain as Risk Answer if an actual party is required. | `note:property1` | Reuse interest relationship; do not fabricate lender records |
| F096 | Cosigner | Additional Interest (`iacrm_additionalinterest`), Property insured item | Presence flag; type = Cosigner; ordinal = not supplied. Parent via iacrm_insureditemid. Presence does not identify a lender; retain as Risk Answer if an actual party is required. | `note:property1` | Reuse interest relationship; do not fabricate lender records |
| F097 | Equity line of credit | Additional Interest (`iacrm_additionalinterest`), Property insured item | Presence flag; type = Equity lender; ordinal = not supplied. Parent via iacrm_insureditemid. Presence does not identify a lender; retain as Risk Answer if an actual party is required. | `note:property1` | Reuse interest relationship; do not fabricate lender records |
| F098 | # of Other Interests | Risk Answer (`iacrm_riskanswer`), Quote + Property context | Nonnegative whole-number count; do not create unidentified party records from this count. | `note:property1` | Expose count answer mapping |

### Contacts and drivers

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F099 | Preferred Language | Contact (`contact`) | Choice/text; proposed iacrm_preferredlanguage only if no equivalent exists. | `note:contacts[]` | Create/reuse column |
| F100 | Rated Driver | Policy Driver (proposed `iacrm_policydriver`) | Rating Status = Rated / Excluded / Non-Driver, on Contact + policy/quoting context. | `note:contacts[]` | Create/reuse relationship; expose Policy drivers (all rows) |
| F101 | Good Driver | Policy Driver / Risk Answer, Quote/Policy context | Yes/No eligibility answer with source question, carrier and applicable window. | `note:contacts[]` | Expose contextual driver answer |

### Auto coverage

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F102 | Bodily Injury | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Split per-person/per-accident limits; retain text and parsed components; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F103 | Uninsured Motorist | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Coverage/split-limit text and component amounts; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F104 | Underinsured Motorist | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Coverage/split-limit text and component amounts; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F105 | Property Damage | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Currency liability limit; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F106 | Auto: Medical Payments | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Currency limit; Auto context; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F107 | MN: Personal Injury Protection Options | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | State-specific option code/text and benefit components; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F108 | MN: PIP Deductible | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Deductible amount, text and unit; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F109 | MN: Work Loss | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Benefit option retaining Included / Excluded; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F110 | Vehicle: Comprehensive | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle deductible value, text and unit; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F111 | Vehicle: Collision | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle deductible value, text and unit; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F112 | Vehicle: Towing & Labor | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle election/limit; preserve No Coverage; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F113 | Vehicle: Rental Expense | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle daily/total limit or option; preserve No Coverage; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F114 | Vehicle: Stated Amount | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle currency stated value; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F115 | Vehicle: Loan/Lease Coverage | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F116 | Vehicle: Liability Not Required | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election, not a blank limit; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F117 | Vehicle: Full Glass | Quote Coverage (`iacrm_quotecoverage`), Quote + Vehicle when applicable | Per-vehicle Yes/No election; retain coverage code. | `note:opportunity` | Expose typed coverage mapping |
| F118 | MN: PIP Stacking | Quote Coverage (`iacrm_quotecoverage`), Quote context | Yes/No stacking election, MN state and PIP coverage identity. | `note:opportunity` | Expose state coverage mapping |

### Auto application and carrier answers

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F119 | Residence is | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Choice preserving owned/rented/home/other distinctions; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F120 | Auto: Multipolicy Discount | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No application answer; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F121 | Auto: Retirement Community | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No Auto application answer; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F122 | AAA Membership Discount | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No eligibility/election; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F123 | Applicant has a company car insured elsewhere | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No answer; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F124 | Nationwide: Auto currently insured in agency? | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Yes/No answer; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F125 | Nationwide: Special Physical Damage for Vehicle | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Per-vehicle election/answer; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F126 | Vehicle branded title (salvage/dismantled/flood/junk/buyback/rebuilt/reconstructed) | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Per-vehicle Yes/No; retain full question, not an inferred title brand; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F127 | Foremost: Product to be quoted | Risk Answer (`iacrm_riskanswer`), Quote + Vehicle when applicable | Product category/code such as Combo Auto; store carrier/question/context. | `note:opportunity` | Expose contextual carrier-answer mapping |
| F128 | Alternate Garage | Vehicle (`iacrm_vehicle`) + garaging Address relationship | Yes/No flag plus alternate address lookup if supplied; observed source has only a disabled flag. | `note:opportunity` | Create/reuse flag/lookup; expose row mapping |
| F129 | Every Driver / Vehicle use percentage | Vehicle Driver Assignment (proposed relationship) | One row per Contact + Vehicle + Quote/Policy context; decimal percentage 0-100. Keep BOTH matrix axes and all cells. | `note:opportunity` | Create/reuse relationship and expose collection |

### Auto incidents

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F130 | Date of Accident | Driving Incident (proposed `iacrm_drivingincident`) | Date only, preserving source value; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F131 | Accident: Driver | Driving Incident (proposed `iacrm_drivingincident`) | Contact lookup resolved from selected source driver; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F132 | Accident Description | Driving Incident (proposed `iacrm_drivingincident`) | Subtype choice/code and description text; At Fault only when explicitly represented; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F133 | PD Amount | Driving Incident (proposed `iacrm_drivingincident`) | Separate currency Property Damage amount; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F134 | BI Amount | Driving Incident (proposed `iacrm_drivingincident`) | Separate currency Bodily Injury amount; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F135 | Collision Amount | Driving Incident (proposed `iacrm_drivingincident`) | Separate currency Collision amount; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F136 | MP Amount | Driving Incident (proposed `iacrm_drivingincident`) | Separate currency Medical Payments amount; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |
| F137 | Vehicle Involved | Driving Incident (proposed `iacrm_drivingincident`) | Vehicle lookup resolved from selected source vehicle; same incident row as its other fields. | `note:opportunity` | Create/reuse model; expose Driving incidents (all rows) |

### Intake account, contact and address

| ID | Source field | Target entity | Required representation / suggested field | Current fallback | Required work |
|---|---|---|---|---|---|
| F138 | Customer since | Account (`account`) | Date only; proposed iacrm_customersince if absent. Not CRM createdon. | `note` | Create/reuse field or expose relationship |
| F139 | Assigned producer | Account (`account`) | Dedicated producer lookup to existing user/producer model; proposed iacrm_assignedproducerid if absent. Resolve source names unambiguously; not automatically record owner. | `note` | Create/reuse field or expose relationship |
| F140 | CSR | Account (`account`) | Dedicated CSR user/team lookup; proposed iacrm_csrid if absent. Resolve names without creating users. | `note` | Create/reuse field or expose relationship |
| F141 | VIP | Account (`account`) | Yes/No VIP flag; proposed iacrm_isvip if absent. | `note` | Create/reuse field or expose relationship |
| F142 | Primary address: ZIP suffix | Account (`account`), primary address | Four-character text, leading zeroes retained; proposed iacrm_address1zip4. | `note` | Create/reuse field or expose relationship |
| F143 | Primary address: Years at address | Account (`account`), primary address | Nonnegative whole years; proposed iacrm_yearsatprimaryaddress; preserve address association. | `note` | Create/reuse field or expose relationship |
| F144 | Primary address: Months at address | Account (`account`), primary address | Whole months 0-11, separate from years; proposed iacrm_monthsatprimaryaddress. | `note` | Create/reuse field or expose relationship |
| F145 | Maiden name | Contact (`contact`) | Text; proposed iacrm_maidenname if no equivalent exists. | `note:contacts[]` | Create/reuse field or expose relationship |
| F146 | Co-applicant | Application/Quote participant relationship (verify existing entity) | Contact + application/quote context + role = Co-applicant; not a universal Contact status. | `note:contacts[]` | Create/reuse field or expose relationship |
| F147 | Driver flag | Policy Driver (proposed `iacrm_policydriver`) | Contact + policy/quoting-context membership; separate from Rated/Excluded status. | `note:contacts[]` | Create/reuse field or expose relationship |
| F148 | Deceased | Contact (`contact`) | Yes/No with unknown distinct from No; proposed iacrm_isdeceased if absent. | `note:contacts[]` | Create/reuse field or expose relationship |
| F149 | Every address: Person | Existing contact-address representation / `customeraddress` relationship | Resolve owner Contact and address sequence; a display name is provenance, not an address attribute. | `note` | Create/reuse field or expose relationship |
| F150 | Every address: ZIP suffix | Address (`customeraddress` or current contact-address representation) | Four-character ZIP+4 on EACH address; proposed iacrm_zip4suffix; preserve owner/sequence. | `note` | Create/reuse field or expose relationship |
| F151 | Every address: Years at address | Address (`customeraddress` or current contact-address representation) | Nonnegative whole years per address; proposed iacrm_yearsataddress if absent. | `note` | Create/reuse field or expose relationship |
| F152 | Every address: Months at address | Address (`customeraddress` or current contact-address representation) | Whole months 0-11 per address; proposed iacrm_monthsataddress if absent. | `note` | Create/reuse field or expose relationship |
| F153 | Additional phone: Person | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Owning Contact lookup. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F154 | Additional phone: Phone type | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Usage-type choice/text, e.g. Home/Work/Mobile. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F155 | Additional phone: Number | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Phone/text preserving source value. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F156 | Additional phone: Extension | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Text preserving leading zeroes. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F157 | Additional email: Person | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Owning Contact lookup. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F158 | Additional email: Email type | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Usage-type choice/text. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |
| F159 | Additional email: Email address | Contact Point (reuse existing; proposed `iacrm_contactpoint` if needed) | Email/text value. One row per contact method, with Phone/Email channel and sequence; pair all attributes on that row. | `note` | Expose repeated contact-method mapping |

## Required child-record and relationship representations

These shared representations support the field catalog above. Verify actual attributes and managed dependencies before creating equivalents. Context/identity lookups below are populated from existing intake/loaded records; they are not additional source answers to infer from a note.

### Quote Coverage (`iacrm_quotecoverage`)

Existing extension code already uses `iacrm_quotecoverage_name`, `iacrm_coveragecode` (text 50), `iacrm_limittext` (verbatim text 100), `iacrm_limitvalue` (nullable numeric amount), `iacrm_displayorder` and a discovered Quote relationship navigation property. Reuse these.

| Needed attribute | Representation and implementation |
|---|---|
| Quote | Existing `iacrm_quote` lookup; return its exact `@odata.bind` navigation name. |
| Property / Vehicle | Relevant asset lookup/relationship for asset-specific coverage. Confirm or add the missing relationship; separate vehicles must retain separate coverage rows. |
| Coverage / endorsement identity | Stable code and display label; retain line of business and carrier/state variations. |
| Limit | Verbatim limit text plus nullable numeric value; split per-person/per-accident components when supported. |
| Limit unit | Currency / percentage / count / option, using the existing equivalent or a new choice only if absent. |
| Basis / option | Choice or original text, such as Custom or replacement-cost basis. |
| Deductible | Deductible type/code, original text, nullable numeric amount and currency/percent unit. |
| Election | Nullable Yes/No or source option; unknown/unasked is different from No. |
| Carrier / state / question | Context when it changes the answer's meaning; use the canonical Risk Answer relationship if applicable. |

Other Structures percentage and calculated Amount share **one** coverage row. Loss Of Use percentage and calculated Amount share **one** coverage row. Personal Property basis and Amount share **one** coverage row. The source's separate boxes must not create extra Property records. New-policy limits must not be written to Prior Coverage.

### Risk Answer (`iacrm_riskanswer`)

Reuse the existing table where its relationships support the required context.

| Needed attribute | Representation and implementation |
|---|---|
| Question identity | Stable source question identifier plus full source caption. |
| Context | Applicable Quote/Application and, where relevant, Property, Vehicle, Contact or Policy Driver; retain policy/line identity. |
| Carrier / state | Source carrier and state when the question depends on them. |
| Answer type | Boolean / number / date / choice / text, with unknown represented explicitly. |
| Answer | Original answer text plus the corresponding typed value or choice code. A category such as Home (Largest Discount) must not become a Boolean. |
| Provenance | Source system and captured/as-of context supported by the existing model. |

### Property Renovation (`iacrm_propertyrenovation`)

Existing extension entity set: `iacrm_propertyrenovations`; parent binding: `iacrm_propertyid` to `iacrm_properties`.

| Needed attribute | Representation and implementation |
|---|---|
| Property | Parent lookup to the actual Property record. |
| System/type | Heating / Electrical / Plumbing / Roofing / Cooling; reuse the existing choice/code. |
| Update extent | Not Updated / Partial Update / Complete Update; add only if no equivalent exists. |
| Year | Nullable whole year on that system's row. A disabled source control can still contain a displayed year that must be preserved. |

**Roofing: Year Updated is already typed to Property `iacrm_roofyear`.** It has no note fallback. Reuse that column for the current roof year and associate the year with the Roofing renovation row when the child-history mapping is implemented. Do not treat four identical Year Updated captions as four properties.

### Scheduled Item (`iacrm_scheduleditem`)

Existing extension entity set: `iacrm_scheduleditems`. Needed representation: category, currency insured amount, breakage election and the existing Property/insured-item and Quote relationships. One category row holds the amount and breakage flag for Coins, Fine Arts, Furs, Guns, Jewelry, Music or Silverware. The source supplies category totals, not individual item serial numbers. Confirm a category/context upsert key before loading these rows.

### Additional Interest (`iacrm_additionalinterest`)

Existing extension entity set: `iacrm_additionalinterests`; parent binding: `iacrm_insureditemid` to `iacrm_insureditems`. Resolve the Property's insured item first. Required representation: interest type, ordinal, presence answer and lender/party lookup when an actual party is supplied. If the model requires a known party, keep a checked mortgagee presence answer as a property-context Risk Answer until the party is available. A checkbox must not create a fictitious lender. The Other Interests count must not create unidentified parties.

### Policy Driver (proposed `iacrm_policydriver`)

Recheck current dev for an equivalent relationship before creating it. The earlier read-only dev check was 2026-11-09. Suggested entity set: `iacrm_policydrivers`; confirm the deployed name.

| Proposed attribute / schema name | Representation | Current fallback / source availability |
|---|---|---|
| Name — `iacrm_Name` | Required text 200; generated relationship label | Derived from driver/context; no separate source answer. |
| Driver — `iacrm_ContactId` | Required Contact lookup | Person fields already map to Contacts; current driver membership/rating answers use contact notes. |
| Insured — `iacrm_AccountId` | Required Account lookup | Existing intake Account identity. |
| Opportunity — `iacrm_OpportunityId` | Lookup | Existing quoting context; Auto incident/coverage notes currently land here. |
| Quote — `iacrm_QuoteId` | Lookup | Bind the loaded Quote when available. |
| Policy — `iacrm_PolicyId` | Lookup | Bind when Policy context exists. |
| Line of Business — `iacrm_LineOfBusinessId` | Lookup | Auto context; keep separate from Home. |
| Rating Status — `iacrm_RatingStatus` | Reuse Rated / Excluded / Non-Driver global choice if current metadata confirms it | Rated Driver uses `note:contacts[]`. Historical choice values 298400000 / 298400001 / 298400002 require verification. |
| SR-22 Filed — `iacrm_SR22Filed` | Yes/No, filed on this policy | Not supplied by the observed SR-22 Required source field. Required already maps to Contact `iacrm_sr22`; do not infer Filed. |
| FR-44 Filed — `iacrm_FR44Filed` | Yes/No, filed on this policy | Not supplied by FR-44 Required. Required already maps to Contact `iacrm_fr44`; do not infer Filed. |
| Carrier Driver Number — `iacrm_CarrierDriverNumber` | Text 50 | Not exposed on observed driver cards; no current capture/fallback claim. |
| Effective Date — `iacrm_EffectiveDate` | Date only | Driver membership effective date not exposed on observed cards. |
| End Date — `iacrm_EndDate` | Date only | Driver membership end date not exposed on observed cards. |
| Source — `iacrm_Source` | Text 100 | Source system can be derived as EZLynx; preserve provenance. |

Use one row per Contact + policy/quoting context. An excluded person remains a Contact with an Excluded relationship row. Keep the legacy Contact `iacrm_driverratingstatus` column until migration is reviewed; move its per-policy meaning to the relationship. The historical dev check found zero populated legacy statuses, which does not establish current dev or production migration needs.

### Driving Incident (proposed `iacrm_drivingincident`)

Suggested entity set: `iacrm_drivingincidents`; confirm after deployment. Each incident's driver, vehicle, date, description and amount components belong on the same incident row.

| Proposed attribute / schema name | Representation | Current fallback / source availability |
|---|---|---|
| Name — `iacrm_Name` | Required text 200; generated incident label | Derived; no separate source answer. |
| Driver — `iacrm_ContactId` | Required Contact lookup | Accident Driver in opportunity notes; resolve the selected source identity. |
| Insured — `iacrm_AccountId` | Required Account lookup | Existing intake Account. |
| Vehicle — `iacrm_VehicleId` | Optional Vehicle lookup | Vehicle Involved in opportunity notes. |
| Policy — `iacrm_PolicyId` | Optional Policy lookup | Bind when known. |
| Quote / Opportunity / Application context | Reuse/add the relevant pre-policy lookup | Current fallback context is Opportunity. |
| Incident Type — `iacrm_IncidentType` | Choice: Accident / Violation / Comprehensive Claim / Suspension / Other | Observed populated source was Accident. Historical proposed values 298400000–298400004 require metadata verification. |
| Incident Date — `iacrm_IncidentDate` | Date only | Date of Accident in opportunity notes. |
| Subtype / Description — `iacrm_Description` plus subtype equivalent | Source subtype choice/code and multiline description, suggested 2000 | Accident Description in opportunity notes. |
| At Fault — `iacrm_AtFault` | Nullable Yes/No | Derive only from an explicit source classification; otherwise unknown. |
| PD Amount — proposed `iacrm_propertydamageamount` | Currency | Separate PD Amount in opportunity notes. |
| BI Amount — proposed `iacrm_bodilyinjuryamount` | Currency | Separate BI Amount in opportunity notes. |
| Collision Amount — proposed `iacrm_collisionamount` | Currency | Separate Collision Amount in opportunity notes. |
| MP Amount — proposed `iacrm_medicalpaymentsamount` | Currency | Separate MP Amount in opportunity notes. |
| Amount Paid — `iacrm_AmountPaid` | Currency total if independently supplied | Historical model proposal; not an observed separate total. Do not substitute a component or calculate a total without a defined rule. |
| Points — `iacrm_Points` | Whole number | Not exposed by observed accident; intended for future violation source data. |
| Source — `iacrm_Source` | Text provenance | Source system can be derived. |
| Source incident identifier | Stable source identifier when available | Capture when exposed; do not invent one from display order. |

A driver + date + incident type key can merge two same-day incidents. Prefer a stable source incident ID; otherwise define an explicit matching strategy that retains multiple same-day incidents and survives reordering.

### Vehicle Driver Assignment (proposed relationship)

| Needed attribute | Representation / current fallback |
|---|---|
| Contact | Driver lookup; current opportunity notes retain driver caption. |
| Vehicle | Vehicle lookup; current opportunity notes retain vehicle caption. |
| Quote / Policy context | Relevant lookup identifying the assignment's application/policy. |
| Percentage | Decimal 0–100; current notes retain each matrix cell's percentage. |
| Identity / upsert key | Contact + Vehicle + Quote/Policy context, or equivalent existing key. |

Check total use per vehicle according to the source rules; do not silently normalize percentages. The existing Vehicle `iacrm_primarydriverid` lookup cannot represent the full matrix.

### Additional contact methods and application participants

Reuse existing representations before creating proposed `iacrm_contactpoint` or an application-participant table.

| Model | Needed attributes | Current fallback |
|---|---|---|
| Contact Point | Contact owner lookup; Phone/Email channel; usage type; phone number or email address; extension for phone; source sequence | Additional phone/email rows are in insured Account notes (`note`), with Person/Type labels. |
| Application/Quote participant | Contact lookup; Application/Quote lookup; role, including Co-applicant | Co-applicant flag is in each contact's own notes (`note:contacts[]`). |

## Existing destinations to reuse and mappings requiring semantic review

These entries complete the handoff but are not requests to duplicate existing CRM columns.

| Source field / area | Current typed representation | Required action |
|---|---|---|
| Prior Employer In Years | `crm:contacts[].iacrm_prioryearsemployed` | Already exists; preserve applicant-first row identity. |
| Prefix / Suffix | `contact.salutation` / `contact.suffix` | Reuse. |
| Contact Time | `contact.preferredappointmenttimecode` | Reuse existing choice values. |
| Applicant Postal Code | `account.address1_postalcode` | Reuse; keep separate from the Property postcode. |
| DL Status / DL State | `contact.iacrm_dlstatus` / `contact.iacrm_dlstate` | Reuse. |
| Age Licensed / License Suspended / SR-22 / FR-44 | Contact `iacrm_agefirstlicensed`, `iacrm_licensesuspended`, `iacrm_sr22`, `iacrm_fr44` | Reuse; Required is different from Filed on a Policy Driver. |
| Good Student / Student Away / Driver Education / Mature Driver / Driver Telematics | Contact `iacrm_goodstudent`, `iacrm_studentaway`, `iacrm_drivereducation`, `iacrm_maturedriver`, `iacrm_telematicsagreement` | Already mapped through Contacts (all rows); retain source meaning and choice type. |
| Defensive Driver Course Date | `contact.iacrm_defensivedrivercoursedate` | Reuse; do not infer completion from an empty date. |
| Prior carrier / expiry / premium / years with carrier / years continuous | Prior Coverage `iacrm_priorcarriername`, `iacrm_expirationdate`, `iacrm_premium`, `iacrm_yearswithpriorcarrier`, `iacrm_yearscontinuouscoverage` | Reuse; add only missing month components from the catalog. |
| Prior liability / prior term | Prior Coverage `iacrm_liabilitylimits`, `iacrm_policyterm` | Reuse. Prior term and new Quote term use different choice contracts. |
| New policy term / effective date / description | Quote `iacrm_term`, `iacrm_effectivedate`, `iacrm_description` | Reuse. Current Quote term mapping: 6 Month = 738590203; 12 Month = 738590205; confirm current metadata. |
| Primary-address Unit AND Address line 2 | Data Service maps BOTH `applicant.unit` and `applicant.address2` to `address.street2` | **Mapping/schema fix:** preserve Unit and Line 2 separately using a dedicated unit attribute or the canonical Address model. Define deterministic handling before replacing either mapping. |
| Every-address Unit | `crm:addresses[].line3` | Existing representation; reconcile primary-address handling without losing Unit or Line 2. |
| Est. Replacement Cost | Saved preset: `crm:property1.iacrm_value` | **Semantic review:** verify the live label/type means reconstruction/replacement cost. Earlier prose called this reconstruction cost; the actual saved key is `iacrm_value`. If it means market/other value, use/create a dedicated reconstruction-cost currency field and remap. |
| Occupation | Data Service: `contact.iacrm_employmentoccupation`; page: `contact.iacrm_occupation` | **Mapping review:** select the canonical occupation destination and choice/text representation; reconcile both capture routes. |
| Property physical fields already mapped | Address lines/city/state/county/ZIP; usage; occupancy; area; year built; construction; stories; roof material; foundation; walls; heat/secondary heat; alarms; smoke/sprinklers; locks/extinguisher; purchase data; fire distances; protection class; city limits; roof year; pool; nonsmoker; neighbor visibility; manned security | Preserve existing typed fields; add only identified gaps. |
| Vehicle fields already mapped | VIN/year/make/model/trim; purchase date; cost new; miles/odometer; modifications; damage/delivery; use; restraints/airbags; theft/ABS/daytime lights; performance; commute frequency; new/used; ownership; carpool; telematics; TNC | Preserve Vehicles (all rows). Alternate garage and assignments are the gaps above. |
| SSN / driver's-license number | Local Secured: Contacts (all rows), separate pass-through channel | Preserve field security; never use ordinary text or notes as fallback. Share exports exclude these bindings. |

## Implementation sequence and return contract

1. Inspect current dev attributes, managed dependencies, choices and relationships. Mark each field ID as existing/reuse, new column, new relationship or mapping-only fix.
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
