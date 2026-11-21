# One Lead capture — 0.1.82

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

The mapping scanner also discovers read-only label/value rows before they
have been taught, including Datalot-style UL/LI pairs. An empty scan opens
the mapping editor with its click-to-map picker available instead of reporting
that a quote form is required. In One Lead mode, discovery uses the selected
section and frame as well as capture. Reading unmapped lead text does not
request CRM metadata or open a CRM sign-in window.

In 0.1.82 a detail field's own label takes precedence over the surrounding
dashboard table's header. The mapping list shows Name, Home Number and Street
instead of calling all of them Call Time. Mapping and Intake actions use the
side panel's browser window, so a CRM sign-in popup cannot redirect the site
being mapped to login.microsoftonline.com.
