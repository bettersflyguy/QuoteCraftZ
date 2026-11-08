/** Secured pass-through (SSN, government ID, license number, any
 * field-secured CRM column). Rules this module enforces:
 *  - a captured secured value lives ONLY in chrome.storage.session (memory,
 *    never on disk, unreadable by content scripts) under its own key, never
 *    in the capture, so the Excel export, timeline notes, data tables and
 *    peek labels can't see it; it goes from there to its secured CRM column
 *  - a fill reads secured values live from the CRM with the agent's own
 *    token (field security decides), only for the controls mapped to them,
 *    and hands them only to the frame holding those controls
 *  - the panel only ever sees a masked form ("•••• 6789") */
import type { CrmEnvironment } from "@/crm/environments";
import { isConcreteSecureTarget } from "./fieldMaps";

export const SECURE_PENDING_KEY = "secure/pending";

export type SecureValues = Record<string, string>;

export async function getPendingSecure(): Promise<SecureValues> {
  const s = await chrome.storage.session.get(SECURE_PENDING_KEY);
  return (s[SECURE_PENDING_KEY] as SecureValues | undefined) ?? {};
}

/** Holds freshly captured secured values (later captures of a path win). */
export async function addPendingSecure(entries: { path: string; value: string }[]): Promise<number> {
  const valid = entries.filter(e => isConcreteSecureTarget(e.path) && typeof e.value === "string" && e.value.trim());
  if (!valid.length) return 0;
  const next = { ...(await getPendingSecure()) };
  for (const e of valid) next[e.path] = e.value.trim().slice(0, 100);
  await chrome.storage.session.set({ [SECURE_PENDING_KEY]: next });
  return valid.length;
}

export async function clearPendingSecure(paths?: string[]): Promise<void> {
  if (!paths) { await chrome.storage.session.remove(SECURE_PENDING_KEY); return; }
  const next = { ...(await getPendingSecure()) };
  for (const p of paths) delete next[p];
  await chrome.storage.session.set({ [SECURE_PENDING_KEY]: next });
}

/** "123-45-6789" -> "•••• 6789". Short values show no digits at all. */
export function maskSecure(value: string): string {
  const v = value.replace(/\s+/g, "");
  return v.length >= 6 ? `•••• ${v.slice(-4)}` : "••••";
}

export interface SecureRecords {
  accountId: string | null;
  primaryContactId: string | null;
  /** Related (non-primary) contacts in slot order: index 0 = contact2. */
  relatedContactIds: string[];
}

type DvJson = <T>(env: CrmEnvironment, path: string) => Promise<T>;

const GUID = /^[0-9a-f-]{36}$/i;
const COLUMN = /^[a-z][a-z0-9_]{0,99}$/;

/** The one ordering of related contacts every CRM-side reader uses, so
 * "Related contact 2" means the same person in a pull, a fill and a load. */
export const RELATED_CONTACT_ORDER = "createdon asc";

const canon = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Related-contact slot -> CRM contact. When the capture names the person
 * in a slot, ONLY a name match counts (an identifier must never land on the
 * wrong person); with no names held, slots follow the CRM's own order. */
export function alignRelatedContacts(
  related: { id: string; firstName: string; lastName: string }[],
  slotNames: Record<number, { firstName: string; lastName: string }>
): string[] {
  const named = Object.keys(slotNames).map(Number).filter(n => n >= 2);
  if (!named.length) return related.map(r => r.id);
  const out: string[] = [];
  for (let n = 2; n <= Math.max(...named); n += 1) {
    const want = slotNames[n];
    const hit = want && (want.firstName || want.lastName)
      ? related.filter(r => canon(r.firstName) === canon(want.firstName) && canon(r.lastName) === canon(want.lastName))
      : [];
    out.push(hit.length === 1 ? hit[0]!.id : "");
  }
  return out;
}

/** Resolves the account, primary contact and ordered related contacts of a
 * linked CRM insured (an account or a contact pick). */
