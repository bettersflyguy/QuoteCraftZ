# CRM Agent and capture display — 0.1.95

The panel header has a searchable CRM Agent field. It searches enabled CRM
system users, showing email addresses to distinguish same-name users. Choosing
a result saves the existing servicing-agent preference per environment; the
quote load picker shares it and listens for updates. Switching environments
loads that environment's preference. Clearing the field clears its preference.
First-use CRM user search allows the interactive sign-in timeout.

The selected user becomes owner through ownerid@odata.bind on POST creates
of accounts, contacts, leads, opportunities, quotes, policies, prior coverage,
and the supported asset/child tables. Both direct POSTs and batch POSTs apply
it. PATCHes and shared reference tables are excluded. This sets ownership;
Created By remains the authenticated caller and no impersonation is used.
An unset preference retains existing behavior.

An insured intake load ensures the selected user has a servicing-team row on
the account even when no quotes are selected. It uses the existing Producer
role, Account scope, and metadata-verified systemuser/account lookup paths.
Existing membership is reused. Failures surface as a load-result error row;
existing account/contact owners are not reassigned by ordinary enrichment.
The existing explicit quote-load servicing behavior is preserved.

Intake's flat source-value list shows one row per source/section/group/name/
label/value combination, regardless of multiple CRM target facts. Distinct
values and repeated entity rows are preserved. Storage, normalization, grids,
exports, and CRM target writes retain the original facts. The displayed field
count uses the same source-row deduplication.

Validation: the existing full suite passed 595 tests in 71 files; six added
tests cover per-environment preferences, owned create filtering, actual direct
and batch request bodies, quote-free servicing assignment, and display
collapse without losing target facts. The build passes. Edge acceptance found
CRM users, selected Nathan Betters for the current environment, and showed
Home Number / Name once each (28 displayed source fields, 30 stored facts).
No CRM records were created for acceptance; assignment writes were tested
with mocked Dataverse responses.
