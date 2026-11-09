/** One-for-one CHOICE mappings: a source's selection text ("Bachelors
 * Degree" on a carrier form, "Bachelors" from EZLynx) bound to the exact CRM
 * choice value (contact.educationcode = 3). Used both ways:
 *  - capture/load: the source text becomes that CRM choice
 *  - fill: the CRM choice becomes that source text (the form's own option)
 * Scoped per source (a page origin, or "dataservice:<name>") because every
 * site words its options differently; keyed per CRM COLUMN ("contact.
 * educationcode"), so every row of a list shares one mapping. */
import { canonical } from "@/boldpenguin/normalize";

export const OPTIONMAP_STORAGE_KEY = "portal/optionMap";

/** { [scope]: { [table.column]: { [source text]: CRM choice value } } } */
export type OptionMaps = Record<string, Record<string, Record<string, number>>>;
export type ColumnOptionMap = Record<string, number>;
export interface ChoiceOption { value: number; label: string }

export const dataServiceScope = (name: string): string => `dataservice:${name}`;

const ENTITY_TABLE: Record<string, string> = {
  account: "account", primarycontact: "contact", contacts: "contact", contact: "contact",
  policies: "iacrm_policy", policy: "iacrm_policy", quote: "iacrm_quote", opportunity: "opportunity",
  addresses: "customeraddress", address: "customeraddress"
};

/** "crm:contact3.educationcode" / "crm:contacts[].educationcode" /
 * "crm:primarycontact.educationcode" -> "contact.educationcode". */
export function columnKeyOf(target: string): string | null {
  const m = /^crm:([a-z]+?)\d*(?:\[\])?\.([a-z][a-z0-9_]{0,99})$/.exec(target);
  const table = m ? ENTITY_TABLE[m[1]!] : undefined;
  return m && table ? `${table}.${m[2]}` : null;
}

/** Catalog entity key for a target ("crm:contact3.x" -> "contacts"). */
export function entityKeyOf(target: string): string | null {
  const m = /^crm:([a-z]+?)(\d*)(?:\[\])?\./.exec(target);
  if (!m) return null;
  if (m[2]) return m[1] === "contact" ? "contacts" : m[1] === "policy" ? "policies" : m[1] === "address" ? "addresses" : null;
  return m[1]!;
}

/** Best automatic guess for one source option: exact canonical label, then
 * a unique prefix or containment match either way. Null when ambiguous. */
export function autoMatchOption(source: string, options: ChoiceOption[]): number | null {
  const s = canonical(source);
  if (!s) return null;
  const exact = options.filter(o => canonical(o.label) === s);
  if (exact.length === 1) return exact[0]!.value;
  const loose = options.filter(o => {
    const l = canonical(o.label);
    return l && (l.startsWith(s) || s.startsWith(l) || (s.length >= 4 && l.includes(s)) || (l.length >= 4 && s.includes(l)));
  });
  return loose.length === 1 ? loose[0]!.value : null;
}

/** The CRM choice a source text means: the agent's mapping first, then the
 * automatic guess. */
export function toCrmChoice(source: string, map: ColumnOptionMap | undefined, options: ChoiceOption[]): ChoiceOption | null {
  const s = canonical(source);
  const mapped = map ? Object.entries(map).find(([k]) => canonical(k) === s)?.[1] : undefined;
  const value = mapped ?? autoMatchOption(source, options);
  return value == null ? null : options.find(o => o.value === value) ?? null;
}

/** The source text a CRM choice (by label or value) maps to on this source,
 * or null when the agent hasn't mapped it (the filler then matches the CRM
 * label against the form's options itself). */
export function toSourceText(crm: string, map: ColumnOptionMap | undefined, options: ChoiceOption[]): string | null {
  if (!map) return null;
  const c = canonical(crm);
  const option = options.find(o => canonical(o.label) === c || String(o.value) === crm.trim());
  if (!option) return null;
  const hits = Object.entries(map).filter(([, v]) => v === option.value).map(([k]) => k);
  return hits[0] ?? null;
}

export async function getOptionMaps(): Promise<OptionMaps> {
  const s = await chrome.storage.local.get(OPTIONMAP_STORAGE_KEY);
  return (s[OPTIONMAP_STORAGE_KEY] as OptionMaps | undefined) ?? {};
}

/** Replaces one source's mappings for the given columns (empty = cleared). */
export async function setOptionMaps(scope: string, columns: Record<string, ColumnOptionMap>): Promise<void> {
  const all = await getOptionMaps();
  const next = { ...(all[scope] ?? {}) };
  for (const [col, map] of Object.entries(columns)) {
    const clean = sanitizeColumnMap(map);
    if (Object.keys(clean).length) next[col] = clean; else delete next[col];
  }
  if (Object.keys(next).length) all[scope] = next; else delete all[scope];
  await chrome.storage.local.set({ [OPTIONMAP_STORAGE_KEY]: all });
}

/** Share-file / storage hygiene: short source texts, integer choice values. */
export function sanitizeColumnMap(map: unknown): ColumnOptionMap {
  const out: ColumnOptionMap = {};
  if (typeof map !== "object" || map === null) return out;
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    const key = String(k).replace(/\s+/g, " ").trim().slice(0, 100);
    if (key && typeof v === "number" && Number.isInteger(v)) out[key] = v;
  }
  return out;
}

export const COLUMN_KEY = /^[a-z][a-z0-9_]{0,60}\.[a-z][a-z0-9_]{0,99}$/;
