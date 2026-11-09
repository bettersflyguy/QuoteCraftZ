/** Agent-taught per-site field mappings: storage shape, the mappable CRM
 * paths, and the share-file (export/import) format used to move mappings
 * between business users' extensions. */

import { COLUMN_KEY, sanitizeColumnMap, type OptionMaps } from "./optionMaps";

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
  { path: "contacts[].firstName", label: "Related contact first name", group: "Contacts (all rows)" },
  { path: "contacts[].lastName", label: "Related contact last name", group: "Contacts (all rows)" },
  { path: "contacts[].fullName", label: "Related contact full name", group: "Contacts (all rows)" },
  { path: "contacts[].email", label: "Related contact email", group: "Contacts (all rows)" },
  { path: "contacts[].phone", label: "Related contact phone", group: "Contacts (all rows)" },
  { path: "contacts[].dateOfBirth", label: "Related contact date of birth", group: "Contacts (all rows)" },
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
 * capture pull that cell from EVERY row of the repeated structure. A form
 * control (one input) maps to ONE row instead: see toRowTarget. */
export const isArrayPath = (path: string): boolean => path.includes("[].");

/** Concrete per-row slots an array capture fans out into ("contact2.email",
 * "vehicle5.vin"; contact1 is reserved for the primary insured). */
const SLOT_PATH = /^(?:contact([2-9]|[1-3]\d)\.(firstName|lastName|fullName|email|phone|dateOfBirth)|vehicle([1-9]|[1-3]\d)\.(year|make|model|vin))$/;

/** Rows a form control can address ("Driver 2" = related contact row 1). */
export const ARRAY_ROW_MAX = 10;

/** Per array: the slot prefix and the slot number of row 1 (related
 * contacts start at 2 because contact1 is the primary insured). */
const ROW_SLOTS: Record<string, { slot: string; start: number }> = {
  contacts: { slot: "contact", start: 2 },
  vehicles: { slot: "vehicle", start: 1 },
  "crm:contacts": { slot: "crm:contact", start: 2 },
  "crm:policies": { slot: "crm:policy", start: 1 },
  /* the applicant's addresses: row N is address number N on their contact
   * (1-3 are its Address 1-3, 4+ its More Addresses) */
  "crm:addresses": { slot: "crm:address", start: 1 },
  "secure:contacts": { slot: "secure:contact", start: 2 }
};

/** "contacts[].email" + row 2 -> "contact3.email" (the one-row target a
 * form control fills from and captures into). */
export function toRowTarget(arrayPath: string, row: number): string | null {
  const m = /^((?:crm:|secure:)?[a-z]+)\[\]\.(.+)$/.exec(arrayPath);
  const cfg = m ? ROW_SLOTS[m[1]!] : undefined;
  if (!m || !cfg || !Number.isInteger(row) || row < 1 || row > ARRAY_ROW_MAX) return null;
  return `${cfg.slot}${cfg.start + row - 1}.${m[2]}`;
}

/** Inverse of toRowTarget: "contact3.email" -> {contacts[].email, row 2}. */
export function rowTargetOf(path: string): { arrayPath: string; row: number } | null {
  for (const [array, cfg] of Object.entries(ROW_SLOTS)) {
    const m = new RegExp(`^${cfg.slot.replace(":", "\\:")}(\\d+)\\.(.+)$`).exec(path);
    if (!m) continue;
    const row = Number(m[1]) - cfg.start + 1;
    if (row < 1 || row > ARRAY_ROW_MAX) return null;
    return { arrayPath: `${array}[].${m[2]}`, row };
  }
  return null;
}

/** CRM column targets taught in the capture editor ("crm:account.address1_city",
 * "crm:contacts[].address1_city"): the column list comes live from Dataverse
 * metadata, so the grammar is all that can be checked offline - the commit
 * re-validates every column against the live catalog before writing. */
/** Columns owned by the AMS sync - never written by extension features. */
const AMS_OWNED = new Set(["iacrm_amsexternalid", "iacrm_synctoams", "iacrm_lastsyncon"]);
const CRM_TARGET = /^crm:(account|primarycontact|quote|opportunity|contacts\[\]|policies\[\]|addresses\[\])\.([a-z][a-z0-9_]{0,99})$/;
/** Concrete per-row forms array teachings fan out into. */
const CRM_ROUTABLE = /^crm:(account|primarycontact|quote|opportunity|contact(?:[2-9]|[1-3]\d)|policy(?:[1-9]|[1-3]\d)|address(?:[1-9]|[1-3]\d))\.([a-z][a-z0-9_]{0,99})$/;

