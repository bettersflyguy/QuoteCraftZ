/** Agent-taught per-site field mappings: storage shape, the mappable CRM
 * paths, and the share-file (export/import) format used to move mappings
 * between business users' extensions. */

export const FIELDMAP_STORAGE_KEY = "portal/fieldMap";

/** { [origin]: { [controlKey]: rulePath | "skip" } } */
export type FieldMaps = Record<string, Record<string, string>>;

/** CRM fields the mapping editor can bind a page control to, grouped by the
 * CRM entity the value lands on. The hierarchy mirrors the commit order:
 * account first, then related contacts, then policy/quote/opportunity;
 * groups marked "risk data" have no CRM column yet and land in the
 * account's captured-data note + knowledge tables. Labels are unique across
 * ALL paths (they double as taught-capture field labels). */
export const MAP_PATHS: { path: string; label: string; group: string }[] = [
  { path: "business.legalName", label: "Business name", group: "Insured business (account)" },
  { path: "business.dba", label: "DBA", group: "Insured business (account)" },
  { path: "business.entityType", label: "Entity type", group: "Insured business (account)" },
  { path: "business.fein", label: "FEIN", group: "Insured business (account)" },
  { path: "business.industry", label: "Industry", group: "Insured business (account)" },
  { path: "business.description", label: "Business description", group: "Insured business (account)" },
  { path: "business.foundingYear", label: "Year established", group: "Insured business (account)" },
  { path: "business.annualRevenue", label: "Annual revenue", group: "Insured business (account)" },
  { path: "contact.firstName", label: "First name", group: "Primary insured (account + contact)" },
  { path: "contact.lastName", label: "Last name", group: "Primary insured (account + contact)" },
  { path: "contact.fullName", label: "Full name", group: "Primary insured (account + contact)" },
  { path: "contact.email", label: "Email", group: "Primary insured (account + contact)" },
  { path: "contact.phone", label: "Phone", group: "Primary insured (account + contact)" },
  { path: "contact.dateOfBirth", label: "Date of birth", group: "Primary insured (account + contact)" },
  { path: "contact.gender", label: "Gender", group: "Primary insured (account + contact)" },
  { path: "contact.maritalStatus", label: "Marital status", group: "Primary insured (account + contact)" },
  { path: "address.street1", label: "Street address", group: "Primary address (account)" },
  { path: "address.street2", label: "Street line 2 / unit", group: "Primary address (account)" },
  { path: "address.city", label: "City", group: "Primary address (account)" },
  { path: "address.state", label: "State", group: "Primary address (account)" },
  { path: "address.postalCode", label: "ZIP code", group: "Primary address (account)" },
  { path: "contacts[].firstName", label: "Related contact first name", group: "Related contacts (all rows)" },
  { path: "contacts[].lastName", label: "Related contact last name", group: "Related contacts (all rows)" },
  { path: "contacts[].fullName", label: "Related contact full name", group: "Related contacts (all rows)" },
  { path: "contacts[].email", label: "Related contact email", group: "Related contacts (all rows)" },
  { path: "contacts[].phone", label: "Related contact phone", group: "Related contacts (all rows)" },
  { path: "contacts[].dateOfBirth", label: "Related contact date of birth", group: "Related contacts (all rows)" },
  { path: "policy.number", label: "Policy number", group: "Policy" },
  { path: "policy.premium", label: "Policy premium", group: "Policy" },
  { path: "coverage.effectiveDate", label: "Effective date", group: "Quote & coverage" },
  { path: "coverage.expirationDate", label: "Expiration date", group: "Quote & coverage" },
  { path: "coverage.currentCarrier", label: "Current carrier", group: "Quote & coverage" },
  { path: "coverage.currentPremium", label: "Current premium", group: "Quote & coverage" },
  { path: "employment.fullTimeEmployees", label: "Full-time employees", group: "Workforce & payroll (risk data)" },
  { path: "employment.partTimeEmployees", label: "Part-time employees", group: "Workforce & payroll (risk data)" },
  { path: "payroll.owners", label: "Owner payroll", group: "Workforce & payroll (risk data)" },
  { path: "payroll.employees", label: "Employee payroll", group: "Workforce & payroll (risk data)" },
  { path: "payroll.subcontractors", label: "Subcontractor cost", group: "Workforce & payroll (risk data)" },
  { path: "building.floors", label: "Building floors", group: "Building (risk data)" },
  { path: "building.totalSquareFeet", label: "Total square feet", group: "Building (risk data)" },
  { path: "building.yearBuilt", label: "Year built", group: "Building (risk data)" },
  { path: "building.constructionType", label: "Construction type", group: "Building (risk data)" },
  { path: "vehicles[].year", label: "Vehicle year", group: "Vehicles (all rows, risk data)" },
  { path: "vehicles[].make", label: "Vehicle make", group: "Vehicles (all rows, risk data)" },
  { path: "vehicles[].model", label: "Vehicle model", group: "Vehicles (all rows, risk data)" },
  { path: "vehicles[].vin", label: "Vehicle VIN", group: "Vehicles (all rows, risk data)" }
];
export const PATH_LABEL = new Map(MAP_PATHS.map(p => [p.path, p.label]));

