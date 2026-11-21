# Datalot sample record mapping audit

Audited the five expanded sample leads on 2026-11-20. The combined samples expose 37 distinct lead-detail labels, plus the two textarea captions. Import `datalot-sample-records.json` for this site only using QuoteCraftZ 0.1.86 or later. The file contains configuration only, with no captured personal data.

Use **1 Lead** to select the entire expanded detail panel (driver, current/requested policy and vehicles), expanding the boundary with Arrow Up when necessary. Multiple dashboard calls are separate leads, never related contacts or vehicle rows of one insured. Intake refuses an unscoped page containing multiple named receipt-code records. Label keys follow optional fields and reordered calls. Vehicle targets use **Vehicles (all rows)** within that selected lead.

| Source label | Current destination |
| --- | --- |
| Receipt Code | `note` |
| Name | `targets:["contact.fullName","crm:account.name"]` |
| Home Number | `targets:["crm:primarycontact.telephone2","crm:account.telephone1"]` |
| Email | `targets:["crm:primarycontact.emailaddress1","crm:account.emailaddress1"]` |
| Street | `crm:account.address1_line1` |
| City | `crm:account.address1_city` |
| State | `crm:account.address1_stateorprovince` |
| Zip | `crm:account.address1_postalcode` |
| DOB | `crm:primarycontact.birthdate` |
| Gender | `crm:primarycontact.gendercode` |
| Marital Status | `crm:primarycontact.familystatuscode` |
| Occupation | `crm:primarycontact.iacrm_employmentoccupation` |
| Education | `crm:primarycontact.educationcode` |
| Own Home | `note:contact` |
| Accidents | `note:contact` |
| Tickets | `note:contact` |
| DUI | `note:contact` |
| Current Carrier | `crm:priorcoverage.iacrm_priorcarriername` |
| Years Insured | `crm:priorcoverage.iacrm_yearscontinuouscoverage` |
| License State | `crm:primarycontact.iacrm_dlstate` |
| License Issued | `crm:primarycontact.iacrm_dlissuedate` |
| Policy Type | `note:opportunity` |
| Collision Deductible | `note:opportunity` |
| Comprehensive Deductible | `note:opportunity` |
| Number of Vehicles | `note:opportunity` |
| Year | `crm:vehicles[].iacrm_year` |
| Make | `crm:vehicles[].iacrm_make` |
| Model | `crm:vehicles[].iacrm_model` |
| Sub Model | `crm:vehicles[].iacrm_trim` |
| Driving Wheels | `note:opportunity` |
| VIN | `note:opportunity` |
| Ownership | `crm:vehicles[].iacrm_ownership` |
| Use | `note:opportunity` |
| Garage Type | `note:opportunity` |
| Annual Miles | `crm:vehicles[].iacrm_annualmiles` |
| Daily Commute Miles | `crm:vehicles[].iacrm_onewaycommutemiles` |
| Weekly Commute Days | `crm:vehicles[].iacrm_daysdrivenperweek` |
| Notes | `note` |
| Select disposition to edit notes | `note` |

## Fallbacks requiring schema or writer work

- **Own Home:** primary-contact note. Account Ownership is a business ownership choice and is not a homeownership answer. Use a scoped homeownership risk answer or a dedicated field when supported.
- **Accidents, Tickets, DUI:** primary-contact notes preserve boolean/count answers. These summaries do not identify individual incidents; do not fabricate Driving Incident rows. Add a risk-answer mapping/writer for the relevant driver and question.
- **Policy Type:** opportunity note. Standard and State_Minimum are source classifications; they are not policy term or insured type. Add a typed requested-policy classification or risk-answer binding.
- **Collision / Comprehensive Deductible:** separate labelled opportunity-note values. Quote Coverage already models each coverage and deductible; implement the coverage-row writer and its vehicle/quote association before replacing these fallbacks.
- **Number of Vehicles:** opportunity note is a reported count, not permission to invent a second vehicle without details.
- **Driving Wheels, Garage Type:** opportunity notes retain the exact source text. The vehicle catalog exposes no equivalent drive-wheel count/garage-type column in this profile; add the appropriate vehicle risk-answer mapping or dedicated columns. Property Garage type describes a different asset.
- **Use:** opportunity note because observed Other has no matching choice in the current Vehicle Use catalog. Add an Other choice or risk-answer representation; do not translate Other to Pleasure or Business.
- **VIN:** opportunity note because both observed values are masked with asterisks. Do not write a masked value to the canonical VIN. A future conditional transform can send a complete valid VIN to Vehicle VIN while retaining masked text as a note.

Education maps Some College to the existing Some College - No Degree choice; High School Diploma maps to its existing choice. Marital status, gender and owned-vehicle ownership use the catalog choices. Fractional Years Insured remains a string in Years with Continuous Coverage; it is not rounded or assumed to be years with the displayed carrier.

The receipt code is captured in an account note and remains the lead-selection identity. Status menus, recordings, call prices and dashboard summaries are not lead-detail inputs. The configuration does not change any CRM schema or write client records.

## Verification

- Imported the site-only file successfully: 39 saved label bindings. Exported the prior eight mappings before replacing this site's configuration.
- Live simple-record ingest held 30 fields; the two detailed vehicle records held 75 and 73 fields independently. Switching the selected receipt replaced the held client rather than merging their data.
- The detailed sample's coverage overlay reported **37 mapped, 0 unmapped**. Gender M became Male; Some College became Some College - No Degree. Reported vehicle count 2 remained a note while the one supplied vehicle-detail set became one vehicle row.
- `npm run build` passes. All 585 tests in 68 files pass. Regression coverage includes optional fields, reordered records, scoped repeated vehicle rows, scan/pick key agreement, refusal of an unscoped multi-lead capture and propagation of frame errors even when another frame returns an empty capture.
- Live fractional-year capture retained 0.5 and did not inherit the missing street from another client. After the final reload, unscoped ingest displayed the instruction to use 1 Lead and held no combined client data.
- Installed 0.1.86 in both existing extension folders. No CRM record writes or Datalot disposition changes were performed.
