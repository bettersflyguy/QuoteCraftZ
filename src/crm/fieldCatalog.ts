/** Live CRM column catalog for capture mappings: every core, writable column
 * of each entity a capture can land on, read from Dataverse metadata (so new
 * solution columns appear without an extension release). System, GUID,
 * relational (lookup/owner/customer), calculated, secured and identifier-
 * class columns are excluded. The same catalog gates the commit: a captured
 * value is only ever written to a column present here, coerced to its type. */
import { canonical, clean } from "@/boldpenguin/normalize";
import { isSensitiveLabel } from "@/portal/fieldMaps";
import type { CrmEnvironment } from "./environments";

export interface CatalogColumn {
  name: string;
  label: string;
  type: "String" | "Memo" | "Integer" | "BigInt" | "Decimal" | "Double" | "Money" | "DateTime" | "Boolean" | "Picklist";
  maxLength?: number;
  dateOnly?: boolean;
  options?: { value: number; label: string }[];
}

export interface CatalogEntity {
  /** Target key used in mappings: "crm:<key>.<column>". */
  key: "account" | "primarycontact" | "contacts" | "policies" | "quote" | "opportunity";
  logical: string;
  set: string;
  label: string;
  array: boolean;
  columns: CatalogColumn[];
  /** Identifier-class text columns (SSN, government ID, license number, any
   * field-secured column): mappable only as "secure:" pass-through targets. */
  secured?: CatalogColumn[];
}

/** Entities whose identifier columns are offered as secured targets. */
export const SECURE_ENTITY_KEYS = new Set(["account", "primarycontact", "contacts"]);

export interface FieldCatalog { envId: string; fetchedAt: number; entities: CatalogEntity[] }

/** Hierarchy order: the account first, its one-to-one primary contact, then
 * the arrays and per-load records. */
export const CATALOG_ENTITIES: Omit<CatalogEntity, "columns">[] = [
  { key: "account", logical: "account", set: "accounts", label: "Insured (account)", array: false },
  { key: "primarycontact", logical: "contact", set: "contacts", label: "Primary contact", array: false },
  { key: "contacts", logical: "contact", set: "contacts", label: "Related contacts (all rows)", array: true },
  { key: "policies", logical: "iacrm_policy", set: "iacrm_policies", label: "Policies (all rows)", array: true },
  { key: "quote", logical: "iacrm_quote", set: "iacrm_quotes", label: "Quote", array: false },
  { key: "opportunity", logical: "opportunity", set: "opportunities", label: "Opportunity", array: false }
];

const WRITABLE_TYPES = new Set(["String", "Memo", "Integer", "BigInt", "Decimal", "Double", "Money", "DateTime", "Boolean", "Picklist"]);

/** Plumbing columns that pass the type/validity filters but are never agent
 * data. iacrm_amsexternalid is reserved for the AMS sync (standing rule). */
const DENY = new Set([
  "iacrm_amsexternalid", "overriddencreatedon", "importsequencenumber", "timezoneruleversionnumber",
  "utcconversiontimezonecode", "versionnumber", "exchangerate", "traversedpath", "processid", "stageid",
  "entityimage", "entityimageid", "address1_addresstypecode", "address2_addresstypecode", "address3_addresstypecode",
  "address1_shippingmethodcode", "address2_shippingmethodcode", "address3_shippingmethodcode",
  "address1_freighttermscode", "address2_freighttermscode", "address3_freighttermscode",
  "address1_utcoffset", "address2_utcoffset", "address3_utcoffset", "address1_latitude", "address1_longitude",
  "address2_latitude", "address2_longitude", "address3_latitude", "address3_longitude",
  "merged", "participatesinworkflow", "isprivate", "onholdtime", "lastonholdtime", "lastusedincampaign",
  "teamsfollowed", "slaid", "slainvokedid", "stepname", "subscriptionid", "msdyn_gdproptout",
  // identifier-class (national ID / SSN store)
  "governmentid",
  // AMS sync state is owned by the sync - writing synctoams could trigger a push
  "iacrm_synctoams", "iacrm_lastsyncon",
  // social/portal plumbing, never agent data
  "primarysatoriid", "primarytwitterid"
]);
/** Power Pages portal plumbing columns. */
const DENY_PREFIX = /^(adx_|mspp_)/;

export interface RawAttribute {
  LogicalName: string;
  AttributeType: string;
  AttributeOf?: string | null;
  IsValidForCreate?: boolean;
  IsValidForUpdate?: boolean;
  IsSecured?: boolean;
  IsPrimaryId?: boolean;
  DisplayName?: { UserLocalizedLabel?: { Label?: string } | null } | null;
}

