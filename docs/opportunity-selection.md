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
