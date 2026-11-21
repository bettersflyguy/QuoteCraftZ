# One full-name mapping for mixed lead formats

Map Datalot's Name field to **Primary contact → Full name**. Use **Add target**
for Account name if the complete name should also feed the personal account.
Keep one contact-name target for the site. A list uses **Related contact full
name** under **Contacts (all rows)**.

Full name supports variability between leads:

| Captured text | Handling | Given names | Surnames |
| --- | --- | --- | --- |
| Raymond Hendricks | Automatic two-part split | Raymond | Hendricks |
| Carlos García Márquez | Confirm Two surnames for this person | Carlos | García Márquez |
| José Luis García Márquez | Confirm Two surnames for this person | José Luis | García Márquez |
| John Michael Smith | Confirm One surname for this person | John Michael | Smith |
| María del Carmen de la Cruz | Confirm One surname for this person | María del Carmen | de la Cruz |
| García Márquez, José Luis | Explicit surname-first order | José Luis | García Márquez |

When a full name is ambiguous, Intake shows **Name split** above the captured
data. It shows the original name, **One surname** and **Two surnames** buttons,
editable **Given name(s)** and **Surname(s)** fields, and **Confirm name split**.
These buttons propose boundaries; the fields remain editable for other patterns.
This choice belongs to that captured person, not the Datalot mapping. Related
contacts can each use a different split. A changed source name, identity context,
or selected lead invalidates an old confirmation. Re-reading the same person
preserves it. **Edit split** changes a previously confirmed boundary.

Unconfirmed ambiguous names cannot be used for form fill or a capture-driven
CRM load. Confirmed parts feed the contact's first/last name fields and later
form fills. The original full name and the independent Account name target
remain unchanged. A two-word name or already structured first/last fields do
not require this review. Separately captured name fields take precedence.

Accents, case, hyphens and apostrophes are preserved. Matching folds accents
without changing stored values. The confirmed given names stay together in
the contact's first-name field. Recognized suffixes remain in the original
capture; this change does not write a separate CRM suffix column. A string
alone cannot prove its intended boundary, and the tool does not infer a person's
culture from spelling or accents.

Older **Full name (two surnames)** bindings remain readable for compatibility,
but are no longer offered as a site-wide choice. Their ambiguous names also
require per-person confirmation. New mappings use **Full name**.

Author the parser in `src/util/personName.ts` and per-capture review handling
in `src/boldpenguin/nameReview.ts`. The build generates the injected parser
from the TypeScript source; do not edit `public/portal/person-name.js` by hand.