export async function resolveSecureRecords(
  env: CrmEnvironment, link: { kind: "account" | "contact"; id: string }, dvJson: DvJson,
  slotNames: Record<number, { firstName: string; lastName: string }> = {}
): Promise<SecureRecords> {
  if (!GUID.test(link.id)) return { accountId: null, primaryContactId: null, relatedContactIds: [] };
  let accountId: string | null = null;
  let primaryContactId: string | null = null;
  if (link.kind === "account") {
    accountId = link.id;
    const a = await dvJson<Record<string, unknown>>(env, `accounts(${link.id})?$select=accountid,_primarycontactid_value`);
    primaryContactId = typeof a["_primarycontactid_value"] === "string" ? a["_primarycontactid_value"] as string : null;
  } else {
    const c = await dvJson<Record<string, unknown>>(env, `contacts(${link.id})?$select=contactid,_parentcustomerid_value`);
    accountId = typeof c["_parentcustomerid_value"] === "string" ? c["_parentcustomerid_value"] as string : null;
    primaryContactId = link.id;
    if (accountId) {
      const a = await dvJson<Record<string, unknown>>(env, `accounts(${accountId})?$select=accountid,_primarycontactid_value`).catch(() => null);
      const p = a?.["_primarycontactid_value"];
      if (typeof p === "string" && p) primaryContactId = p;
    }
  }
  let relatedContactIds: string[] = [];
  if (accountId) {
    const { value } = await dvJson<{ value: { contactid: string; firstname?: string | null; lastname?: string | null }[] }>(env,
      `contacts?$select=contactid,firstname,lastname&$filter=_parentcustomerid_value eq ${accountId} and statecode eq 0&$orderby=${RELATED_CONTACT_ORDER}&$top=40`);
    const related = value
      .filter(v => v.contactid !== primaryContactId)
      .map(v => ({ id: v.contactid, firstName: v.firstname ?? "", lastName: v.lastname ?? "" }));
    relatedContactIds = alignRelatedContacts(related, slotNames);
  }
  return { accountId, primaryContactId, relatedContactIds };
}

/** The names the capture holds per related-contact slot (contact2..N). */
export function slotNamesOf(normalized: Record<string, Record<string, unknown>> | undefined): Record<number, { firstName: string; lastName: string }> {
  const out: Record<number, { firstName: string; lastName: string }> = {};
  for (const [group, values] of Object.entries(normalized ?? {})) {
    const m = /^contact(\d+)$/.exec(group);
    if (!m || Number(m[1]) < 2) continue;
    const s = (k: string) => (typeof values[k] === "string" ? (values[k] as string).trim() : "");
    let firstName = s("firstName");
    let lastName = s("lastName");
    if (!firstName && !lastName && s("fullName")) {
      const parts = s("fullName").split(/\s+/);
      firstName = parts[0] ?? "";
      lastName = parts.length > 1 ? parts[parts.length - 1]! : "";
    }
    if (firstName || lastName) out[Number(m[1])] = { firstName, lastName };
  }
  return out;
}

/** The record a concrete secured path lands on / reads from. */
export function secureRecordOf(path: string, recs: SecureRecords): { set: "accounts" | "contacts"; id: string; column: string } | null {
  const m = /^secure:(account|primarycontact|contact(\d+))\.([a-z][a-z0-9_]{0,99})$/.exec(path);
  if (!m) return null;
  const column = m[3]!;
  if (m[1] === "account") return recs.accountId ? { set: "accounts", id: recs.accountId, column } : null;
  if (m[1] === "primarycontact") return recs.primaryContactId ? { set: "contacts", id: recs.primaryContactId, column } : null;
  const id = recs.relatedContactIds[Number(m[2]) - 2];
  return id ? { set: "contacts", id, column } : null;
}

/** Live read of the secured columns behind `paths`. Columns the agent's
 * field security can't read come back empty and simply don't fill. */
export async function readSecureValues(env: CrmEnvironment, recs: SecureRecords, paths: string[], dvJson: DvJson): Promise<SecureValues> {
  const byRecord = new Map<string, { set: string; id: string; cols: Map<string, string[]> }>();
  for (const path of paths) {
    const r = secureRecordOf(path, recs);
    if (!r || !COLUMN.test(r.column)) continue;
    const k = `${r.set}:${r.id}`;
    const entry = byRecord.get(k) ?? { set: r.set, id: r.id, cols: new Map<string, string[]>() };
    entry.cols.set(r.column, [...(entry.cols.get(r.column) ?? []), path]);
    byRecord.set(k, entry);
  }
  const out: SecureValues = {};
  for (const { set, id, cols } of byRecord.values()) {
    let rec: Record<string, unknown>;
    try { rec = await dvJson<Record<string, unknown>>(env, `${set}(${id})?$select=${[...cols.keys()].join(",")}`); } catch { continue; }
    for (const [col, ps] of cols) {
      const v = rec[col];
      if (typeof v === "string" && v.trim()) for (const p of ps) out[p] = v.trim();
    }
  }
  return out;
}
