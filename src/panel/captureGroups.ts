import { MAP_PATH_GROUPS } from "@/portal/fieldMaps";
import type { FieldCatalog } from "@/crm/fieldCatalog";

/** Include full-name transformations alongside the live CRM contact columns. */
export function captureGroups(catalog: FieldCatalog | null): {group:string;paths:{path:string;label:string}[]}[] {
  if (!catalog?.entities.length) return MAP_PATH_GROUPS;
  const names = MAP_PATH_GROUPS.flatMap(g => g.paths);
  const crm = catalog.entities.map(e => ({
    group: e.label,
    paths: [
      ...e.columns.map(c => ({path:`crm:${e.key}${e.array ? "[]" : ""}.${c.name}`,label:c.label})),
      ...names.filter(p => e.key === "primarycontact" ? /^contact\.(fullName|latinFullName)$/.test(p.path)
        : e.key === "contacts" && /^contacts\[\]\.(fullName|latinFullName)$/.test(p.path))
    ]
  }));
  return [...crm, ...MAP_PATH_GROUPS.filter(g => /risk data/.test(g.group))];
}
