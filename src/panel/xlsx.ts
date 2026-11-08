/** Minimal .xlsx writer: one worksheet per table, each formatted as a real
 * Excel Table (styled header, banded rows, filter buttons), every cell as
 * text so VINs, policy and license numbers keep their exact characters. */
import { strToU8, zipSync } from "fflate";

export interface Sheet { name: string; columns: string[]; rows: string[][] }

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const xml = (v: string) =>
  v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A1-style column letters: 0 -> A, 26 -> AA. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: <= 31 chars, none of []:*?/\ , unique ignoring case. */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || `Sheet ${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Table column names must be non-empty and unique within the table. */
function columnNames(cols: string[]): string[] {
  const used = new Set<string>();
  return cols.map((raw, i) => {
    const base = raw.trim() || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const cell = (ref: string, v: string) =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;

export function buildWorkbook(input: Sheet[]): Uint8Array {
  const sheets = input.filter(s => s.columns.length).map(s => ({
    ...s,
    rows: s.rows.length ? s.rows : [s.columns.map(() => "")]  // a Table needs a data row
  }));
  const names = sheetNames(sheets.map(s => s.name));
  const files: Record<string, Uint8Array> = {};

  sheets.forEach((s, i) => {
    const n = i + 1;
    const cols = columnNames(s.columns);
    const lastCol = colName(cols.length - 1);
    const lastRow = s.rows.length + 1;
    const widths = cols.map((c, ci) =>
      Math.min(60, Math.max(10, c.length + 4, ...s.rows.map(r => (r[ci] ?? "").length + 2))));
    const header = `<row r="1">${cols.map((c, ci) => cell(`${colName(ci)}1`, c)).join("")}</row>`;
    const body = s.rows.map((r, ri) =>
      `<row r="${ri + 2}">${cols.map((_, ci) => cell(`${colName(ci)}${ri + 2}`, r[ci] ?? "")).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData>${header}${body}</sheetData>` +
      `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` +
      `</worksheet>`);
    files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/table" Target="../tables/table${n}.xml"/></Relationships>`);
    const ref = `A1:${lastCol}${lastRow}`;
    const display = `T${n}_${names[i]!.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 250);
    files[`xl/tables/table${n}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<table xmlns="${NS}" id="${n}" name="${display}" displayName="${display}" ref="${ref}" totalsRowShown="0">` +
      `<autoFilter ref="${ref}"/>` +
      `<tableColumns count="${cols.length}">${cols.map((c, ci) => `<tableColumn id="${ci + 1}" name="${xml(c)}"/>`).join("")}</tableColumns>` +
      `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
      `</table>`);
  });

  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>` +
    names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}">` +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${names.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
    `</Relationships>`);
  files["xl/styles.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="${NS}">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`);
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    names.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join("") +
    `</Types>`);

  return zipSync(files, { level: 6 });
}