/** Identifier-class CRM columns (SSN, government ID, driver's license
 * NUMBERS - "iacrm_driverslicense" too): secured pass-through only, never a
 * plain capture target. A license STATE / status / class is not one. */
export function isIdentifierColumn(column: string): boolean {
  return column === "governmentid" || isSensitiveLabel(column.replace(/_/g, " ")) ||
    (/licen[cs]e(number|no|num)?$/.test(column) && !/state|status|class|expir|date|type/.test(column));
}

/** A mapping saved with an identifier column as a plain CRM target (before
 * those were refused) as its secured pass-through form, so it keeps working
 * without ever holding the value in the capture. */
export function securedIfIdentifier(target: string): string {
  const m = /^crm:(account|primarycontact|contacts\[\]|contact\d+)\.([a-z0-9_]+)$/.exec(target);
  return m && isIdentifierColumn(m[2]!) ? `secure:${m[1]}.${m[2]}` : target;
}

export function isCrmTarget(path: string): boolean {
  const m = CRM_TARGET.exec(path);
  // AMS-owned columns and identifier-class columns are never targets
  return Boolean(m && !AMS_OWNED.has(m[2]!) && !isIdentifierColumn(m[2]!));
}

/** Paths the normalizer may route an explicitly mapped field to: the editor
 * vocabulary (minus array forms, which fan out before normalize sees them)
 * plus the concrete per-row slots and CRM column targets. */
export const isRoutablePath = (path: string): boolean =>
  (PATH_LABEL.has(path) && !isArrayPath(path)) || SLOT_PATH.test(path) ||
  (CRM_ROUTABLE.test(path) && !AMS_OWNED.has(path.split(".")[1]!) && !isIdentifierColumn(path.split(".")[1]!));

/** SECURED targets: identifier-class CRM columns (SSN, government ID,
 * driver's license number, any field-secured column). Pass-through only:
 * a captured value goes straight to a session-memory holding area and on to
 * its CRM column at load; a fill reads it live from the CRM (field security
 * decides who may) into the one control mapped to it. Never stored in the
 * capture, the Excel export, timeline notes, peek labels or share files. */
const SECURE_TARGET = /^secure:(account|primarycontact|contacts\[\]|contact(?:[2-9]|[1-3]\d))\.([a-z][a-z0-9_]{0,99})$/;
export const SECURE_PREFIX = "secure:";
export function isSecureTarget(path: string | undefined | null): boolean {
  const m = path ? SECURE_TARGET.exec(path) : null;
  return Boolean(m && !AMS_OWNED.has(m[2]!));
}
/** Concrete (one-record) secured target - what a fill or a held value uses. */
export const isConcreteSecureTarget = (path: string): boolean => isSecureTarget(path) && !isArrayPath(path);

/** Everything a form control can fill from: semantic paths (one row), row
 * slots, concrete CRM columns, captured labels and concrete secured columns. */
export const isFillTarget = (path: string): boolean =>
  isRoutablePath(path) || /^label:[a-z0-9 ]{1,100}$/.test(path) || isConcreteSecureTarget(path);

/** Capture target for data with no CRM column: the value is gathered into
 * the insured's timeline note (one organized entry per source site). On a
 * grid cell it takes the whole column, every row. */
export const NOTE_TARGET = "note";

/** Which record's timeline a note teaching lands on ("note" = the insured
 * account, kept for mappings saved before the record choice existed). */
export type NoteRecord = "account" | "contact" | "relatedcontact" | "opportunity" | "quote" | "policy";
export const NOTE_TARGETS: { value: string; record: NoteRecord; label: string }[] = [
  { value: "note", record: "account", label: "Notes: Insured (account)" },
  { value: "note:contact", record: "contact", label: "Notes: Primary contact" },
  // each person's values on THEIR own timeline (resolved per row: the
  // primary insured to note:contact, others to note:contact2, note:contact3 ...)
  { value: "note:contacts[]", record: "relatedcontact", label: "Notes: Each contact's own timeline" },
  { value: "note:opportunity", record: "opportunity", label: "Notes: Opportunity" },
  { value: "note:quote", record: "quote", label: "Notes: Quote" },
  { value: "note:policy", record: "policy", label: "Notes: Policy" }
];
/** A row of a list whose values land on the PRIMARY record: the primary
 * contact (the applicant's row of a Contacts list) or the applicant's
 * Address 1 (the primary address row of an Addresses list). */
