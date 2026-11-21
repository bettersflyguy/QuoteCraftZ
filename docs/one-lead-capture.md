# One Lead capture — 0.1.81

Intake has a **1 Lead** icon after Fill from CRM. Select an expanded lead's
detail section on the page; it receives a bright pink outline. Arrow Up
expands the candidate boundary, and Escape (or the icon again) cancels picking.
The panel shows the selected receipt code and a Clear selection action.

Manual Ingest and auto-capture use the same reader, restricted to that live
element and its frame. Read-only label/value text is supported. Existing field
mappings apply inside the boundary; selected records are not permanent mapping
roles or saved row numbers. Picking a smaller section captures that subset.

The selection pauses on navigation, collapse, replacement, or changed identity.
It never resolves an old row position to a new lead or falls back to the full
page. Clearing the selection stops auto-capture as well. Receipt codes identify
repeat calls for the same lead; without one, the selection gets a fresh key and
uses a conservative content/identity fingerprint. A different lead key starts a
fresh held application even for a partial, policy-only capture. CRM association
and pending secured values are cleared through the existing replacement path.

CRM writes still use the existing review/load flow. This change does not write
to CRM when selecting a section. The scope itself stays in the page's memory;
only its tab/frame metadata is held in extension session storage.
