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
