/** Agent-taught per-site field mappings: storage shape, the mappable CRM
 * paths, and the share-file (export/import) format used to move mappings
 * between business users' extensions. */

export const FIELDMAP_STORAGE_KEY = "portal/fieldMap";

/** { [origin]: { [controlKey]: rulePath | "skip" } } */
export type FieldMaps = Record<string, Record<string, string>>;

/** CRM fields the mapping editor can bind a page control to — mirrors the
 * mapper's rule paths (public/portal/portal-mapper.js). */
export const MAP_PATHS: { path: string; label: string }[] = [
  { path: "contact.firstName", label: "First name" },
  { path: "contact.lastName", label: "Last name" },
  { path: "contact.fullName", label: "Full name" },
  { path: "contact.email", label: "Email" },
  { path: "contact.phone", label: "Phone" },
  { path: "contact.dateOfBirth", label: "Date of birth" },
  { path: "contact.gender", label: "Gender" },
  { path: "contact.maritalStatus", label: "Marital status" },
  { path: "address.street1", label: "Street address" },
  { path: "address.street2", label: "Street line 2 / unit" },
  { path: "address.city", label: "City" },
  { path: "address.state", label: "State" },
  { path: "address.postalCode", label: "ZIP code" },
  { path: "business.legalName", label: "Business name" },
  { path: "business.dba", label: "DBA" },
  { path: "business.entityType", label: "Entity type" },
  { path: "business.fein", label: "FEIN" },
  { path: "business.industry", label: "Industry" },
  { path: "business.description", label: "Business description" },
  { path: "business.foundingYear", label: "Year established" },
  { path: "business.annualRevenue", label: "Annual revenue" },
  { path: "coverage.effectiveDate", label: "Effective date" },
  { path: "coverage.expirationDate", label: "Expiration date" },
  { path: "coverage.currentCarrier", label: "Current carrier" },
  { path: "coverage.currentPremium", label: "Current premium" },
  { path: "employment.fullTimeEmployees", label: "Full-time employees" },
  { path: "employment.partTimeEmployees", label: "Part-time employees" },
  { path: "payroll.owners", label: "Owner payroll" },
  { path: "payroll.employees", label: "Employee payroll" },
  { path: "payroll.subcontractors", label: "Subcontractor cost" },
  { path: "building.floors", label: "Building floors" },
  { path: "building.totalSquareFeet", label: "Total square feet" },
  { path: "building.yearBuilt", label: "Year built" },
  { path: "building.constructionType", label: "Construction type" }
];
export const PATH_LABEL = new Map(MAP_PATHS.map(p => [p.path, p.label]));

export async function getAllFieldMaps(): Promise<FieldMaps> {
  const s = await chrome.storage.local.get(FIELDMAP_STORAGE_KEY);
  return (s[FIELDMAP_STORAGE_KEY] as FieldMaps | undefined) ?? {};
}

export async function setAllFieldMaps(maps: FieldMaps): Promise<void> {
  await chrome.storage.local.set({ [FIELDMAP_STORAGE_KEY]: maps });
}

const EXPORT_TYPE = "iacrm-quote-connector-fieldmaps";

/** Identifier-class captured labels a mapping may never pull: no quoting use.
 * DOB and driver's-license labels stay fillable — auto quotes require them
 * (Driver 2 DOB/DL# is the core multi-driver case). Mirrored in
 * public/portal/portal-fill.js (SENSITIVE_SOURCE), enforced at fill AND here
 * at import so a tampered share file sheds them before they reach storage. */
// FEIN/EIN/tax-id is standard commercial-quoting data (Nathan, 2026-11-07) — not
// denied. This import-side check is hygiene; the AUTHORITATIVE enforcement runs
// at fill time against each captured field's RAW label (separators intact), so
// canonicalization differentials ("SSN/TIN" -> "ssntin") cannot slip through.
export const SENSITIVE_LABEL = /(?<![a-z])(ssns?|ss ?num(ber)?|soc(ial)? ?sec(urity)?|itins?|passports?)(?![a-z])/i;

/** Compact-form (letters-only) check catches labels whose separators were
 * stripped during canonicalization ("Tax-ID#" -> "taxid"). Only tokens that
 * cannot occur as substrings of ordinary labels — bare ssn/tin/ein/fein stay
 * word-boundary-only because "busineSS Name", "wriTINg" and "liFE INsurance"
 * contain them compacted. Mirrored in portal-fill.js isSensitiveSource. */
const SENSITIVE_COMPACT = /(socialsecurity|socsec|ssnum|passport)/;

