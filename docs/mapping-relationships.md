# Mapping relationships — 0.1.92

A compact header and side-by-side Environments / Pages Mapped sections sit
at the top of Settings. Environment switching stays visible; Configure
environments expands the full editable table. They are followed by
the relationship diagram: mapped services on
the left, CRM destinations in the center, and Output columns on the right.
The graph reads the saved page mappings and effective built-in data-service mappings and
updates when mappings or the active environment change. It contains no demo
records, captured values or sign-in tokens. Cached CRM metadata supplies
display names without opening a sign-in prompt.

Input mappings use the original searchable picker directly in compact two-column
rows. Click a mapping cell and select a target; changes save automatically without
a popup or Save dialog. Multiple targets share one source row, including the
preferred reverse-fill source. Green left bars indicate mapped rows; red bars
indicate unmapped rows. Labels trace connections without hiding other fields.
Saving changes only that source field, re-reading storage to preserve other
screens and sites. A mapping changed elsewhere must be refreshed before retrying.
Existing choice translations remain intact. Click a CRM or output field to
highlight its connected paths in pink. Search by source
label, CRM destination or service. Turn All connections off to focus on the
selected destination’s connectors while retaining every other field. Every capture target is shown; output relationships
use only the preferred target, matching reverse-fill behavior. Runtime CRM
aliases share a node. Distinct array and primary-contact targets remain
distinct: a matching caption alone never establishes row identity.

Each input service and output column has its own Hide action. Restore them
from the separate Hidden inputs and Hidden outputs areas. Visibility survives
refresh and only affects this view; it does not remove mappings or change
capture/fill behavior. Notes are capture-only nodes with no output paths.
Secured pass-through targets are excluded from the diagram. Read-only site
values remain subject to the filler's existing skip rules.

New services appear when their fields are mapped on the source site. Settings
does not offer an Add input action. The existing built-in EZLynx data service,
including defaults and unmapped fields, is integrated into the graph and uses
the same inline mapping picker. There is no separate Data Services section.
Whole-settings and page import/export remain available at the top. Services are not permanently
assigned an input-only or output-only role.

The diagram uses local SVG connectors, avoiding a remote renderer or an
additional script dependency. Unit tests cover multi-target direction,
supported aliases, array separation, note/security exclusions and configured
service discovery. The previous full suite passed all 591 tests in 70 files; the 0.1.89 build
and six focused graph/save tests pass. Browser
acceptance verified the installed page, separate hiding/restoring and
persisted visibility. Version 0.1.89 acceptance verified top section ordering,
inline searchable target selection and automatic saving without a dialog, and
tracing with All connections off while all 57 destination nodes remain. No CRM records were written.

Version 0.1.90 uses 24px single-line CRM and Output rows showing display names
only. Hover titles retain entity-qualified display names, stored mapping paths,
canonical CRM paths when different, and source keys for output fields. Green
mapping indicators and pink tracing remain. The production build passes;
browser acceptance verified the compact top sections and single-line rows.

Version 0.1.91 adds independent CRM / Output column resize handles. Drag the
right dotted edge, or focus it and use Left / Right arrows. Column widths
(180–900px) and the Arrow space slider (40–240px) persist independently of
hidden sections and mappings. Connectors redraw during resizing. CRM fields
are grouped by their stored destination entity with display-label dividers and
logical table names from cached metadata or the runtime catalog. Primary and
array contacts, account fields, individual row slots, and notes remain distinct.
Build and eight focused graph/save/layout tests pass. Edge verified widening
CRM and one output independently, adjusting arrow gaps, and refreshing.

Version 0.1.92 separates repositioning from resizing. Drag a column's Move
handle horizontally, or focus it and press Left / Right. Each CRM / Output
column retains its width while moving independently; connectors follow the
visual field bounds. Offsets persist separately from widths and hidden sections.
Reset positions clears offsets only. The canvas provides horizontal scrolling
for columns moved to the right. Build and nine focused tests pass. Edge verified
moving CRM left and an output right without resizing, then refreshing.
