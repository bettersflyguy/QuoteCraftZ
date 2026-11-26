/** One table per kind of record, built from captured grid fields (group
 * "Row N"). The Intake grid, the Excel export and the timeline note all use
 * this, so a record shows as ONE row however many pages or sources it was
 * read from.
 *
 * Rules (ADO 3714):
 *  - A field mapped to a record slot ("contact2.firstName",
 *    "crm:contact2.birthdate", "crm:vehicle1.iacrm_acquireddate") belongs to
 *    that record: its row is the slot, its column is the CRM field. The
 *    section it was read under ("Contacts", "Auto: Drivers", "Auto: Vehicles")
 *    and the label the page used ("First Name", "DOB") do not matter.
 *  - Two slots that are provably the same record (the same person, the same
 *    VIN or year/make/model) read in different tables, and that do not disagree
 *    on any value, become one row. Two rows of one table never merge.
 *  - A record that holds nothing that says which record it is (a purchase date
 *    with no vehicle, a date of birth with no name) is never put on another
 *    row: its values show in an "Unmatched" table.
 *  - A field with no record slot that was read in the same table row as
 *    fields of one record is another column of that record.
 *  - Any other field with no record slot keeps its own column in its own
 *    section's table, so nothing is lost. Columns there are told apart by label alone,
 *    ignoring case and punctuation ("First name" and "First Name" are one
 *    column; "BI Amount" and "Collision Amount" stay two).
 *  - Nothing is added up or overwritten: two different values for one cell show
 *    side by side. */
import { ROW_TABLES } from "@/portal/assetTables";
import { usDate } from "@/util/usDate";
import { parsePersonName, personNameKey } from "@/util/personName";
import { canonical, clean, isGridRow } from "./normalize";
import { samePerson } from "./people";
import type { CapturedAppField } from "./types";

export interface RecordTable {
  title: string;
  columns: string[];
  rows: Record<string, string>[];
  /** The "Primary" column marks the row that lands on the primary contact / Address 1. */
  hasPrimary: boolean;
}

export const PRIMARY_COLUMN = "Primary";
export const UNMATCHED_TITLE = "Unmatched";
const UNMATCHED_COLUMNS = ["Record", "Field", "Value", "Read under"];
const JOIN = " / ";

/** Slot record name -> the table title. */
const KIND_TITLE: Record<string, string> = {
  contact: "Contacts",
  address: "Addresses",
  policy: "Policies",
  ...Object.fromEntries(ROW_TABLES.map(a => [a.slot, a.label.replace(/ \(all rows\)$/, "")]))
};
const SINGULAR: Record<string, string> = {
  contact: "Contact",
  address: "Address",
  policy: "Policy",
  ...Object.fromEntries(ROW_TABLES.map(a => [a.slot, (a as { singular?: string }).singular ?? a.slot]))
};

/** Columns that say WHICH record a row is. A kind without an entry has no
 * identity to check, so none of its rows are ever unmatched. */
const IDENTITY: Record<string, readonly string[]> = {
  contact: ["firstname", "lastname", "fullname", "latinfullname"],
  vehicle: ["vin", "year", "make", "model"],
  address: ["line1", "street1", "street", "addressline1", "city", "postalcode", "zip"]
};

/** The same column written two ways. Keys are after punctuation and the
 * "iacrm" prefix are gone. */
const COLUMN_ALIAS: Record<string, string> = {
  dob: "dateofbirth", birthdate: "dateofbirth", birthday: "dateofbirth",
  firstname: "firstname", first: "firstname", givenname: "firstname",
  lastname: "lastname", last: "lastname", surname: "lastname", familyname: "lastname",
  modelyear: "year", vehicleyear: "year", vehiclemake: "make", vehiclemodel: "model", vehiclevin: "vin",
  purchasedate: "acquireddate", dateacquired: "acquireddate", datepurchased: "acquireddate", acquired: "acquireddate",
  emailaddress1: "email", emailaddress: "email",
  mobilephone: "mobilephone", telephone1: "phone"
};

