# Destination readiness cart — 0.1.96

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
