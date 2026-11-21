# Mapping relationships — 0.1.87

Settings opens with the installed relationship diagram: mapped services on
the left, CRM destinations in the center, and Output columns on the right.
The graph reads the saved page and configured data-service mappings and
updates when mappings or the active environment change. It contains no demo
records, captured values or sign-in tokens. Cached CRM metadata supplies
display names without opening a sign-in prompt.

Click a field to highlight its connected paths in pink. Search by source
label, CRM destination or service. Turn All connections off to focus on the
selected destination. Every capture target is shown; output relationships
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
does not add empty input sources. Change mappings through the source site's
field selector, or expand Environments and mapping editors for the existing
data-service editor and import/export tools. Services are not permanently
assigned an input-only or output-only role.

The diagram uses local SVG connectors, avoiding a remote renderer or an
additional script dependency. Unit tests cover multi-target direction,
supported aliases, array separation, note/security exclusions and configured
service discovery. The build and all 587 tests in 69 files pass. Browser
acceptance verified the installed page, separate hiding/restoring and
persisted visibility. No CRM records were written.
