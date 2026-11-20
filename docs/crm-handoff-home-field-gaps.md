# CRM handoff: EZLynx Home field gaps

Requested by Nathan on 2026-11-19. Owner for the CRM enhancement handoff: Nathan Betters.

The extension now supports `Notes: Properties (all rows)`. It captures each unmatched field's label and value and writes one combined timeline annotation to the matching `iacrm_property` record when that property is loaded. It does not overwrite a property text column or route these values to the insured account. Repeated properties stay in document order; a missing matching property produces a visible load error.

This is a proposed schema backlog based on the EZLynx Home screen and the mapping catalog available during configuration. A missing catalog entry alone does not prove that a Dataverse column is absent. The CRM owner must check current dev metadata and managed dependencies before creating a column. The current local GitHub solution tree does not contain the property table definition, so it cannot settle that check. Do not create duplicate columns.

## Proposed dedicated property fields

All rows below target **Property (`iacrm_property`)**. Until dedicated fields are available, their EZLynx values belong in that property's timeline notes. Proposed logical names are suggestions, not a deployed contract.

| EZLynx field | Proposed CRM field | Suggested logical name | Type / meaning |
|---|---|---|---|
| Dwelling Type | Dwelling type | `iacrm_dwellingtype` | Choice, e.g. one family / duplex; distinct from construction style |
| Number of Occupants | Occupant count | `iacrm_occupantcount` | Whole number |
| Roof Design | Roof design | `iacrm_roofdesign` | Choice, e.g. hip / gable; distinct from roof material |
| Number Of Full Baths | Full bathroom count | `iacrm_fullbathroomcount` | Whole number |
| Number Of Half Baths | Half bathroom count | `iacrm_halfbathroomcount` | Whole number |
| # of Wood Burning Stoves | Wood burning stove count | `iacrm_woodburningstovecount` | Whole number; do not substitute wood stove inserts |
| Fire Detection | Fire detection type | `iacrm_firedetectiontype` | Choice for the source's local / central / direct monitoring values; distinct from smoke detector |
| Dwelling Address: Unit | Address unit | `iacrm_addressunit` | Text; keep separate from address line 2 |
| Dwelling Address: Postal Code Suffix | ZIP+4 suffix | `iacrm_zip4suffix` | Text, four digits, preserving leading zeroes |
| Within Fire District | Within fire district | `iacrm_withinfiredistrict` | Yes / No; distinct from fire district name/code |
| Number of Units in Fire Division | Fire division unit count | `iacrm_firedivisionunitcount` | Whole number; distinct from dwelling unit count |
| Multipolicy Discount | Multipolicy discount | `iacrm_multipolicydiscount` | Yes / No |
| Retirees Credit | Retiree credit | `iacrm_retireecredit` | Yes / No |
| Mature Discount | Mature homeowner discount | `iacrm_maturehomeownerdiscount` | Yes / No; distinct from driver mature-course completion |
| Retirement Community | Retirement community | `iacrm_retirementcommunity` | Yes / No |
| Limited Access Community | Limited access community | `iacrm_limitedaccesscommunity` | Yes / No |
| Gated Community | Gated community | `iacrm_gatedcommunity` | Yes / No |
| Property insurance cancelled, declined or non-renewed in the last 5 years | Adverse property insurance history | `iacrm_adverseinsurancehistory5years` | Yes / No; retain the source question's time window |
| Is the home under construction? | Under construction | `iacrm_underconstruction` | Yes / No |
| Trampoline | Trampoline on premises | `iacrm_trampoline` | Yes / No |
| Business or daycare on the premises | Business/daycare on premises | `iacrm_businessordaycareonpremises` | Yes / No; do not infer business type |
| # of Employees | Total employees on premises | `iacrm_employeesonpremises` | Whole number; full-time and part-time counts are different fields |
| Are dogs on the premises? | Dogs on premises | `iacrm_dogsonpremises` | Yes / No |
| Foremost: Number of Animals on Premises? | Animals on premises | `iacrm_animalsonpremises` | Count/range choice; preserve None and carrier wording |

## Policy and application fields

| EZLynx field | Target entity | Needed representation / current fallback |
|---|---|---|
| Months with Prior Carrier | Prior Coverage (`iacrm_priorcoverage`) | Whole number, 0–11, separate from the existing years field. Opportunity notes preserve the neighboring field name |
| Months with Continuous Coverage | Prior Coverage (`iacrm_priorcoverage`) | Whole number, 0–11, separate from the existing years field. Opportunity notes preserve the neighboring field name |
| Credit Check and Other Underwriting Reports Authorized | Insurance Application (`iacrm_application`) | Yes / No authorization answer, with consent provenance if the application model supports it. Opportunity notes currently preserve the answer |
| Quote as Package | Quote (`iacrm_quote`) / package relationship | Yes / No; validate the existing package model before adding a column. Opportunity notes |
| Foremost Product type | Quote (`iacrm_quote`) or carrier Risk Answer | Carrier/product choice, e.g. Standard; distinct from dwelling type. Property notes retain the source answer |
| Nationwide Paperless | Quote (`iacrm_quote`) or carrier Risk Answer | Yes / No election; distinct from contact communication consent. Opportunity notes |
| Rating: Policy/Form Type | Quote (`iacrm_quote`) | Policy form choice, such as HO-3; distinct from property construction/dwelling type. Opportunity notes until a matching typed destination is exposed |

New Policy Term reuses Quote `iacrm_term`, with the extension's existing 6/12-month choice values. Rating Description reuses Quote `iacrm_description`, confirmed in the mapping catalog and canonical Quote metadata. Prior carrier, expiration date, premium, years with prior carrier and years continuous coverage already have typed Prior Coverage destinations. Swimming pool already has a typed Property destination. None of these need duplicate fields. Select Quote Template and Carrier Answers Prefill are source configuration controls, not CRM risk data.

