# Explicit opportunity selection — 0.2.4

Previously, "Open opportunity, else new" silently reused the first open opportunity whose line matched a quote group. Users could not distinguish a renewal from another purchase or another open request for the same insured and line.

The load flow now reviews the identity and CRM lines, selects an insured, and opens an Opportunities step before enrichment or quote writes. Each quote group requires either a specific open opportunity or New opportunity. Choices show the opportunity name, CRM line and desired effective date. Other lines remain visible but disabled. Nothing is selected automatically, even if only one opportunity matches.

Existing opportunities are fetched for the selected account and revalidated against a fresh open list before the account or quotes are written. A closed, moved or wrong-line selection stops the operation rather than silently switching opportunities or creating another. New accounts also collect explicit new-opportunity choices before creation. A newly created account is retained in the current flow if enrichment needs retry, avoiding another account creation on the same screen.

## Validation

- Production build passed.
- Full suite before the final integration test: 631 tests passed in 81 files; the added full-flow integration test also passed. Final focused selection suite: six tests passed in three files.
- Coverage includes two open opportunities on the same line, an explicit second selection, separate lines, new opportunities, missing choices, closed/other-account/wrong-line IDs, and rejecting incomplete lines.
- The full-flow test proves selecting an insured performs no enrichment writes; after explicit selection, quote writes carry the chosen second opportunity and do not create a new one.
- Both existing installed extension folders updated; Edge version 0.2.4 activated. Tracy's source capture restored with 96 fields and three quotes. Live authenticated opportunity-list acceptance remains pending manual Microsoft sign-in. No CRM records were created for verification.

## 0.2.6 — compact grid for multiple opportunities

Opportunities are independent of captured quote groups. The account-selection step always opens a compact Line / Opportunity grid. Every CRM line is available in each row. Users can add rows with +, remove optional rows with ×, select an existing open opportunity, or choose New and enter a name. Multiple opportunities may use the same CRM line. Captured quote groups retain required routing rows; optional rows can create or select opportunities without writing synthetic quotes.

Captured section names and concrete vehicle/property rows provide suggestions independently of selected quotes. This fixes Tracy's case: her held quotes contained only Home, while her captured Auto vehicle/driver sections now suggest Auto as another opportunity row. Suggestions remain unselected until the user chooses an existing opportunity or New. The CRM line defaults also update when captured quote groups change after metadata has loaded.

New opportunities use the selected CRM line's pipeline/stage metadata and the entered name, with account + line as the name fallback. Existing IDs are revalidated against the selected account's open opportunities before writing. No opportunities are automatically created merely from suggestions.

Validation: production build and all 635 tests passed in 82 files. New tests cover Auto/Travel/Life suggestions, arbitrary CRM line entry, add/remove/name controls, and creating two named opportunities with no captured quotes. Installed files in both existing extension folders and reopened the panel without a full extension reload, retaining Tracy's 257 held fields. Live authenticated acceptance verified Homeowners and Auto rows and the add-row control. Save to CRM was not clicked; no CRM records were written during acceptance.