/** Array relationship ("contacts[].email"): teaching ONE row's cell makes the
 * capture pull that cell from EVERY row of the repeated structure. Array
 * targets are capture-only — a fill can't know which row to write. */
export const isArrayPath = (path: string): boolean => path.includes("[].");

/** Concrete per-row slots an array capture fans out into ("contact2.email",
 * "vehicle5.vin"; contact1 is reserved for the primary insured). */
const SLOT_PATH = /^(?:contact([2-9]|[1-3]\d)\.(firstName|lastName|fullName|email|phone|dateOfBirth)|vehicle([1-9]|[1-3]\d)\.(year|make|model|vin))$/;

/** CRM column targets taught in the capture editor ("crm:account.address1_city",
 * "crm:contacts[].address1_city"): the column list comes live from Dataverse
 * metadata, so the grammar is all that can be checked offline — the commit
 * re-validates every column against the live catalog before writing. */
/** Columns owned by the AMS sync — never written by extension features. */
const AMS_OWNED = new Set(["iacrm_amsexternalid", "iacrm_synctoams", "iacrm_lastsyncon"]);
const CRM_TARGET = /^crm:(account|primarycontact|quote|opportunity|contacts\[\]|policies\[\])\.([a-z][a-z0-9_]{0,99})$/;
/** Concrete per-row forms array teachings fan out into. */
const CRM_ROUTABLE = /^crm:(account|primarycontact|quote|opportunity|contact(?:[2-9]|[1-3]\d)|policy(?:[1-9]|[1-3]\d))\.([a-z][a-z0-9_]{0,99})$/;

export function isCrmTarget(path: string): boolean {
  const m = CRM_TARGET.exec(path);
  // AMS-owned columns and identifier-class columns are never targets
  return Boolean(m && !AMS_OWNED.has(m[2]!) && m[2] !== "governmentid" && !isSensitiveLabel(m[2]!.replace(/_/g, " ")));
}

/** Paths the normalizer may route an explicitly mapped field to: the editor
 * vocabulary (minus array forms, which fan out before normalize sees them)
 * plus the concrete per-row slots and CRM column targets. */
export const isRoutablePath = (path: string): boolean =>
  (PATH_LABEL.has(path) && !isArrayPath(path)) || SLOT_PATH.test(path) ||
  (CRM_ROUTABLE.test(path) && !AMS_OWNED.has(path.split(".")[1]!) && !path.endsWith(".governmentid") &&
    !isSensitiveLabel(path.split(".")[1]!.replace(/_/g, " ")));

/** Valid capture (pick-key) target: a known semantic path or a CRM column. */
export const isCaptureTarget = (path: string): boolean => PATH_LABEL.has(path) || isCrmTarget(path);

/** MAP_PATHS partitioned into ordered entity groups for the editor's
 * target dropdowns. */
export const MAP_PATH_GROUPS: { group: string; paths: { path: string; label: string }[] }[] =
  MAP_PATHS.reduce<{ group: string; paths: { path: string; label: string }[] }[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && last.group === p.group) last.paths.push(p);
    else acc.push({ group: p.group, paths: [p] });
    return acc;
  }, []);

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
 * id-anchored chain of #id / tag:nth-of-type(n) segments. The id branch
 * admits only what CSS.escape produces for one identifier: unescaped
 * ident characters, hex escapes, or a backslash-escaped single char — so
 * selector metacharacters (, [ : ( * .) can never appear unescaped and
 * smuggle in a selector LIST or attribute/pseudo selector. */
const PICK_SEG = String.raw`(?:#(?:[A-Za-z0-9_-]|[ -￿]|\\[0-9a-fA-F]{1,6} ?|\\[^0-9a-fA-F\s])+|[a-z][a-z0-9-]*(?::nth-of-type\(\d+\))?)`;
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
          typeof path !== "string" || (path !== "skip" && !labelTarget && !PATH_LABEL.has(path) && !(pickKey && isCrmTarget(path))) ||
          (pickKey && (!PICK_SELECTOR.test(key) || (path !== "skip" && !isCaptureTarget(path))))) {
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
