# EZLynx Choice mapping audit — in progress

The owner requested a source/CRM-name filter and a browser review of every Choice field. The filter is implemented for both data-service and page-field mappings. It matches source labels, sections, mapping keys, target schema paths and resolved CRM display labels; filtering does not remove saved mappings or change page highlighting. Picking a page field clears the filter so the selected row can be shown.

Build passed. Full suite: 634 passed and one existing vehicle-choice performance timing assertion exceeded its 5-second limit under parallel load. Isolated vehicle-choice suite passed all 37 tests. Browser verification confirmed filtering by CRM display name New or used and source/CRM Performance and Ownership.

## Browser review log

| Screen / field | Source values reviewed | Result |
|---|---|---|
| Auto Vehicles — Was the car new? | Yes, No | Both were No match. Corrected Yes → New and No → Used in Vehicles all rows; saved the page mapping (240 rules retained). |
| Auto Vehicles — Performance | Standard, Sports, Intermediate, High Performance | Verified automatic matches Standard, Sports, Intermediate, High respectively. |
| Auto Vehicles — Ownership Type | Owned, Leased, Lien | Owned/Leased automatic matches verified. Corrected Lien → Financed and saved. |

The remaining vehicle, driver, applicant/contact, policy, Home and carrier Choice fields are pending browser review. Do not interpret this checkpoint as completion of that audit. No source quote answers or CRM client records have been changed by the audit.
| Auto Vehicles — Vehicle Use | To/From Work, Business, Farming, Pleasure, To/From School | Corrected To/From Work → Commute and saved. Verified Business → Business, Farming → Farm, Pleasure → Pleasure, existing To/From School → Commute. |
| Auto Vehicles — Anti-Theft | None, Active, Alarm Only, Passive, Vehicle Recovery System, Both Active and Passive, VIN# Etching | First five automatically match None, Active disabling, Alarm, Passive disabling, Vehicle recovery system. CRM menu has no combined Active+Passive or VIN etching choice; these two remain genuine option gaps, not substituted with an inaccurate value. |
| Auto Vehicles — Passive Restraints → Airbags | None, Automatic Seatbelts, Airbag (Drvr Side), Auto Stbelts/Drvr Airbag, Airbag Both Sides, Auto Stbelts/Airbag Both | Fixed incorrect automatic Side matches: Airbag (Drvr Side) → Driver and Airbag Both Sides → Driver and passenger. Mapped both combination values to their airbag component Driver / Driver and passenger. None matches. Automatic Seatbelts has no equivalent in the Airbags CRM choice; a separate restraint type field is needed to preserve belt details. |

## Checkpoint / remaining work

The browser exported the saved configuration after corrections. `docs/audits/ezlynx-choice-options-2026-11-21.json` records the exported Choice map values only (no applicant data). All 240 page mappings remain present.

Refreshing the source page redirected to EZLynx login. Authentication must be completed by the user before this browser audit can continue. This is not a completed audit.

Still pending: applicant/contact choices (DL status, gender, marital status, industry, occupation, relationship, preferred time and data-service Choice targets); Auto/Home policy term and coverage choices; Home usage, occupancy, foundation, roof/heating, alarms, smoke detector, sprinkler, city limits and swimming pool; carrier-specific Choice controls and any not-yet-mapped source controls on those screens. Choice-shaped source controls with Boolean, Integer or String CRM targets also need a semantic check, although they do not expose a Picklist value editor.

Metadata confirms vehicle anti-lock brakes, car pool, daytime running lights, prior damage present, telematics, transportation network company and used for delivery are Boolean; days driven per week and weeks per month are Integer. They must not be treated as missing Picklist editors.

The filter remount issue was corrected in commit 82383be: changing a search closes open Choice editors; page mapping opens one Choice reader at a time. Rebuilt and copied into both installed extension folders. Focused picker verification: 4 tests passed. Login prevents final live verification of the revised panel until sign-in.

Lossy representations needing follow-up: CRM Commute combines school and work, so reverse fill needs additional context to distinguish them. The Airbags column captures the airbag component of combined seatbelt/airbag choices but cannot preserve automatic-seatbelt details; Automatic Seatbelts alone remains unmatched.
