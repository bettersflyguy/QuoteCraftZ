# EZLynx Choice mapping audit — in progress

The owner requested a source/CRM-name filter and a browser review of every Choice field. The filter is implemented for both data-service and page-field mappings. It matches source labels, sections, mapping keys, target schema paths and resolved CRM display labels; filtering does not remove saved mappings or change page highlighting. Picking a page field clears the filter so the selected row can be shown.

Build passed. Full suite: 634 passed and one existing vehicle-choice performance timing assertion exceeded its 5-second limit under parallel load. Isolated vehicle-choice suite passed all 37 tests. Browser verification confirmed filtering by CRM display name New or used and source/CRM Performance and Ownership.

## Browser review log

| Screen / field | Source values reviewed | Result |
|---|---|---|
| Auto Vehicles — Was the car new? | Yes, No | Both were No match. Corrected Yes → New and No → Used in Vehicles all rows; saved the page mapping (240 rules retained). |
| Auto Vehicles — Performance | Standard, Sports, Intermediate, High Performance | Verified automatic matches Standard, Sports, Intermediate, High respectively. |

The remaining vehicle, driver, applicant/contact, policy, Home and carrier Choice fields are pending browser review. Do not interpret this checkpoint as completion of that audit. No source quote answers or CRM client records have been changed by the audit.
