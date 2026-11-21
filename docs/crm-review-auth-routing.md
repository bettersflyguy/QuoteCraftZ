# CRM review routing and sign-in — 0.2.1

The CRM review previously squeezed the source line, CRM line of business and opportunity routing into one narrow row. Each group now uses a compact stack with full-width line and opportunity controls.

The old substring default could select Builders risk / Home Construction for an incoming Home quote. Defaults now require a unique exact normalized name or a unique known Home/Auto equivalent. Ambiguous choices remain unselected and require a user choice before continuing.

Concurrent CRM metadata and duplicate searches could each launch an interactive sign-in. Same-environment token requests now share their acquisition, and interactive requests for different environments use one queue. Cancellation releases the queue. CRM metadata reads allow time for interactive authentication; line-of-business failures appear in the review instead of silently producing an empty list.

## Validation

- Production build passed; full test suite: 621 tests passed in 78 files.
- Regression tests cover concurrent same-environment sign-in, cross-environment serialization and cancellation recovery, exact/equivalent line matching and ambiguous choices.
- Installed 0.2.1 in both existing unpacked extension folders and reloaded the existing Edge extension identity.
- Live Edge review shows the full-width routing stack. Source ingestion restored 54 fields and three Home quotes. No CRM records were created during verification.
- Live authenticated metadata verification remains pending manual completion of the Microsoft sign-in window. Computer Use cannot automate authentication dialogs.