/** Pure column filter over raw attribute metadata. */
export function filterColumns(raw: RawAttribute[]): CatalogColumn[] {
  const out: CatalogColumn[] = [];
  for (const a of raw) {
    const name = a.LogicalName;
    const label = clean(a.DisplayName?.UserLocalizedLabel?.Label ?? "");
    if (!name || !label || !WRITABLE_TYPES.has(a.AttributeType)) continue;
    if (a.AttributeOf) continue;                       // yomi/name shadow columns
    if (a.IsPrimaryId || a.IsSecured) continue;
    if (a.IsValidForCreate === false && a.IsValidForUpdate === false) continue;
    if (DENY.has(name) || DENY_PREFIX.test(name) || name.endsWith("_base")) continue;
    if (isSensitiveLabel(label) || isSensitiveLabel(name.replace(/_/g, " "))) continue;
    if (isLicenseNumber(name, label)) continue;           // secured channel only
    out.push({ name, label, type: a.AttributeType as CatalogColumn["type"] });
  }
  return out.sort((x, y) => x.label.localeCompare(y.label));
}

/** A driver's license NUMBER column (not its state, status or class). */
function isLicenseNumber(name: string, label: string): boolean {
  return /licen[cs]e(number|no|num)?$/.test(name) && !/state|status|class|expir|date|type/i.test(label);
}

/** The identifier-class text columns offered ONLY as secured pass-through
 * targets: field-secured columns, government ID, SSN-labelled columns and
 * license numbers. Plumbing (portal password hashes) and AMS-sync columns
 * stay out entirely. */
export function securedColumns(raw: RawAttribute[]): CatalogColumn[] {
  const out: CatalogColumn[] = [];
  for (const a of raw) {
    const name = a.LogicalName;
    const label = clean(a.DisplayName?.UserLocalizedLabel?.Label ?? "");
    if (!name || !label || (a.AttributeType !== "String" && a.AttributeType !== "Memo")) continue;
    if (a.AttributeOf || a.IsPrimaryId) continue;
    if (a.IsValidForCreate === false && a.IsValidForUpdate === false) continue;
    if (DENY_PREFIX.test(name) || name === "iacrm_amsexternalid" || /password|hash/i.test(name)) continue;
    const identifier = a.IsSecured === true || name === "governmentid" ||
      isSensitiveLabel(label) || isSensitiveLabel(name.replace(/_/g, " ")) || isLicenseNumber(name, label);
    if (identifier) out.push({ name, label, type: a.AttributeType as CatalogColumn["type"] });
  }
  return out.sort((x, y) => x.label.localeCompare(y.label));
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isoDate(value: string): string | null {
  const v = clean(value);
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})(?!\d)/);
  return iso ? iso[1]! : null;
}

/** Captured text -> the column's Web API value, or undefined when the text
 * isn't a valid value for that type (never write a guess). */
export function coerce(col: CatalogColumn, raw: string): unknown {
  const v = clean(raw);
  if (!v) return undefined;
  switch (col.type) {
    case "String":
    case "Memo": {
      // an email-format column only takes an email
      if (/email/i.test(col.name) && !EMAIL_RX.test(v)) return undefined;
      return v.slice(0, col.maxLength ?? (col.type === "Memo" ? 4000 : 100));
    }
    case "Integer":
    case "BigInt": {
      const m = v.replace(/,/g, "").match(/-?\d+/);
      return m ? Number(m[0]) : undefined;
    }
    case "Decimal":
    case "Double":
    case "Money": {
      const m = v.replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d+)?)/);
      if (!m) return undefined;
      const n = Number(m[1]);
      return v.trim().startsWith("-") ? -n : n;
    }
    case "DateTime":
      return isoDate(v) ?? undefined;
    case "Boolean":
      if (/^(yes|y|true|checked|on|1)$/i.test(v)) return true;
      if (/^(no|n|false|unchecked|off|0)$/i.test(v)) return false;
      return undefined;
    case "Picklist": {
      const want = canonical(v);
      return col.options?.find(o => canonical(o.label) === want)?.value;
    }
  }
}

/** Coerces a captured {column: text} group against an entity's catalog,
 * dropping unknown columns and values that don't fit the column type. */
