# One source field, multiple targets

Select the first target, then click **Add target** below its dropdown to add
another. For a personal-lines lead, the same Name value can feed **Account name**
under Insured (account) and **Full name** under Primary contact. The two-surname
name transformation can also be one of the targets. Each target receives the
same source value on capture and applies its own routing and choice mapping.

The filled star marks the **preferred fill source**. Click another target's
empty star to make it preferred. Reverse filling uses only the preferred target;
it does not overwrite the form repeatedly or switch to another target when the
preferred value is absent. That case is reported as no data. Read-only source
text can be captured but is not changed by form fill.

Remove a target with its trash icon. Removing one leaves the others intact.
The outer mapping trash icon clears the field's entire mapping. Up to eight
distinct targets can be added. A pending empty added target is not saved.

Targets appear in both the page mapper and data-service mapper. Page mappings
save with **Save mapping**. Data-service changes save as you go. A list target
keeps its own contact/vehicle/property row; every-row teachings fan out the
targets within each source row. CRM choice targets each have their own choice
mapping control. Field highlights list all target labels together.

Secured identifiers and **Never fill** remain single-target mappings. They
cannot be combined with other destinations. Export/import validates each target
and excludes secured mappings as before. Use QuoteCraftZ 0.1.84 or newer when
sharing mappings with multiple targets.

Existing single-target mappings remain plain strings and need no migration.
Multiple targets use an ordered `targets:[...]` string in the existing storage
and share-file shape. The first item is the preferred fill source. Capture
expands that binding into independent mapped facts before normalization; facts
with the same source label and value but different destinations are retained.