/** Section titles that name a kind's own list: the record word ends the title, give or take a count, a parenthetical or punctuation ("Auto: Drivers", "Drivers (2)"), so "Auto: Driver Tickets" is not one. The tail is written so it cannot backtrack badly. */
/** Page titles have no length limit and only their end says what the list is. */
const TITLE_END = 200;
const titleEnd = (title: string, pattern: RegExp | undefined): boolean => Boolean(pattern?.test(title.slice(-TITLE_END)));

const TITLE_TAIL = String.raw`[\s\d:#.\-\u2013]*(?:\([^()]*\)[\s\d:#.\-\u2013]*)*$`;
const LIST_TITLE: Record<string, RegExp> = {
  contact: new RegExp(String.raw`\b(contacts?|drivers?|people|persons?|insureds?|applicants?)\b` + TITLE_TAIL, "i"),
  vehicle: new RegExp(String.raw`\b(vehicles?|autos?)\b` + TITLE_TAIL, "i"),
  address: new RegExp(String.raw`\baddress(es)?\b` + TITLE_TAIL, "i")
};

/** Lists of things that happen to or belong to a record, never the record's own list. */
const CHILD_LIST = /\b(accidents?|violations?|claims?|losses|loss|incidents?)\b/i;

/** Heading for a column whose label varies between sources. */
const COLUMN_HEADING: Record<string, string> = {
  firstname: "First name", lastname: "Last name", dateofbirth: "Date of birth", acquireddate: "Purchase date",
  vin: "VIN", year: "Year", make: "Make", model: "Model"
};

/** A constant table's own entry only: page text such as "constructor" or
 * "__proto__" must never reach Object.prototype. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export function columnKey(raw: string): string {
  const k = canonical(String(raw).replace(/#/g, " number ").replace(/%/g, " percent ").replace(/\$/g, " dollar "))
    .replace(/[^a-z0-9]/g, "").replace(/^iacrm/, "");
  return lookup(COLUMN_ALIAS, k) ?? k;
}

interface RecordRef { kind: string; slot: number; column: string }

const SLOT = new RegExp(`^(?:crm:|secure:)?(contact|address|policy|${ROW_TABLES.map(a => a.slot).join("|")})(\\d+)\\.(.+)$`);
const PRIMARY = /^(?:contact|crm:primarycontact|secure:primarycontact)\.(.+)$/;

/** The record a mapped path writes to, and the column on it. Timeline-note
 * targets and everything that is not a numbered record return null. */
export function recordRefOf(mapped: string | undefined): RecordRef | null {
  if (!mapped || mapped.startsWith("note:")) return null;
  const primary = PRIMARY.exec(mapped);
  if (primary) return { kind: "contact", slot: 1, column: columnKey(primary[1]!) };
  const m = SLOT.exec(mapped);
  if (!m) return null;
  return { kind: m[1]!, slot: Number(m[2]), column: columnKey(m[3]!) };
}

interface Rec {
  kind: string;
  slot: number;
  cells: Map<string, string[]>;
  /** For the unmatched table: what each value was read under. */
  reads: { column: string; label: string; value: string; section: string }[];
}

const same = (a: string, b: string) => canonical(a) === canonical(b);

function add(list: string[], value: string) {
  if (!list.some(v => same(v, value))) list.push(value);
}

const first = (r: Rec, key: string) => r.cells.get(key)?.[0] ?? "";

function identityOf(r: Rec): { has: boolean; person?: Parameters<typeof samePerson>[0]; vehicle?: string } {
  const keys = lookup(IDENTITY, r.kind);
  if (!keys) return { has: true };
  const has = keys.some(k => clean(first(r, k)));
  if (r.kind === "contact") {
    const letters = personNameKey;
    let fn = first(r, "firstname"), ln = first(r, "lastname");
    if (!fn && !ln) {
      const latin = first(r, "latinfullname");
      const parts = parsePersonName(latin || first(r, "fullname"), latin ? "two-surnames" : "auto");
      fn = parts.firstName; ln = parts.lastName;
    }
    if (!fn && !ln) return { has };
    return { has, person: { first: letters(fn), last: letters(ln), dob: first(r, "dateofbirth").replace(/\D/g, ""), email: first(r, "email").toLowerCase() } };
  }
  if (r.kind === "vehicle") {
    const vin = clean(first(r, "vin")).toUpperCase();
    if (vin) return { has, vehicle: `vin:${vin}` };
    const ymm = ["year", "make", "model"].map(k => canonical(first(r, k)));
    return { has, ...(ymm.every(Boolean) ? { vehicle: `ymm:${ymm.join("|")}` } : {}) };
  }
  return { has };
}

