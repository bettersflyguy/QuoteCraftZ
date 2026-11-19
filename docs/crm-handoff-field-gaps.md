# EZLynx mapping completion and CRM field handoff

Configured on 2026-11-19 in QuoteCraftZ 0.1.80. Owner: Nathan Betters.

Missing Home destinations now use **Notes: Properties (all rows)** or **Property 1 notes** for explicitly singleton native fields. Capture retains the original field label and value. A CRM load binds each note only to its matching Property record. Contact and Vehicle mappings use their own all-row collections. EZLynx Details/Drivers start with the applicant; generic related-contact lists retain their existing row convention.

## Fields and target entities

- [Detailed Home list](crm-handoff-home-field-gaps.md): 24 proposed Property fields, including retiree credit, wood-burning stove count and dwelling/property type; policy/application fields; coverage and endorsement child records; financial interests; scheduled items; house-system renovation details.
- [Detailed Auto/contact list](crm-handoff-auto-field-gaps.md): preferred language on Contact, policy-specific driver facts, driver/vehicle assignment relationships, driving incidents, per-vehicle coverages and carrier risk answers.
- [Existing policy/driver model handoff](crm-handoff-policy-drivers.md): the previously documented dev metadata and proposed Policy Driver / Driving Incident relationships.

A catalog gap is not proof that a CRM column is missing. Check current dev metadata and managed dependencies, then reuse existing equivalents before adding anything. The detailed lists distinguish existing columns from proposed fields and child-record mapping enhancements.

## Saved configuration and browser acceptance

The browser has **237 page mappings** (235 shareable entries plus 2 local secured mappings), and **63 Data Service fields mapped / 0 unmapped**. The [shareable page preset](mappings/ezlynx-2026-11-19.json) contains mapping configuration and choice mappings only; it excludes secured bindings and client values. Import preserves locally configured secured bindings.

| Screen | Mapped fields/cells observed | Unmapped fields observed |
|---|---:|---:|
| Applicant Details | 44 | 0 |
| Home Rating | 2 | 0 |
| Home Policy Info | 21 | 0 |
| Home Dwelling Info | 57 | 0 |
| Home Coverage | 20 | 0 |
| Home Endorsements | 38 | 0 |
| Auto Rating | 1 | 0 |
| Auto Policy Info | 16 | 0 |
| Auto Drivers, two rows | 48 | 0 |
| Auto Vehicles, two vehicles and four assignment cells | 58 | 0 |
| Auto Incidents, existing accident | 8 | 0 |
| Auto Coverage | 36 | 0 |

Counts refer to rendered mapped outlines, not unique saved rules. Grey search/template/apply-to-all controls are intentional source controls. Home Carrier Questions and Valid have no additional data fields. Auto Carrier Questions is gated by existing source validation errors and currently exposes no additional questions; Invalid lists errors, not mapping fields. Conditional fields that EZLynx has not rendered are outside this observed acceptance. No source values were changed, no fictional incidents/assets were created and no quote was submitted.

Mapped-row selection highlights the source field bright pink. Troubleshooting controls were removed. Cross-screen save preservation remains covered by regression tests. Calculated home coverage amounts retain distinct captions and never become extra property rows. Driver assignment notes retain both axes of the matrix. Secured label mappings use the separate pass-through channel and are excluded from ordinary captures/notes.

No real client data was loaded into CRM during verification. Property-note binding is covered with mocked Dataverse tests; this does not claim a production note-write acceptance. Any schema changes follow the BettersInsuranceCRM GitHub pipeline and ADO tracking rules.