export function isSensitiveLabel(label: string): boolean {
  const spaced = label.toLowerCase();
  return SENSITIVE_LABEL.test(spaced) || SENSITIVE_COMPACT.test(spaced.replace(/[^a-z]/g, ""));
}

export interface FieldMapExport {
  type: typeof EXPORT_TYPE;
  version: 1;
  exportedAt: string;
  maps: FieldMaps;
}

export function buildFieldMapExport(maps: FieldMaps): FieldMapExport {
  return { type: EXPORT_TYPE, version: 1, exportedAt: new Date().toISOString(), maps };
}

export interface FieldMapImport {
  maps: FieldMaps;
  sites: number;
  fields: number;
  /** Entries dropped by validation (unknown paths, malformed origins/keys). */
  dropped: number;
  /** Captured-field targets ("label:…") in the file, for user review before
   * applying: an imported file deciding which captured values land where is
   * the one place a tampered share file could redirect data. */
  labelTargets: string[];
  /** Per-site review summary: every origin the import would add or replace.
   * picks counts taught read-only-text captures — like label targets, an
   * imported file deciding what gets captured needs the user's eyes. */
  perOrigin: { origin: string; fields: number; labels: string[]; picks: number }[];
}

/* Imported pick selectors must fit the grammar OUR cssPath emits — an
 * id-anchored chain of #id / tag:nth-of-type(n) segments. Anything fancier
 * (attribute selectors, :has(), commas) in a share file is dropped. */
const PICK_SEG = String.raw`(?:#(?:[^ >\\]|\\.)+|[a-z][a-z0-9-]*(?::nth-of-type\(\d+\))?)`;
const PICK_SELECTOR = new RegExp(`^pick:${PICK_SEG}(?: > ${PICK_SEG})*$`);

/** Parses and validates a share file. Only https origins, known rule paths
 * and "skip" survive — a tampered or stale file degrades to fewer entries,
 * never to arbitrary data in storage. Throws on files that aren't ours. */
export function parseFieldMapImport(text: string): FieldMapImport {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not a valid JSON file."); }
  const doc = raw as Partial<FieldMapExport>;
  if (doc?.type !== EXPORT_TYPE || typeof doc.maps !== "object" || doc.maps === null) {
    throw new Error("This file is not a Quote Connector field-mapping export.");
  }
  const maps: FieldMaps = {};
  let fields = 0;
  let dropped = 0;
  const labelTargets = new Set<string>();
  const perOrigin: { origin: string; fields: number; labels: string[]; picks: number }[] = [];
  for (const [origin, entries] of Object.entries(doc.maps as Record<string, unknown>)) {
    if (!/^https:\/\/[^/\s]+$/.test(origin) || typeof entries !== "object" || entries === null) { dropped += 1; continue; }
    const clean: Record<string, string> = {};
    const originLabels = new Set<string>();
    let originPicks = 0;
    for (const [key, path] of Object.entries(entries as Record<string, unknown>)) {
      const labelTarget = typeof path === "string" && /^label:[a-z0-9 ]{1,100}$/.test(path) &&
        !isSensitiveLabel(path.slice(6));
      // "pick:<selector>" keys teach read-only-text CAPTURE: selectors run
      // deeper than control keys (hence the longer cap), must fit cssPath's
      // own restricted grammar, and may only target known CRM fields — a
      // "label:" target would invert the data direction
      const pickKey = typeof key === "string" && key.startsWith("pick:");
      if (typeof key !== "string" || !key || key.length > (pickKey ? 500 : 200) ||
          typeof path !== "string" || (path !== "skip" && !labelTarget && !PATH_LABEL.has(path)) ||
          (pickKey && (!PICK_SELECTOR.test(key) || (path !== "skip" && !PATH_LABEL.has(path))))) {
        dropped += 1;
        continue;
      }
      if (labelTarget) { labelTargets.add(path.slice(6)); originLabels.add(path.slice(6)); }
      if (pickKey && path !== "skip") originPicks += 1;
      clean[key] = path;
    }
    if (Object.keys(clean).length) {
      maps[origin] = clean;
      fields += Object.keys(clean).length;
      perOrigin.push({ origin, fields: Object.keys(clean).length, labels: [...originLabels].sort(), picks: originPicks });
    }
  }
  if (!Object.keys(maps).length) throw new Error("The file contained no usable mappings.");
  return { maps, sites: Object.keys(maps).length, fields, dropped, labelTargets: [...labelTargets].sort(), perOrigin };
}
