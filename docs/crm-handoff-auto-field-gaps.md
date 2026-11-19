# CRM handoff: EZLynx Auto and contact field gaps

Requested by Nathan on 2026-11-19. Owner for handoff: Nathan Betters. This extends [the existing policy/driver design](crm-handoff-policy-drivers.md) and [Home gaps](crm-handoff-home-field-gaps.md).

These are gaps in the available extension mapping contract, not proof that every suggested column is absent from Dataverse. Check current dev metadata and managed dependencies before adding columns. Reuse existing equivalents. No CRM schema changes or real client loads were performed during this configuration.

| Source field(s) | Target entity | Proposed representation | Current fallback |
|---|---|---|---|
| Preferred Language | Contact (`contact`) | Preferred language choice/text, suggested `iacrm_preferredlanguage`, only if no equivalent exists | Each contact's own timeline |
| Rated Driver | Policy Driver (proposed policy/contact relationship) | Rating status for this application/policy; reuse the design in the policy-driver handoff | Each contact's own timeline; retains the source caption |
| Good Driver | Policy Driver / carrier Risk Answer | Eligibility answer, retaining the carrier/question and time window; do not infer an underwriting decision | Each contact's own timeline |
| Alternate Garage | Vehicle (`iacrm_vehicle`) and its garaging Address relationship | Alternate-garage flag and address lookup if absent; the source currently exposes only a disabled flag, not an alternate address | Opportunity notes, each vehicle row in source order |
| Driver/vehicle assignment percentages | Vehicle Driver Assignment (proposed relationship) | Driver lookup, vehicle lookup and percentage on the same row; percentages belong to the relationship, not a general driver field | Opportunity notes; every matrix cell retains driver and vehicle captions plus percentage |
| Date of Accident; Driver; Accident Description; PD Amount; BI Amount; Collision Amount; MP Amount; Vehicle Involved | Driving Incident (proposed), linked to policy/application, Contact and Vehicle | Incident date/type, driver and vehicle relationships, separate property-damage, bodily-injury, collision and medical-payment amounts | Opportunity notes, all incident rows with their labels and driver/vehicle context |
| Bodily Injury; Uninsured Motorist; Underinsured Motorist; Property Damage; Medical Payments | Quote Coverage (`iacrm_quotecoverage`) | Coverage code, split limits / amount / limit text, and applicable quote | Opportunity notes; Auto scope prevents property-note routing |
| MN Personal Injury Protection Options; PIP Deductible; Work Loss; PIP Stacking | Quote Coverage / state Risk Answer | State, coverage code, option/limit, deductible and stacking election | Opportunity notes |
| Comprehensive; Collision; Towing & Labor; Rental Expense; Stated Amount; Loan/Lease Coverage; Liability Not Required; Full Glass | Quote Coverage linked to Vehicle and Quote | Per-vehicle coverage/deductible/election rows; preserve each vehicle's order and identity | Opportunity notes, repeated vehicle rows |
| Residence is; Multipolicy Discount; Retirement Community; AAA Membership Discount; Company Car Insured Elsewhere | Application / Policy Risk Answer | Per-application answer and question identity; verify the existing application/risk-answer model before adding individual columns | Opportunity notes |
| Auto currently insured in agency?; Special Physical Damage for Vehicle; vehicle branded-title question; Product to be quoted | Carrier Risk Answer linked to Quote and, where applicable, Vehicle | Carrier, question identifier/caption, value and relevant asset relationship | Opportunity notes, every vehicle row |
| Stillwater multipolicy question; Travelers book transfer | Carrier Risk Answer linked to Quote | Carrier/question and answer; keep multipolicy discount category (not a Boolean) | Opportunity notes |

Prior-coverage month fields and application authorization/package/paperless questions are listed in the Home handoff and apply to Auto too. No duplicated backlog entries are needed.

## Existing columns reused

Prior employer years already maps to `contact.iacrm_prioryearsemployed` through Contacts (all rows). Prefix and suffix reuse `contact.salutation` and `contact.suffix`; contact time reuses `contact.preferredappointmenttimecode`. Applicant Postal Code reuses `account.address1_postalcode`.

FR-44, good student, student away, driver education, mature driver and driver telematics reuse the Contact columns documented in the existing dev contract: `iacrm_fr44`, `iacrm_goodstudent`, `iacrm_studentaway`, `iacrm_drivereducation`, `iacrm_maturedriver`, `iacrm_telematicsagreement`. DL status/state, first licensed age, license suspension, SR-22 and defensive course date already have typed mappings. SSN and DL numbers remain local Secured: Contacts (all rows) mappings and never enter ordinary captures or notes.

Vehicle use, passive restraints/airbags, anti-theft, anti-lock brakes, daytime running lights, performance, commute days/week and weeks/month, new-or-used, ownership, carpool, telematics and transportation network company all have existing Vehicles (all rows) destinations and are mapped. They do not need new CRM columns.

Prior liability limits and prior term reuse Prior Coverage `iacrm_liabilitylimits` and `iacrm_policyterm`. New term and description reuse Quote `iacrm_term` and `iacrm_description`. New-policy coverage limits must not be written to Prior Coverage.

## Boundary and delivery

Auto's additional Carrier Questions screen currently reports that the application is incomplete and exposes no additional questions. Its Invalid screen reports existing policy-date/liability and accident-date errors. No source values were changed or a quote submitted to force those conditional questions to appear. Empty violations/comp-loss sections were inspected without creating fictional records.

Any approved schema work follows the BettersInsuranceCRM GitHub feature PR/dev pipeline and accountable ADO work-item process. This is a schema and mapping handoff, not a CRM deployment.
