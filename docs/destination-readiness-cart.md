# Destination readiness cart — 0.1.97

Intake has a shopping-cart icon after 1 Lead. It opens a Ready to quote
flyout listing mapped sites and the built-in EZLynx service with a percentage,
progress bar, and available/total mapped-answer count. The same cart is
available beside commercial capture. Expanding a destination lists missing
answers grouped by CRM entity, with applicant/contact/row context and schema
paths on hover. Data and mapping changes refresh the view.

Coverage is based on the current held application's fill values, including
CRM information previously pulled into it. Opening the cart does not query all
CRM records, start sign-in, or change mappings. It is mapped-data availability,
not a carrier-required-field checklist or a guarantee a quote can be submitted.
Unmapped questions and conditional requirements have not yet been inventoried.
Read-only destination elements remain subject to the existing filler skip rules.

Each source mapping contributes only its preferred fill target, regardless of
additional capture targets. Notes, Never fill, and secured pass-through targets
are excluded. Collection fields are evaluated for every known row; contacts
include the applicant. No known vehicle/property rows yields one missing row
rather than 100% completion. Zero fillable mappings displays Not assessed.
Pending ambiguous name splits block filling and parsed first/last-name credit.
Missing answers never fall back to another person's or asset's value.

Open destination focuses an existing tab for the origin in the current window,
or opens its origin if none exists. It never submits a quote or fills an
arbitrary newly opened page. On the currently active mapped destination, Fill
this page calls the existing explicit fill action with its permissions and
name-review gates. The agent can fill known answers before all are present.
No default confirmation or auto-submission is introduced.

Validation: production build and all 606 tests in 74 files pass. Five new tests
cover preferred-target counting, aliases, note/security exclusions, repeated
vehicles/contacts, empty mappings, zero answers and ambiguous names. Installed
in both existing extension folders. Edge verified the cart, progress bars,
grouped missing answers and focusing the existing Datalot tab without losing
the held application. The sample showed Datalot 9/24 (37%) and EZLynx 13/32
(40%) using its current mappings. No CRM records or quote forms were written
during acceptance.

## Inline missing-answer entry — 0.1.97

The flyout uses a pale blue background, blue border/top edge, and a stronger
shadow to separate it from Intake. Each missing concrete target has a compact
right-hand entry control. Cached CRM choices/booleans use selects, DateTime
uses a date control, and numeric columns use number controls. Other fields
use text. Duplicate destinations for one target share the answer; one target
appears only once per entity group within a destination.

Text saves on blur or Enter; selections save immediately. Successful saves
remove the missing item and recompute all destination percentages. Answers
are stored on the current held application as Express entry target facts,
retaining the lead identity, quotes, and person/asset slot. They join the
existing reviewed Load to CRM flow; entering a value does not directly write
CRM. Known answers are never overwritten by this missing-answer editor.

Worker-side checks re-read mappings and allow only currently missing mapped
targets, validate supported CRM types, block secured/identifier paths, and
reject changed application revisions/lead identity. Express saves are
serialized. Missing metadata falls back to text without inventing choices.
Existing name-review gates remain in effect.

Build and all 609 tests in 75 files pass. Edge verified the distinct flyout,
right-hand text/date controls, and real CRM choice options (Owned, Financed,
Leased). No unknown client answers or CRM records were entered for browser
acceptance; saving, row identity, shared readiness updates, validation and
stale/unmapped-request rejection are covered by automated tests.