export function coerceGroup(entity: CatalogEntity | undefined, values: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!entity || !values) return out;
  const byName = new Map(entity.columns.map(c => [c.name, c]));
  for (const [name, raw] of Object.entries(values)) {
    const col = byName.get(name);
    if (!col || typeof raw !== "string") continue;
    const v = coerce(col, raw);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

export interface CatalogApi {
  dvJson: <T>(env: CrmEnvironment, path: string) => Promise<T>;
}

async function fetchColumns(env: CrmEnvironment, logical: string, api: CatalogApi): Promise<{ columns: CatalogColumn[]; secured: CatalogColumn[] }> {
  const base = `EntityDefinitions(LogicalName='${logical}')/Attributes`;
  const { value } = await api.dvJson<{ value: RawAttribute[] }>(env,
    `${base}?$select=LogicalName,AttributeType,AttributeOf,IsValidForCreate,IsValidForUpdate,IsSecured,IsPrimaryId,DisplayName`);
  const secured = securedColumns(value);
  const cols = filterColumns(value);
  const byName = new Map(cols.map(c => [c.name, c]));
  // type details are enrichments: a failed probe leaves defaults, never
  // drops the column list
  try {
    const s = await api.dvJson<{ value: { LogicalName: string; MaxLength?: number }[] }>(env,
      `${base}/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,MaxLength`);
    for (const a of s.value) { const c = byName.get(a.LogicalName); if (c && a.MaxLength) c.maxLength = a.MaxLength; }
  } catch { /* default lengths */ }
  try {
    const m = await api.dvJson<{ value: { LogicalName: string; MaxLength?: number }[] }>(env,
      `${base}/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,MaxLength`);
    for (const a of m.value) { const c = byName.get(a.LogicalName); if (c && a.MaxLength) c.maxLength = a.MaxLength; }
  } catch { /* default lengths */ }
  try {
    const d = await api.dvJson<{ value: { LogicalName: string; Format?: string }[] }>(env,
      `${base}/Microsoft.Dynamics.CRM.DateTimeAttributeMetadata?$select=LogicalName,Format`);
    for (const a of d.value) { const c = byName.get(a.LogicalName); if (c) c.dateOnly = a.Format === "DateOnly"; }
  } catch { /* date-only default */ }
  try {
    type Opt = { Value: number; Label?: { UserLocalizedLabel?: { Label?: string } | null } };
    const p = await api.dvJson<{ value: { LogicalName: string; OptionSet?: { Options?: Opt[] } | null; GlobalOptionSet?: { Options?: Opt[] } | null }[] }>(env,
      `${base}/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)`);
    for (const a of p.value) {
      const c = byName.get(a.LogicalName);
      const opts = a.OptionSet?.Options ?? a.GlobalOptionSet?.Options ?? [];
      if (c) c.options = opts.map(o => ({ value: o.Value, label: clean(o.Label?.UserLocalizedLabel?.Label ?? "") })).filter(o => o.label);
    }
  } catch { /* picklists without options can't be coerced; they simply won't write */ }
  // a picklist with no resolvable options can never take a value - hide it
  return { columns: cols.filter(c => c.type !== "Picklist" || (c.options?.length ?? 0) > 0), secured };
}

export async function buildFieldCatalog(env: CrmEnvironment, api: CatalogApi): Promise<FieldCatalog> {
  const byLogical = new Map<string, Promise<{ columns: CatalogColumn[]; secured: CatalogColumn[] }>>();
  const entities: CatalogEntity[] = [];
  for (const e of CATALOG_ENTITIES) {
    if (!byLogical.has(e.logical)) byLogical.set(e.logical, fetchColumns(env, e.logical, api).catch(() => ({ columns: [], secured: [] })));
    const { columns, secured } = await byLogical.get(e.logical)!;
    if (columns.length) entities.push({ ...e, columns, ...(SECURE_ENTITY_KEYS.has(e.key) && secured.length ? { secured } : {}) });
  }
  return { envId: env.id, fetchedAt: Date.now(), entities };
}

// v2: entities carry their secured (pass-through) columns
const CACHE_PREFIX = "crm/fieldCatalog/v2/";
const TTL_MS = 24 * 60 * 60 * 1000;

/** Cached per environment for a day - metadata changes only with a solution
 * import; `refresh` forces a re-read. */
export async function getFieldCatalog(env: CrmEnvironment, api: CatalogApi, refresh = false): Promise<FieldCatalog> {
  const key = CACHE_PREFIX + env.id;
  if (!refresh) {
    const s = await chrome.storage.local.get(key);
    const hit = s[key] as FieldCatalog | undefined;
    if (hit && Date.now() - hit.fetchedAt < TTL_MS && hit.entities.length) return hit;
  }
  const fresh = await buildFieldCatalog(env, api);
  if (fresh.entities.length) await chrome.storage.local.set({ [key]: fresh });
  return fresh;
}

/** "crm:account.address1_city" -> its catalog display label ("Insured
 * (account): Address 1: City"). */
export function catalogLabel(catalog: FieldCatalog | null, target: string): string | null {
  const m = /^(crm|secure):([a-z]+?)(\d*)(?:\[\])?\.([a-z0-9_]+)$/.exec(target);
  if (!m || !catalog) return null;
  const secure = m[1] === "secure";
  // row slots ("crm:contact3", "secure:contact2") name their array entity
  const key = m[3] ? (m[2] === "contact" ? "contacts" : m[2] === "policy" ? "policies" : m[2]) : m[2];
  const entity = catalog.entities.find(e => e.key === key);
  const col = (secure ? entity?.secured : entity?.columns)?.find(c => c.name === m[4]);
  if (!entity || !col) return null;
  const base = m[3]
    ? `${key === "contacts" ? "Related contact" : "Policy"} ${Number(m[3]) - (key === "contacts" ? 1 : 0)}`
    : entity.label.replace(/ \(all rows\)$/, "");
  return `${secure ? "Secured: " : ""}${base}: ${col.label}`;
}