export const isPrimaryTarget = (path: string | undefined): boolean =>
  /^(contact|crm:primarycontact|secure:primarycontact|crm:address1)\.|^note:contact$/.test(path ?? "");

/** One related contact's note, resolved from a row ("note:contact3" = the
 * second related contact; contact1 is the primary insured). */
const RELATED_NOTE = /^note:contact([2-9]|[1-3]\d)$/;
export const isNoteTarget = (path: string | undefined): boolean =>
  NOTE_TARGETS.some(t => t.value === path) || RELATED_NOTE.test(path ?? "");
export const noteRecordOf = (path: string | undefined): NoteRecord | null =>
  RELATED_NOTE.test(path ?? "") ? "relatedcontact" : NOTE_TARGETS.find(t => t.value === path)?.record ?? null;
/** The related-contact slot a resolved note names (note:contact3 -> 3). */
export const noteSlotOf = (path: string | undefined): number | null => {
  const m = RELATED_NOTE.exec(path ?? "");
  return m ? Number(m[1]) : null;
};
/** Display label for any note target, resolved rows included. */
export const noteLabelOf = (path: string | undefined): string => {
  const slot = noteSlotOf(path);
  if (slot) return `Notes: Related contact ${slot - 1}`;
  return NOTE_TARGETS.find(t => t.value === path)?.label ?? "Notes";
};
/** Valid capture (pick-key) target: a known semantic path, a CRM column,
 * or a timeline note. */
export const isCaptureTarget = (path: string): boolean =>
  PATH_LABEL.has(path) || isCrmTarget(path) || isNoteTarget(path) || isSecureTarget(path);

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
 * DOB and driver's-license labels stay fillable - auto quotes require them
 * (Driver 2 DOB/DL# is the core multi-driver case). Mirrored in
 * public/portal/portal-fill.js (SENSITIVE_SOURCE), enforced at fill AND here
 * at import so a tampered share file sheds them before they reach storage. */
// FEIN/EIN/tax-id is standard commercial-quoting data (Nathan, 2026-11-07) - not
// denied. This import-side check is hygiene; the AUTHORITATIVE enforcement runs
// at fill time against each captured field's RAW label (separators intact), so
// canonicalization differentials ("SSN/TIN" -> "ssntin") cannot slip through.
export const SENSITIVE_LABEL = /(?<![a-z])(ssns?|ss ?num(ber)?|soc(ial)? ?sec(urity)?|itins?|passports?)(?![a-z])/i;

/** Compact-form (letters-only) check catches labels whose separators were
 * stripped during canonicalization ("Tax-ID#" -> "taxid"). Only tokens that
 * cannot occur as substrings of ordinary labels - bare ssn/tin/ein/fein stay
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
  /** One-for-one choice mappings per site ({origin: {table.column: {text: value}}}),
   * and per data service ("dataservice:ezlynx"). */
  options?: OptionMaps;
  /** Data-service field mappings ({ezlynx: {fieldId: target}}). */
  dataServices?: Record<string, Record<string, string>>;
}

/** A data-service field's target: not mapped, a semantic path (one row or
 * all rows), a CRM column (record or all rows) or a timeline note. Never a
 * secured target (each agent maps those locally). */
export const isDataServiceTarget = (t: string): boolean =>
  t === "" || PATH_LABEL.has(t) || isRoutablePath(t) || isCrmTarget(t) || isNoteTarget(t);

export function buildFieldMapExport(
  maps: FieldMaps, options?: OptionMaps, dataServices?: Record<string, Record<string, string>>
): FieldMapExport {
  const ds = Object.fromEntries(Object.entries(dataServices ?? {})
    .map(([s, m]) => [s, Object.fromEntries(Object.entries(m).filter(([, t]) => isDataServiceTarget(t)))] as const)
    .filter(([, m]) => Object.keys(m).length));
  // choice mappings travel with the sites and data services in the file
  const opts = options ? Object.fromEntries(Object.entries(options)
    .filter(([o]) => o in maps || (o.startsWith("dataservice:") && o.slice(12) in ds))) : {};
  return {
    type: EXPORT_TYPE, version: 1, exportedAt: new Date().toISOString(), maps: withoutSecured(maps),
    ...(Object.keys(opts).length ? { options: opts } : {}),
    ...(Object.keys(ds).length ? { dataServices: ds } : {})
  };
}