const sameRecord = (a: Rec, b: Rec): boolean => {
  if (a.kind !== b.kind) return false;
  // two rows of one table are two records, even with the same name or make
  if (a.reads.some(x => b.reads.some(y => x.section === y.section))) return false;
  const x = identityOf(a), y = identityOf(b);
  if (x.person && y.person) return samePerson(x.person, y.person);
  return Boolean(x.vehicle && y.vehicle && x.vehicle === y.vehicle);
};

/** Two records may be one row only when they agree wherever both have a value. */
const agree = (a: Rec, b: Rec): boolean => {
  for (const [key, values] of a.cells) {
    const other = b.cells.get(key);
    if (other && !values.some(v => other.some(o => same(v, o)))) return false;
  }
  return true;
};

function absorb(into: Rec, from: Rec) {
  for (const [key, values] of from.cells) {
    const list = into.cells.get(key) ?? into.cells.set(key, []).get(key)!;
    for (const v of values) add(list, v);
  }
  for (const r of from.reads) if (!into.reads.some(x => x.column === r.column && x.label === r.label && x.value === r.value && x.section === r.section)) into.reads.push(r);
}

interface Built { id: string; title: string; columns: string[]; keys: string[]; rows: { primary: boolean; slot: number; cells: Map<string, string[]> }[]; hasPrimary: boolean }

/** A column heading unique within its table. */
function headings(keys: string[], labels: Map<string, string>, reserved: string[] = []): string[] {
  const used = new Set<string>(reserved);
  return keys.map(k => {
    let h = lookup(COLUMN_HEADING, k) ?? labels.get(k) ?? k;
    if (used.has(h)) h = `${h} (${k})`;
    used.add(h);
    return h;
  });
}

/** Page text has no length limit, and the tables key their maps by it: very long
 * strings make those lookups collide and stall the panel. Section titles
 * and labels are cut to about this many characters, keeping the start and the
 * end (the end is what names a list) and a tag of the whole text, so two long texts
 * that differ only in the middle stay two, before anything is grouped. */
const MAX_TEXT = 1000;
/** Two 32-bit FNV-1a passes with different seeds, over the whole text: cheap, and
 * two texts that differ anywhere get different tags in practice. */
function tag(text: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + i | 0;
  }
  return `${text.length.toString(36)}-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
/** Short enough to key a Map, and never the same for two different long texts. The tag sits in the middle so the end still names the list. */
const clamp = (text: string): string =>
  text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT / 2 - 20)}...${tag(text)}...${text.slice(-(MAX_TEXT / 2 - 20))}`;

/** The tables for a set of captured fields. Fields that are not grid rows are
 * ignored: the caller shows them as single values. */
