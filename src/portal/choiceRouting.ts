/** Applies one-for-one choice mappings to the two directions of travel. */
import type { CapturedAppField } from "@/boldpenguin/types";
import type { CatalogColumn, FieldCatalog } from "@/crm/fieldCatalog";
import { columnKeyOf, entityKeyOf, toCrmChoice, toSourceText, type ColumnOptionMap } from "./optionMaps";

/** The catalog choice column behind a CRM target, or null. */
export function choiceColumnOf(target: string, catalog: FieldCatalog | null): CatalogColumn | null {
  const ek = entityKeyOf(target);
  const name = /\.([a-z][a-z0-9_]{0,99})$/.exec(target)?.[1];
  const col = catalog?.entities.find(e => e.key === ek)?.columns.find(c => c.name === name);
  return col && col.type === "Picklist" && col.options?.length ? col : null;
}

/** Capture direction: a field routed to a CRM choice column carries the CRM
 * choice's own label (so the Data tab shows what lands in CRM and the load
 * writes the exact value). Unmatched text is left as captured. */
export function translateCapturedChoices(
  fields: CapturedAppField[], scope: Record<string, ColumnOptionMap> | undefined, catalog: FieldCatalog | null
): CapturedAppField[] {
  return fields.map(f => {
    if (!f.mapped?.startsWith("crm:")) return f;
    const col = choiceColumnOf(f.mapped, catalog);
    const key = columnKeyOf(f.mapped);
    if (!col || !key) return f;
    const choice = toCrmChoice(f.value, scope?.[key], col.options!);
    return choice && choice.label !== f.value ? { ...f, value: choice.label } : f;
  });
}

/** Fill direction: for every control mapped to a CRM choice column, the
 * value becomes the form's own wording for that choice (when mapped). */
export function translateFillChoices(
  values: Record<string, string>, overrides: Record<string, string>,
  scope: Record<string, ColumnOptionMap> | undefined, catalog: FieldCatalog | null
): Record<string, string> {
  if (!scope) return values;
  const out = { ...values };
  for (const path of new Set(Object.values(overrides))) {
    if (!path.startsWith("crm:") || !out[path]) continue;
    const col = choiceColumnOf(path, catalog);
    const key = columnKeyOf(path);
    if (!col || !key) continue;
    const text = toSourceText(out[path]!, scope[key], col.options!);
    if (text) out[path] = text;
  }
  return out;
}