/** Validated data-service mappings from a share file. */
function parseDataServices(raw: unknown): { maps: Record<string, Record<string, string>>; dropped: number } {
  const maps: Record<string, Record<string, string>> = {};
  let dropped = 0;
  if (typeof raw !== "object" || raw === null) return { maps, dropped };
  for (const [source, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9]{0,30}$/.test(source) || typeof entries !== "object" || entries === null) { dropped += 1; continue; }
    const kept: Record<string, string> = {};
    for (const [id, t] of Object.entries(entries as Record<string, unknown>)) {
      if (/^[a-z][a-zA-Z]{0,30}\.[a-zA-Z0-9]{1,60}$/.test(id) && typeof t === "string" && isDataServiceTarget(t)) kept[id] = t;
      else dropped += 1;
    }
    if (Object.keys(kept).length) maps[source] = kept;
  }
  return { maps, dropped };
}

/** Validated choice mappings from a share file, for the origins it maps. */
function parseOptionMaps(raw: unknown, origins: Set<string>): OptionMaps {
  const out: OptionMaps = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [origin, cols] of Object.entries(raw as Record<string, unknown>)) {
    if (!origins.has(origin) || typeof cols !== "object" || cols === null) continue;
    const kept: Record<string, Record<string, number>> = {};
    for (const [col, map] of Object.entries(cols as Record<string, unknown>)) {
      if (!COLUMN_KEY.test(col)) continue;
      const clean = sanitizeColumnMap(map);
      if (Object.keys(clean).length) kept[col] = clean;
    }
    if (Object.keys(kept).length) out[origin] = kept;
  }
  return out;
}

export interface FieldMapImport {
  maps: FieldMaps;
  /** Choice mappings for the imported sites and data services. */
  options: OptionMaps;
  /** Data-service field mappings ({ezlynx: {fieldId: target}}). */
  dataServices: Record<string, Record<string, string>>;
  sites: number;
  fields: number;
  /** Entries dropped by validation (unknown paths, malformed origins/keys). */
  dropped: number;
  /** Of those, secured mappings (never imported; map them locally). */
  secured: number;
  /** Captured-field targets ("label:…") in the file, for user review before
   * applying: an imported file deciding which captured values land where is
   * the one place a tampered share file could redirect data. */
  labelTargets: string[];
  /** Per-site review summary: every origin the import would add or replace.
   * picks counts taught read-only-text captures - like label targets, an
   * imported file deciding what gets captured needs the user's eyes. */
  perOrigin: { origin: string; fields: number; labels: string[]; picks: number }[];
}

/* Imported pick selectors must fit the grammar OUR cssPath emits - an
 * id-anchored chain of #id / tag:nth-of-type(n) segments. The id branch
 * admits only what CSS.escape produces for one identifier: unescaped
 * ident characters, hex escapes, or a backslash-escaped single char - so
 * selector metacharacters (, [ : ( * .) can never appear unescaped and
 * smuggle in a selector LIST or attribute/pseudo selector. */
const PICK_SEG = String.raw`(?:#(?:[A-Za-z0-9_-]|[ -￿]|\\[0-9a-fA-F]{1,6} ?|\\[^0-9a-fA-F\s])+|[a-z][a-z0-9-]*(?::nth-of-type\(\d+\))?)`;
const PICK_SELECTOR = new RegExp(`^pick:${PICK_SEG}(?: > ${PICK_SEG})*$`);
/** "field:<page>|<section>><label>" with page and section optional
 * ("field:details|other address>city"): lowercase words only. The section
 * names a sub-section whose fields share labels with a twin section. */
export const FIELD_KEY = /^field:(?:[a-z0-9 ]{1,40}\|)?(?:[a-z0-9 ]{1,40}>)?[a-z0-9 ]{1,80}$/;
/** A sub-section control's label key across every section of its kind
 * ("other address" City -> "field:other address>city", which a list target
 * reads from Primary, Other and Mailing Address alike). Null outside one. */