export function recordTables(input: CapturedAppField[]): RecordTable[] {
  // (a row name must be "Row N" to be a grid row, so it cannot be long)
  const fields = input.map(f => f.section.length > MAX_TEXT || f.label.length > MAX_TEXT
    ? { ...f, section: clamp(f.section), label: clamp(f.label) } : f);
  const records = new Map<string, Rec>();
  const labels = new Map<string, Map<string, string>>(); // table id -> column key -> first label seen
  const columnOrder = new Map<string, string[]>();
  const tableOrder: string[] = [];
  const title = new Map<string, string>();
  const plain = new Map<string, Map<string, Map<string, string[]>>>(); // section -> row -> column -> values
  const note = (id: string, key: string, label: string) => {
    const l = labels.get(id) ?? labels.set(id, new Map()).get(id)!;
    if (!l.has(key)) l.set(key, label);
    const o = columnOrder.get(id) ?? columnOrder.set(id, []).get(id)!;
    if (!o.includes(key)) o.push(key);
  };
  const seen = (id: string, t: string) => { if (!tableOrder.includes(id)) { tableOrder.push(id); title.set(id, t); } };

  // A row read from one table that writes to exactly one record: the fields
  // beside the mapped ones (unmapped, or mapped to something that is not a
  // record) are that record's other columns, not a table of their own. Only
  // for a table that IS the record's list: its rows point at different
  // records (one row per record) and it is titled for them ("Contacts",
  // "Auto: Drivers") or came from the data service. A list of something
  // else that merely points at a record (accidents, each with a Driver) stays
  // its own table, one row per entry.
  const rowKey = (f: CapturedAppField) => `${f.section}\u0000${f.group}`;
  const rowRecords = new Map<string, Set<string>>();
  const rowFields = new Map<string, CapturedAppField[]>();
  const sectionRows = new Map<string, Map<string, Set<string>>>(); // section -> record -> groups
  const sectionGroups = new Map<string, Set<string>>();
  const fromService = new Set<string>();
  for (const f of fields) {
    if (!isGridRow(f)) continue;
    (rowFields.get(rowKey(f)) ?? rowFields.set(rowKey(f), []).get(rowKey(f))!).push(f);
    (sectionGroups.get(f.section) ?? sectionGroups.set(f.section, new Set()).get(f.section)!).add(f.group);
    const ref = recordRefOf(f.mapped);
    if (!ref) continue;
    const record = `${ref.kind}:${ref.slot}`;
    (rowRecords.get(rowKey(f)) ?? rowRecords.set(rowKey(f), new Set()).get(rowKey(f))!).add(record);
    const recs = sectionRows.get(f.section) ?? sectionRows.set(f.section, new Map()).get(f.section)!;
    (recs.get(record) ?? recs.set(record, new Set()).get(record)!).add(f.group);
    if (f.source === "dataservice") fromService.add(f.section);
  }
  /** The table IS this kind's own list: one row per record (no record spans
   * two rows, no row holds two records), and it says so by its title or by
   * being the data service's. A list of something else that only points at a
   * record (accidents, violations, tickets) is never it, whatever it is called. */
  const listCache = new Map<string, boolean>();
  const isRecordList = (section: string, kind: string): boolean => {
    const cacheKey = `${kind}\u0000${section}`;
    const hit = listCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const answer = isRecordListUncached(section, kind);
    listCache.set(cacheKey, answer);
    return answer;
  };
  const isRecordListUncached = (section: string, kind: string): boolean => {
    const recs = sectionRows.get(section);
    if (!recs || [...recs.values()].some(groups => groups.size > 1)) return false;
    if ([...(sectionGroups.get(section) ?? [])].some(g => (rowRecords.get(`${section}\u0000${g}`)?.size ?? 0) > 1)) return false;
    if (titleEnd(section, CHILD_LIST)) return false;
    return fromService.has(section) || titleEnd(section, lookup(LIST_TITLE, kind));
  };
  /** A mapped field stays in its list's row when that list is not the
   * record's own and the row holds anything besides that record's fields
   * (or the record spans several rows). A row of nothing but the record's own
   * fields is a fragment of it and merges, whatever its section is called. */
  const staysInList = (f: CapturedAppField, ref: RecordRef): boolean => {
    if (isRecordList(f.section, ref.kind)) return false;
    const record = `${ref.kind}:${ref.slot}`;
    if ((sectionRows.get(f.section)?.get(record)?.size ?? 0) > 1 || titleEnd(f.section, CHILD_LIST)) return true;
    return (rowFields.get(rowKey(f)) ?? []).some(x => {
      const other = recordRefOf(x.mapped);
      return other?.kind !== ref.kind || other.slot !== ref.slot;
    });
  };
  for (const f of fields) {
    if (!isGridRow(f)) continue;
    const value = usDate(f.value);
    if (!clean(value)) continue;
    let ref = recordRefOf(f.mapped);
    if (ref) {
      if (staysInList(f, ref)) ref = null;
    } else if (!f.mapped?.startsWith("note:")) {
      // beside a record's mapped fields in that record's own list: another column of it
      const owners = rowRecords.get(rowKey(f));
      const [kind, slot] = owners?.size === 1 ? [...owners][0]!.split(":") : [];
      if (kind && isRecordList(f.section, kind)) {
        ref = { kind, slot: Number(slot), column: columnKey(f.label) || canonical(f.label) };
      }
    }
    if (ref) {
      const id = `record:${ref.kind}`;
      seen(id, lookup(KIND_TITLE, ref.kind) ?? ref.kind);
      note(id, ref.column, f.label);
      const key = `${ref.kind}:${ref.slot}`;
      const rec = records.get(key) ?? records.set(key, { kind: ref.kind, slot: ref.slot, cells: new Map(), reads: [] }).get(key)!;
      add(rec.cells.get(ref.column) ?? rec.cells.set(ref.column, []).get(ref.column)!, value);
      if (!rec.reads.some(r => r.column === ref.column && r.label === f.label && r.value === value && r.section === f.section)) {
        rec.reads.push({ column: ref.column, label: f.label, value, section: f.section });
      }
      continue;
    }
    const id = `section:${f.section}`;
    seen(id, f.section);
    const key = columnKey(f.label) || canonical(f.label);
    note(id, key, f.label);
    const rows = plain.get(f.section) ?? plain.set(f.section, new Map()).get(f.section)!;
    const row = rows.get(f.group) ?? rows.set(f.group, new Map()).get(f.group)!;
    add(row.get(key) ?? row.set(key, []).get(key)!, value);
  }

  // slots that are provably one record become one row (lowest slot keeps the row)
  const ordered = [...records.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.slot - b.slot);
  const gone = new Set<Rec>();
  for (const a of ordered) {
    if (gone.has(a)) continue;
    for (const b of ordered) {
      if (b === a || gone.has(b) || b.slot < a.slot || b.kind !== a.kind) continue;
      if (b.slot !== a.slot && sameRecord(a, b) && agree(a, b)) { absorb(a, b); gone.add(b); }
    }
  }
  const kept = ordered.filter(r => !gone.has(r));
  const anchored = kept.filter(r => identityOf(r).has);
  const orphans = kept.filter(r => !identityOf(r).has);

  const built: Built[] = [];
  for (const id of tableOrder) {
    if (id.startsWith("record:")) {
      const kind = id.slice("record:".length);
      const rows = anchored.filter(r => r.kind === kind).sort((a, b) => a.slot - b.slot);
      if (!rows.length) continue;
      const keys = (columnOrder.get(id) ?? []).filter(k => rows.some(r => r.cells.has(k)));
      const rowsOut = rows.map(r => ({ primary: r.slot === 1 && (kind === "contact" || kind === "address"), slot: r.slot, cells: r.cells }));
      // the Primary flag's heading is taken only in a table that has one
      built.push({
        id, title: title.get(id)!, keys, hasPrimary: false, rows: rowsOut,
        columns: headings(keys, labels.get(id) ?? new Map(), rowsOut.some(r => r.primary) ? [PRIMARY_COLUMN] : [])
      });
    } else {
      const section = id.slice("section:".length);
      const rows = [...(plain.get(section) ?? new Map<string, Map<string, string[]>>()).values()];
      const keys = columnOrder.get(id) ?? [];
      built.push({ id, title: title.get(id)!, keys, columns: headings(keys, labels.get(id) ?? new Map()), hasPrimary: false, rows: rows.map(cells => ({ primary: false, slot: 0, cells })) });
    }
  }

  const out: RecordTable[] = built.map(t => {
    const hasPrimary = t.rows.some(r => r.primary);
    const columns = hasPrimary ? [PRIMARY_COLUMN, ...t.columns] : t.columns;
    return {
      title: t.title, columns, hasPrimary,
      // own data properties (a label of "__proto__" is a column like any other)
      rows: t.rows.map(r => Object.fromEntries([
        ...(hasPrimary ? [[PRIMARY_COLUMN, r.primary ? "Yes" : ""]] : []),
        ...t.keys.map((k, i) => [t.columns[i]!, (r.cells.get(k) ?? []).join(JOIN)])
      ]) as Record<string, string>)
    };
  });

  if (orphans.length) {
    out.push({
      title: UNMATCHED_TITLE, columns: UNMATCHED_COLUMNS, hasPrimary: false,
      rows: orphans.flatMap(r => r.reads.map(read => ({
        Record: r.kind === "contact" && r.slot === 1 ? "Primary contact" : `${lookup(SINGULAR, r.kind) ?? r.kind} ${r.slot}`,
        Field: read.label, Value: read.value, "Read under": read.section
      })))
    });
  }
  return out;
}