## Coverage and endorsement destinations

These answers need a typed mapping path into the appropriate child records. They are temporarily retained in **Property notes** under the user's instruction. They should not become dozens of duplicate columns on Property when an existing coverage model can represent them.

| EZLynx fields | Target entity | Required representation |
|---|---|---|
| Dwelling; Other Structures percentage and calculated Amount; Personal Property basis and Amount; Loss Of Use percentage and calculated Amount; Personal Liability; Medical Payments | Quote Coverage (`iacrm_quotecoverage`), related Quote and Property | Coverage code, limit text/value and percentage/basis. Existing extension code already supports `iacrm_coveragecode`, `iacrm_limittext`, `iacrm_limitvalue` and display order; verify/reuse these before adding anything |
| All Perils Deductible; Theft Deductible; Wind Deductible; Earthquake Deductible | Quote Coverage (`iacrm_quotecoverage`) | Deductible type, amount/text and unit (currency/percent); add only missing equivalents |
| First mortgagee; Second mortgagee; Third mortgagee; Cosigner; Equity line of credit; # of Other Interests | Property Interest / Additional Interest linked to Property | Interest type/order and count; verify the existing relationship table. These presence flags do not identify lenders or create lender records |
| Build Property Loss Settlement | Quote Coverage or carrier Risk Answer | Loss-settlement basis with carrier/question identity |
| Building Additions or Alterations; Increased Replacement Cost Dwelling Percentage; Loss Assessment; Ordinance or Law; Increased Coverage on Credit Card; Increased Limit on Jewelry, Watches and Furs; Water Backup; Increased Mold Property Damage | Quote Coverage (`iacrm_quotecoverage`) / Endorsement | Endorsement/coverage code, limit or percent and unit |
| Identity Theft; Replacement Cost Content; Increase Liability; Personal Injury; Special Personal Property; Sinkhole Collapse | Quote Coverage / Endorsement | Selected Yes / No plus the endorsement code; avoid confusing the election with a claim or risk condition |
| Earthquake Zone; Percent Veneer; Exclude Masonry Veneer | Property risk detail or carrier Risk Answer | Zone choice, veneer percentage and exclusion election, retaining question context |
| Business Name; Business Class; Incidental Business | Property Business / Risk Answer linked to Property | Business name, class and incidental-business election; do not overwrite the insured account's legal business name |
| Coins; Fine Arts; Furs; Guns; Jewelry; Music; Silverware, and each item's Breakage flag | Scheduled Property / Scheduled Item linked to Property | Item/category, insured amount and breakage election on the same child row; seven independent category flags must retain their labels |
| Equipment Breakdown; Service Line Coverage; Safeco Package Option | Quote Coverage / Endorsement or carrier Risk Answer | Coverage/package election with carrier/question identity |

Estimated Replacement Cost already maps to Property reconstruction cost. The two calculated Amount displays are retained separately as **Other Structures: Amount** and **Loss Of Use: Amount**. They are derived values, not additional proposed CRM columns when the coverage record already holds a limit.

## House-system updates

Preferred target: **Property Renovation**, the existing child collection exposed by QuoteCraftZ as `propertyrenovations`, related to its Property. Check its live columns before adding anything. A renovation needs its system/type, update extent, and year on the same child row. Do not create four property rows from four identical "Year Updated" captions.

| EZLynx data | Target entity | Required typed representation |
|---|---|---|
| Heating Update + its Year Updated | Property Renovation, parent Property | System = Heating; update extent = Not Updated / Partial Update / Complete Update; year |
| Electrical Update + its Year Updated | Property Renovation, parent Property | System = Electrical; update extent; year |
| Plumbing Update + its Year Updated | Property Renovation, parent Property | System = Plumbing; update extent; year |
| Roofing Update + its Year Updated | Property Renovation, parent Property | System = Roofing; update extent; year. Property already has `iacrm_roofyear`; reuse it for the current roof year |
| Nationwide: year updated for cooling type | Property Renovation, parent Property | System = Cooling; year; retain carrier/question identity if represented as a risk answer |

If the child table already has system/type and year, this is an extension mapping enhancement, not a request to add duplicate CRM fields. Add an update-extent choice only if the existing schema lacks an equivalent. The current fallback is a labeled property timeline note for each distinct source field.

## Existing fields to reuse

Property address line 1, address line 2, city, state, county, ZIP, usage, occupancy, total living area, year built, construction detail, stories, roof material, foundation, exterior walls, heating detail, secondary heat, burglar alarm, smoke detector, sprinklers, deadbolt locks, extinguisher, purchase price/date, distance to fire station/hydrant, protection class, city limits, roof year, non-smoker, visibility to neighbors and manned security already have mapping destinations. They do not belong in the new-field backlog.

Contact prior years employed already exists as `contact.iacrm_prioryearsemployed` and is mapped through **Contacts (all rows)**. No new field is needed for it.

## Delivery and acceptance

No CRM customizations are deployed by this extension work. Any approved schema change must follow `bettersflyguy/BettersInsuranceCRM`'s feature PR, dev pipeline, browser acceptance and production promotion process, with one accountable ADO work item. Include this handoff, final logical names, PR/commit links and acceptance evidence on that item.

Acceptance: two properties with different fallback values produce two notes on their corresponding properties; multiple labels survive in each note; property 1's fields never land on property 2 or the account; no identifiers enter plain notes; typed destinations replace note fallbacks only after the approved CRM fields are available.

The extension behavior is covered by mocked Dataverse note-binding tests and capture tests. No real client data was loaded into CRM to test note creation.
