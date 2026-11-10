# CRM handoff: Policy Drivers and Driving Incidents

For: the CRM enhancement session (BettersInsuranceCRM repo, Git > PR > dev, ADO tracked). DEV only; no production promotion without Nathan's instruction.
From: the QuoteCraftZ (EZLynx Quote Bridge) session, which builds only the extension side against the contract below.

## Why

Today every driving fact sits on the contact, and nothing links a contact to a policy, quote or opportunity. CRM cannot say "Tracy is rated on the Auto policy, Alexander is excluded" or "a driver on one policy, not on another." Split the facts by what they describe:

- **Person facts** (true whatever the policy) stay on **Contact**.
- **The person's role on one policy or quote** goes on a new **Policy Driver** row.
- **Accidents, violations and claims** (many per person) go in a new **Driving Incident** table.

A contact with no Policy Driver row on a policy is simply not a driver on it. A household member who never drives is a contact with no driver rows. An excluded teen is a contact with an "Excluded" row on the Auto policy.

## Current DEV state (checked read-only, 2026-11-09)

- Contact driving columns: iacrm_agefirstlicensed, iacrm_defensivedrivercourse, iacrm_defensivedrivercoursedate, iacrm_dlexpirationdate, iacrm_dlissuedate, iacrm_dlstate, iacrm_dlstatus, iacrm_drivereducation, iacrm_driverratingstatus, iacrm_driverrelationship, iacrm_driverslicense (secured), iacrm_fr44, iacrm_goodstudent, iacrm_licensesuspended, iacrm_maturedriver, iacrm_sr22, iacrm_studentaway, iacrm_telematicsagreement.
- Global choices:
  - iacrm_contact_iacrm_driverratingstatus: 298400000 Rated, 298400001 Excluded, 298400002 Non-Driver
  - iacrm_contact_iacrm_driverrelationship: 298400000 Insured, 298400001 Spouse, 298400002 Child, 298400003 Parent, 298400004 Domestic Partner, 298400005 Other Relative, 298400006 Employee, 298400007 Other
  - iacrm_contact_iacrm_dlstatus: Valid, Permit, Expired, Suspended, Cancelled, Not Licensed, Permanently Revoked
- Contacts with iacrm_driverratingstatus set in DEV: **0** (no data migration needed in DEV; check prod before any promotion).
- Existing person links: iacrm_vehicle.iacrm_primarydriverid > contact, iacrm_watercraft.iacrm_principaloperatorid > contact. No contact N:N to policy, quote or opportunity.
- Policy lookups: iacrm_insuredid (account), iacrm_opportunityid, iacrm_lineofbusinessid, iacrm_carrierid. Quote lookups: iacrm_accountid, iacrm_opportunityid, iacrm_policyid, iacrm_lineofbusinessid.
- Names free: iacrm_policydriver, iacrm_drivingincident.

## 1. New table: Policy Driver (`iacrm_policydriver`)

User-owned, notes on, activities off. Entity set expected `iacrm_policydrivers`. One row per person per policy context (opportunity while quoting, then the policy).

