# EZLynx mapping responsiveness, added targets and previous addresses — 0.2.0

Mapping highlights previously scanned every labelled control again for each
service mapping. A repaint now builds one temporary label/scope inventory and
reuses it for all service mappings. It is discarded after each repaint so SPA
navigation does not reuse stale elements. Badge positions read layout before
writing styles, reducing forced layout work during scrolling. Existing scoped
matching and pink selection behavior remain intact. This addresses observed
hot paths; no end-to-end browser speed multiplier is claimed.

Add target now opens and focuses the new row's target search immediately,
without needing another click on Not captured. Cancelling keeps the original
mapping; selecting another target preserves the first destination.

EZLynx's Previous Address heading includes a parenthetical eligibility hint.
That made its heading exceed the section-title length limit, so the wildcard
address mapping failed to recognize it. Address section titles now strip that
specific conditional suffix before classification. Primary and previous cards
remain distinct sections, both covered by the Addresses collection. The
normalizer also accepts previousAddress and previousAddresses payload entries,
appends them after existing current/address rows, and deduplicates repeated
records of the same type. It retains the current address as the primary value.

Validation: build passed; targeted tests cover immediate picker focus and
multi-target persistence, one service inventory for 60 mappings, stale DOM
replacement, conditional previous-address scope recognition and normalization.
The initial full suite passed 616 tests. After the conditional-heading fix,
616/617 passed with only the pre-existing vehicle-choice timing test exceeding
its 5s threshold at 5.303s. That test and portal mapper tests passed on isolated
rerun (43/43); the final heading/normalizer tests passed (22/22).

Installed both extension folders and activated 0.2.0 in Edge. Preserved the
user's 240 saved EZLynx page mappings before reload. Live Edge verified Add
target immediately showing the search input, then cancelled the unused target.
Verified green outlines across previous-address controls. Ingest captured 54
fields and two distinct address rows: current Maple Grove and previous
Champlin. No CRM writes, changed customer answers, or quote submissions.
