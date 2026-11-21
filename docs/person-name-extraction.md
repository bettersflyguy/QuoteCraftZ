# Full names from lead sources

When a source supplies one person-name field, map it to **Full name** under
Primary contact (or Primary insured when CRM metadata is unavailable). For a source known to use two family
names, choose **Full name (two surnames)**. A repeating contacts section has
the corresponding **Related contact full name (two surnames)** target under
**Contacts (all rows)**. This is a capture transformation, not a new CRM column.

| Captured text | Mapping | Given name(s) | Surname(s) |
| --- | --- | --- | --- |
| Raymond Hendricks | Full name | Raymond | Hendricks |
| José Luis García Márquez | Full name (two surnames) | José Luis | García Márquez |
| Carlos García Márquez | Full name (two surnames) | Carlos | García Márquez |
| João Pedro da Silva Santos | Full name (two surnames) | João Pedro | da Silva Santos |
| María del Carmen de la Cruz | Full name | María del Carmen | de la Cruz |
| García Márquez, José Luis | Full name | José Luis | García Márquez |

Both given names are kept together in CRM's first-name field for the two-surname
mapping. Family-name particles and connectors stay with the surname. Accents,
hyphens, apostrophes and case remain unchanged. Comparison keys fold accents
without changing captured or displayed values. Explicit first/last name fields
take precedence over a split from a full name.

The original full name remains in the capture and raw field record. Recognized
titles are excluded from the split; Jr., Sr. and Roman-numeral suffixes are
retained separately by the parser. These suffixes are shown in identity review
and retained in the captured original; this change does not write a dedicated
CRM suffix column. Automatic mode retains a middle name in the parser and original
capture while retaining the existing first/last CRM projection for plain names.

A string cannot prove where given names end and family names begin. The tool
does not infer a person's culture from accents or spelling. Two-surname mode
uses the last two family-name units; choose it only when that matches the source's
format, and check the editable given names and surnames in CRM review. For example,
María del Carmen de la Cruz has one compound family name and uses the ordinary
Full name target. Joint-person strings such as “José & María García” require
manual identification; the parser does not silently treat them as one person.

The same parser handles capture identity, cross-source person matching, related
contacts, secured-record alignment and form-fill values. An output mapped to
either full-name target receives the held full name, or the joined structured
given names and surnames when CRM is the source.

Author the parser in `src/util/personName.ts`. `npm run build` and `npm run dev`
generate the injected `public/portal/person-name.js` from that source before
building the extension. Do not hand-edit the generated file.