| Column | Schema name | Type | Notes |
|---|---|---|---|
| Name | iacrm_Name | Text 200, primary, required | e.g. "Tracy Dittrich - Auto" |
| Rating Status | iacrm_RatingStatus | Choice, **reuse global** iacrm_contact_iacrm_driverratingstatus | Rated / Excluded / Non-Driver |
| SR-22 Filed | iacrm_SR22Filed | Yes/No | filed on THIS policy (the contact's iacrm_sr22 stays "requires one") |
| FR-44 Filed | iacrm_FR44Filed | Yes/No | same |
| Carrier Driver Number | iacrm_CarrierDriverNumber | Text 50 | the carrier's driver sequence/ID |
| Effective Date | iacrm_EffectiveDate | Date only | when added to the policy |
| End Date | iacrm_EndDate | Date only | when removed |
| Source | iacrm_Source | Text 100 | e.g. EZLynx |

Lookups:

| Lookup | Schema name | To | Required | Delete behavior |
|---|---|---|---|---|
| Driver | iacrm_ContactId | contact | Application required | Cascade (driver gone = row gone) |
| Insured | iacrm_AccountId | account | Application required | Remove link |
| Opportunity | iacrm_OpportunityId | opportunity | no | Remove link |
| Quote | iacrm_QuoteId | iacrm_quote | no | Remove link |
| Policy | iacrm_PolicyId | iacrm_policy | no | Remove link |
| Line of Business | iacrm_LineOfBusinessId | iacrm_lineofbusiness | no | Remove link |

## 2. New table: Driving Incident (`iacrm_drivingincident`)

User-owned, notes on. Entity set expected `iacrm_drivingincidents`. Many per contact (the EZLynx Incidents step, MVR, CLUE).

| Column | Schema name | Type | Notes |
|---|---|---|---|
| Name | iacrm_Name | Text 200, primary, required | e.g. "Accident 03/2024" |
| Incident Type | iacrm_IncidentType | Choice (local) | 298400000 Accident, 298400001 Violation, 298400002 Comprehensive Claim, 298400003 Suspension, 298400004 Other |
| Incident Date | iacrm_IncidentDate | Date only | |
| Description | iacrm_Description | Multiline 2000 | e.g. "Speeding 15+ over" |
| At Fault | iacrm_AtFault | Yes/No | |
| Points | iacrm_Points | Whole number | |
| Amount Paid | iacrm_AmountPaid | Currency | |
| Source | iacrm_Source | Text 100 | |

Lookups: iacrm_ContactId > contact (required, Cascade), iacrm_AccountId > account (required, Remove link), iacrm_VehicleId > iacrm_vehicle (optional, Remove link), iacrm_PolicyId > iacrm_policy (optional, Remove link).

## 3. Forms and views

- **Opportunity form:** "Drivers" tab with a Policy Driver subgrid (all columns), same pattern as the Prior Coverage tab.
- **Policy form:** "Drivers" subgrid of Policy Driver.
- **Contact form:** "Policies driven" subgrid (Policy Driver) and "Driving history" subgrid (Driving Incident).
- **Account form:** optional "Drivers" subgrid.
- Views: Active Policy Drivers, Policy Drivers by Opportunity, Active Driving Incidents. Lookup/quick-find on Name and Driver.

## 4. Quote to policy

When a policy is created with iacrm_opportunityid set, the opportunity's Policy Driver rows that have no policy get iacrm_PolicyId stamped (plugin or flow; your choice). The quoted roster becomes the policy roster without the extension having to do it, whatever path created the policy.

## 5. Contact rating status

iacrm_driverratingstatus on contact is a per-policy fact. Remove it from the contact form and mark it deprecated in its description; keep the column for now. DEV has no data in it; check prod before promotion and, if any, create one Policy Driver row per populated contact on that contact's open Auto opportunity or active Auto policy. iacrm_driverrelationship stays on the contact (one household relationship per insured).

## 6. Security and AMS isolation

- Roles: mirror iacrm_policy's privileges on both tables.
- The Momentum Connector role gets **no privileges** on either table: they never sync to NowCerts (same as Prior Coverage). NowCerts keeps drivers per insured with policy assignments, so Policy Driver can map onto that if driver sync is designed later. That is out of scope here.
- Never write iacrm_amsexternalid, iacrm_synctoams or iacrm_lastsyncon.

## 7. Report back to the QuoteCraftZ session

The extension reads columns live from CRM metadata, so new columns appear without a release. Please confirm:

1. The entity sets (`iacrm_policydrivers`, `iacrm_drivingincidents`).
2. The **exact navigation property names for @odata.bind** on each lookup. Prior Coverage uses schema case (`iacrm_AccountId`), while the asset tables use lower case (`iacrm_accountid`).
3. The choice values as created.
4. The solution version and dev merge commit.

## What QuoteCraftZ will build against this

- New list targets in the mapping search: **Policy drivers (all rows)** and **Driving incidents (all rows)**.
- EZLynx Drivers step:
  - person fields map to Contacts (all rows), as now;
  - rating status, SR-22/FR-44 filed and carrier driver number map to Policy drivers.
- Each card's row resolves its contact by the name on that card (shipped in v0.1.66).
- On Load:
  - one Policy Driver per driver row: contact + account + that line's opportunity + line of business (+ quote when one is created), upserted by contact + opportunity (or policy);
  - incidents are upserted by contact + type + date.
- Fields secured today (license number) stay on the secured channel.
