# Mapping relationships — 0.1.88

Environments and Pages Mapped are visible at the top of Settings, followed by
the relationship diagram: mapped services on
the left, CRM destinations in the center, and Output columns on the right.
The graph reads the saved page mappings and effective built-in data-service mappings and
updates when mappings or the active environment change. It contains no demo
records, captured values or sign-in tokens. Cached CRM metadata supplies
display names without opening a sign-in prompt.

Click an input to edit its complete mapping in a dialog, including additional
targets and the preferred reverse-fill source. Saving changes only that source
field, re-reading storage to preserve other screens and sites. A mapping changed
elsewhere while the dialog was open must be reopened before saving. Existing
choice translations remain intact. Click a CRM or output field to highlight
its connected paths in pink. Search by source
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
the same input mapping dialog. There is no separate Data Services section.
Whole-settings and page import/export remain available at the top. Services are not permanently
assigned an input-only or output-only role.

The diagram uses local SVG connectors, avoiding a remote renderer or an
additional script dependency. Unit tests cover multi-target direction,
supported aliases, array separation, note/security exclusions and configured
service discovery. The build and all 591 tests in 70 files pass. Browser
acceptance verified the installed page, separate hiding/restoring and
persisted visibility. Version 0.1.88 acceptance verified top section ordering,
input click-to-edit with Vehicles (all rows), saving an unchanged binding, and
tracing with All connections off while all 57 destination nodes remain. No CRM records were written.
