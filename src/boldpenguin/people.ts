/** People across sources. Every source numbers its people its own way
 * (EZLynx: applicant first, then contacts in entry order; an AMS contacts
 * list: alphabetical, primary anywhere). A capture's person slots (1 = the
 * primary insured, N = related contact N) are matched by WHO the person
 * is, never by row position: an incoming person goes to the held person
 * with the same name (spelling-tolerant, DOB as a check), to the primary
 * when the page flags them primary (or they are the primary insured), and
 * otherwise to a new slot. */
import { canonical, clean } from "./normalize";
import type { CapturedAppField, NormalizedApplication } from "./types";

const PRIMARY = /^(contact|crm:primarycontact|secure:primarycontact)\.(.+)$/;
const RELATED = /^(contact|crm:contact|secure:contact)(\d+)\.(.+)$/;

/** The person slot a mapped path writes to (1 = the primary insured). */
export function slotOf(path: string | undefined): number | null {
  if (!path) return null;
  if (path === "note:contact") return 1;
  const note = /^note:contact(\d+)$/.exec(path);
  if (note) return Number(note[1]);
  if (PRIMARY.test(path)) return 1;
  const m = RELATED.exec(path);
  return m ? Number(m[2]) : null;
}

/** The same path for another person slot. */
export function withSlot(path: string, slot: number): string {
  if (path === "note:contact" || /^note:contact\d+$/.test(path)) return slot === 1 ? "note:contact" : `note:contact${slot}`;
  const p = PRIMARY.exec(path);
  const r = RELATED.exec(path);
  const family = p ? (p[1] === "contact" ? "semantic" : p[1]!.startsWith("crm") ? "crm" : "secure")
    : r ? (r[1] === "contact" ? "semantic" : r[1]!.startsWith("crm") ? "crm" : "secure") : null;
  const rest = p ? p[2]! : r ? r[3]! : "";
  if (!family) return path;
  if (slot === 1) return family === "semantic" ? `contact.${rest}` : `${family}:primarycontact.${rest}`;
  return family === "semantic" ? `contact${slot}.${rest}` : `${family}:contact${slot}.${rest}`;
}

interface Person { first: string; last: string; dob: string; email: string }

const letters = (s: string) => canonical(s).replace(/[^a-z]/g, "");

/** A person from {firstName,lastName,fullName,dateOfBirth,email}-ish values
 * ("Dittrich, Tracey" reads as last, first). */
