# Map the delivered PL Rater CRM fields

Date: 2026-11-26

## CRM dependency

BettersInsuranceCRM commit `2f0e5b041c89b1caa841755be028809ca34d7317`, solution 1.3.0.391, added the ten Contact, Vehicle and Property columns requested by the QuoteCraftZ schema handoff. The definitions are present on current CRM `origin/dev`.

## QuoteCraftZ changes

- Route PL Rater Years at Occupation to Contact `iacrm_yearsatoccupation`, independently of current-employer tenure.
- Route license plate, ownership years/months, company car and four-wheel drive to their Vehicle columns. Dynamic vehicle collections continue to resolve rows automatically; no fixed column selector is stored.
- Route foundation construction, hot-tub presence and guarded-community presence to their Property columns.
- Route the read-only PL Rater “Distance to Recognized Water Source” field to Property `iacrm_firehydrantdistancerange` without converting the displayed range into an exact distance.
- Preserve the read-only fire-department distance band and alternate-water-supply answer in the matching Property note; neither is coerced into an unrelated scalar.
- Retain record-scoped notes as a non-destructive fallback while showing each captured source only once in Intake.
- Migrate exact former note/default targets to the typed destinations without replacing unrelated user-selected targets.

## Verification

The live Tracey Dittrich Minnesota package identified the hydrant source key as `field:distance to recognized water source`, with the current value “Within 1000 feet.” Automated tests cover collection routing, saved-map migration, choice translation and preview deduplication. No CRM record write is part of this mapping update.