export function familyKeyOf(r: { fieldLabel?: string; section?: string }): { key: string; label: string } | null {
  const field = (r.fieldLabel ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
  const section = (r.section ?? "").slice(0, 40);
  if (!field || !section) return null;
  const kind = section.split(" ").pop()!;
  return { key: `field:${section}>${field}`, label: `${r.fieldLabel!.replace(/^[*\s]+|[:*\s]+$/g, "")} (every ${kind})` };
}

/** A scoped label's scope against an element's scopes (every titled box
 * around it, nearest first, and "#<page heading>"): "" = anywhere,
 * "applicant info" = inside that box, "*address" = inside a box of that
 * kind, "#contact" = on the page headed "Contact", "a/b" = all of them.
 * Same rule as the page scripts' scopeMatches. */
export function scopeMatches(want: string, scopes: string[]): boolean {
  if (!want) return true;
  return want.split("/").every(part => {
    if (part.startsWith("#")) return scopes.includes(part);
    if (part.startsWith("*")) return scopes.some(s => !s.startsWith("#") && s.split(" ").pop() === part.slice(1));
    return scopes.includes(part);
  });
}

/** Parses a labelled-field key: [page, "section>label" or "label"]. */
export const FIELD_KEY_PARTS = /^field:(?:([a-z0-9 ]{1,40})\|)?((?:[a-z0-9 ]{1,40}>)?[a-z0-9 ]{1,80})$/;

/** A labelled-field key for a page step and a field label; the label may
 * carry its section ("primary address>city"). */
export function fieldKeyOf(page: string, label: string): string {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const at = label.indexOf(">");
  const scoped = at < 0 ? k(label) : `${k(label.slice(0, at))}>${k(label.slice(at + 1))}`;
  return `field:${page ? `${k(page)}|` : ""}${scoped}`;
}

/** Parses and validates a share file. Only https origins, known rule paths
 * and "skip" survive - a tampered or stale file degrades to fewer entries,
 * never to arbitrary data in storage. Throws on files that aren't ours. */
export function parseFieldMapImport(text: string, allowEmpty = false): FieldMapImport {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not a valid JSON file."); }
  const doc = raw as Partial<FieldMapExport>;
  if (doc?.type !== EXPORT_TYPE || typeof doc.maps !== "object" || doc.maps === null) {
    throw new Error("This file is not a QuoteCraftZ field-mapping export.");
  }
  const maps: FieldMaps = {};
  let fields = 0;
  let dropped = 0;
  let secured = 0;
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
      // own restricted grammar, and may only target known CRM fields - a
      // "label:" target would invert the data direction
      // "field:<page>|<label>" keys teach capture by label, like a pick
      const fieldKey = typeof key === "string" && key.startsWith("field:");
      const pickKey = typeof key === "string" && (key.startsWith("pick:") || fieldKey);
      // secured targets never travel in share files: each agent maps them on
      // their own machine, so a tampered file can't aim an SSN at a field
      if (typeof path === "string" && path.startsWith(SECURE_PREFIX)) { dropped += 1; secured += 1; continue; }
      if (typeof key !== "string" || !key || key.length > (pickKey ? 500 : 200) ||
          typeof path !== "string" ||
          (path !== "skip" && !labelTarget && !PATH_LABEL.has(path) &&
            !(pickKey ? isCaptureTarget(path) : isRoutablePath(path) || isNoteTarget(path))) ||
          (pickKey && (!(fieldKey ? FIELD_KEY.test(key) : PICK_SELECTOR.test(key)) || (path !== "skip" && !isCaptureTarget(path))))) {
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
  const ds = parseDataServices((doc as { dataServices?: unknown }).dataServices);
  if (!allowEmpty && !Object.keys(maps).length && !Object.keys(ds.maps).length) throw new Error("The file contained no usable mappings.");
  const options = parseOptionMaps((doc as { options?: unknown }).options,
    new Set([...Object.keys(maps), ...Object.keys(ds.maps).map(s => `dataservice:${s}`)]));
  return {
    maps, options, dataServices: ds.maps, sites: Object.keys(maps).length, fields, dropped: dropped + ds.dropped, secured,
    labelTargets: [...labelTargets].sort(), perOrigin
  };
}

/** A share file never carries secured mappings (see parseFieldMapImport). */
export function withoutSecured(maps: FieldMaps): FieldMaps {
  const out: FieldMaps = {};
  for (const [origin, entries] of Object.entries(maps)) {
    const kept = Object.fromEntries(Object.entries(entries).filter(([, v]) => !v.startsWith(SECURE_PREFIX)));
    if (Object.keys(kept).length) out[origin] = kept;
  }
  return out;
}