function person(get: (keys: string[]) => string): Person | null {
  let first = get(["firstName", "firstname"]);
  let last = get(["lastName", "lastname"]);
  if (!first && !last) {
    const full = get(["fullName", "fullname"]);
    if (full.includes(",")) { const [l, f] = full.split(","); last = clean(l); first = clean(f).split(" ")[0] ?? ""; }
    else { const parts = full.split(" ").filter(Boolean); first = parts[0] ?? ""; last = parts.length > 1 ? parts[parts.length - 1]! : ""; }
  }
  if (!first && !last) return null;
  return { first: letters(first), last: letters(last), dob: get(["dateOfBirth", "birthdate"]).replace(/\D/g, ""), email: get(["email", "emailaddress1"]).toLowerCase() };
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** Same person? Same email, or same last name and a first name that is the
 * same, a short form of it, or a spelling away (Tracey/Tracy,
 * Alaxander/Alexander). Different birth dates are never the same person. */
export function samePerson(a: Person, b: Person): boolean {
  const dobA = a.dob.length >= 6 ? a.dob : "";
  const dobB = b.dob.length >= 6 ? b.dob : "";
  if (dobA && dobB && dobA !== dobB && !sameDate(dobA, dobB)) return false;
  if (a.email && b.email && a.email === b.email) return true;
  if (a.last && b.last && a.last !== b.last && !(Math.min(a.last.length, b.last.length) >= 5 && editDistance(a.last, b.last) <= 1)) return false;
  if (!a.first || !b.first) return Boolean(a.last && a.last === b.last && dobA && dobA === dobB);
  if (a.first === b.first) return true;
  const [s, l] = a.first.length <= b.first.length ? [a.first, b.first] : [b.first, a.first];
  if (s.length >= 3 && l.startsWith(s)) return true;
  return Math.min(a.first.length, b.first.length) >= 4 && editDistance(a.first, b.first) <= 2;
}

/** 03111972 vs 19720311: the same date written two ways. */
function sameDate(a: string, b: string): boolean {
  const iso = (d: string) => (d.length === 8 && /^(19|20)/.test(d) ? d : d.length === 8 ? `${d.slice(4)}${d.slice(0, 4)}` : d);
  return iso(a) === iso(b);
}

/** The people a normalized capture already holds, by slot. */
function heldPeople(n: NormalizedApplication | null): Map<number, Person> {
  const out = new Map<number, Person>();
  if (!n) return out;
  const groupsFor = (slot: number) => slot === 1 ? ["contact", "crm:primarycontact"] : [`contact${slot}`, `crm:contact${slot}`];
  const slots = new Set<number>([1]);
  for (const k of Object.keys(n)) { const m = /^(?:crm:)?contact(\d+)$/.exec(k); if (m) slots.add(Number(m[1])); }
  for (const slot of slots) {
    const groups = groupsFor(slot).map(g => (n[g] ?? {}) as Record<string, unknown>);
    const p = person(keys => {
      for (const g of groups) for (const k of keys) { const v = g[k]; if (typeof v === "string" && clean(v)) return clean(v); }
      return "";
    });
    if (p) out.set(slot, p);
  }
  return out;
}

const YES = /^(yes|y|true|checked|on|1|x|✓|✔)$/i;
const PRIMARY_ROLE = /^(owner|named insured|primary|primary insured|self|applicant|insured|policyholder|policy holder)$/i;

/** Rewrites incoming fields' person slots to match the people already held
 * (and the page's own primary flags). Returns the fields and the slot map
 * applied (incoming slot -> held slot), for secured values riding along. */
export function alignPeople(held: NormalizedApplication | null, incoming: CapturedAppField[]): { fields: CapturedAppField[]; slotMap: Map<number, number> } {
  const roster = heldPeople(held);
  // the incoming page's own people, by the slot their fields write to
  const bySlot = new Map<number, CapturedAppField[]>();
  for (const f of incoming) { const s = slotOf(f.mapped); if (s !== null) (bySlot.get(s) ?? bySlot.set(s, []).get(s)!).push(f); }
  const incomingPerson = (slot: number) => {
    const fs = bySlot.get(slot) ?? [];
    return person(keys => {
      for (const f of fs) {
        const key = (f.mapped ?? "").split(".").pop()!;
        if (keys.includes(key) && clean(f.value)) return clean(f.value);
      }
      return "";
    });
  };
  if (!roster.has(1)) { const p = incomingPerson(1); if (p) roster.set(1, p); }
  // a row the page flags as the primary (a "Primary" tick, type "Owner")
  const flagged = new Set<number>();
  const rows = new Map<string, CapturedAppField[]>();
  for (const f of incoming) if (/^Row \d+$/.test(f.group ?? "")) (rows.get(`${f.section}|${f.group}`) ?? rows.set(`${f.section}|${f.group}`, []).get(`${f.section}|${f.group}`)!).push(f);
  for (const fs of rows.values()) {
    const flag = fs.some(f => (/^primary\b/i.test(f.label) && YES.test(clean(f.value))) ||
      (/^(type|role|relationship|contact type)$/i.test(f.label) && PRIMARY_ROLE.test(clean(f.value))));
    const slot = fs.map(f => slotOf(f.mapped)).find(s => s !== null && s !== undefined);
    if (flag && slot && slot > 1) flagged.add(slot);
  }
  const slotMap = new Map<number, number>();
  const taken = new Set<number>(roster.keys());
  const assigned = new Set<number>();
  const nextFree = () => { let n = 2; while (taken.has(n) || assigned.has(n)) n += 1; return n; };
  for (const s of [...bySlot.keys()].filter(s => s > 1).sort((a, b) => a - b)) {
    const p = incomingPerson(s);
    const primary = roster.get(1);
    let target: number | null = null;
    if (p && primary && samePerson(p, primary)) target = 1;
    else if (flagged.has(s) && (!primary || (p && samePerson(p, primary)))) target = 1;
    if (target === null && p) {
      for (const [k, q] of roster) if (k > 1 && !assigned.has(k) && samePerson(p, q)) { target = k; break; }
    }
    // someone new takes the next free contact: no gaps when a card before
    // them turned out to be the primary
    if (target === null) target = nextFree();
    slotMap.set(s, target);
    if (target > 1) assigned.add(target);
  }
  const fields = incoming.map(f => {
    const s = slotOf(f.mapped);
    const to = s !== null ? slotMap.get(s) : undefined;
    return to !== undefined && to !== s ? { ...f, mapped: withSlot(f.mapped!, to) } : f;
  });
  return { fields, slotMap };
}
