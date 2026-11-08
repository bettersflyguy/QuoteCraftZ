import { usDate } from "@/util/usDate";
/** A held capture laid out as workbook tabs, mirroring the panel: single
 * values, every array as its own table, and the "Non Mapped Timeline
 * Entries" (with the record each lands on). */
import type { CapturedApplication } from "@/boldpenguin/types";
import { isGridRow } from "@/boldpenguin/normalize";
import { NOTE_TARGETS, isNoteTarget } from "@/portal/fieldMaps";
import type { Sheet } from "./xlsx";

type Field = CapturedApplication["fields"][number];

/** Fields grouped "Row N" rebuilt as tables (page order, own headers). */
function arrayTables(fields: Field[]): { title: string; columns: string[]; rows: Record<string, string>[] }[] {
  const out = new Map<string, { columns: string[]; rows: Map<string, Record<string, string>> }>();
  for (const f of fields) {
    if (!isGridRow(f)) continue;
    const t = out.get(f.section) ?? out.set(f.section, { columns: [], rows: new Map() }).get(f.section)!;
    if (!t.columns.includes(f.label)) t.columns.push(f.label);
    const row = t.rows.get(f.group) ?? t.rows.set(f.group, {}).get(f.group)!;
    row[f.label] = usDate(f.value);
  }
  return [...out.entries()].map(([title, t]) => ({ title, columns: t.columns, rows: [...t.rows.values()] }));
}

const recordLabel = (mapped: string | undefined) =>
  (NOTE_TARGETS.find(t => t.value === mapped)?.label ?? "").replace(/^Notes: /, "");

export function captureSheets(app: CapturedApplication): Sheet[] {
  const notes = app.fields.filter(f => isNoteTarget(f.mapped));
  const regular = app.fields.filter(f => !isNoteTarget(f.mapped));
  const sheets: Sheet[] = [{
    name: "Summary",
    columns: ["Item", "Value"],
    rows: [
      ["Source", app.source.system],
      ["Page", app.source.title],
      ["Captured", new Date(app.capturedAt).toLocaleString()],
      ["Fields held", String(app.fields.length)]
    ]
  }];
  const singles = regular.filter(f => !isGridRow(f));
  if (singles.length) {
    sheets.push({ name: "Captured Fields", columns: ["Section", "Field", "Value"], rows: singles.map(f => [f.section, f.label, usDate(f.value)]) });
  }
  for (const t of arrayTables(regular)) {
    sheets.push({ name: t.title, columns: t.columns, rows: t.rows.map(r => t.columns.map(c => r[c] ?? "")) });
  }
  if (app.quotes?.length) {
    sheets.push({
      name: "Quotes",
      columns: ["Line of business", "Carrier", "Kind", "Premium", "Term (months)", "Premium status", "Included", "Source", "Coverage"],
      rows: app.quotes.map(q => [
        q.lob, q.carrierName, q.kind === "alternate" ? "Alternate" : "Requested",
        q.premium != null ? q.premium.toFixed(2) : "", q.termMonths != null ? String(q.termMonths) : "",
        q.premiumStatus === "firm" ? "Firm" : "Estimated", q.selected ? "Yes" : "No", q.source, q.coverageSummary
      ])
    });
  }
  const noteSingles = notes.filter(f => !isGridRow(f));
  if (noteSingles.length) {
    sheets.push({ name: "Timeline Notes", columns: ["Record", "Section", "Field", "Value"], rows: noteSingles.map(f => [recordLabel(f.mapped), f.section, f.label, usDate(f.value)]) });
  }
  for (const target of NOTE_TARGETS) {
    for (const t of arrayTables(notes.filter(f => f.mapped === target.value))) {
      sheets.push({ name: `Notes ${t.title}`, columns: ["Record", ...t.columns], rows: t.rows.map(r => [recordLabel(target.value), ...t.columns.map(c => r[c] ?? "")]) });
    }
  }
  return sheets;
}
