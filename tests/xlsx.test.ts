import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildWorkbook, colName } from "@/panel/xlsx";
import { captureSheets } from "@/panel/captureSheets";
import type { CapturedApplication } from "@/boldpenguin/types";

const app: CapturedApplication = {
  schemaVersion: "1.1",
  capturedAt: "2026-11-08T18:00:00.000Z",
  source: { system: "www8.nowcerts.com", url: "https://www8.nowcerts.com/x", title: "Dittrich, Tracey" },
  completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: false },
  scannedSections: [],
  normalized: {},
  fields: [
    { label: "Name", value: "Dittrich, Tracey", section: "Personal insured", group: "", source: "table" },
    { label: "E-mail", value: "tracey.dittrich@comcast.net", section: "Personal insured", group: "", source: "table" },
    { label: "VIN", value: "JTMBF4DV4A5030644", section: "Vehicles List", group: "Row 1", source: "table" },
    { label: "Make", value: "TOYOTA", section: "Vehicles List", group: "Row 1", source: "table" },
    { label: "VIN", value: "5TDDKRFH9FS121015", section: "Vehicles List", group: "Row 2", source: "table" },
    { label: "Make", value: "TOYOTA", section: "Vehicles List", group: "Row 2", source: "table" },
    { label: "Number", value: "0989815765", section: "Policies List", group: "Row 1", source: "table" },
    { label: "Remarks", value: "<b>A & B</b>", section: "Notes", group: "", source: "taught", mapped: "note:policy" },
    { label: "Model", value: "RAV4", section: "Vehicles List", group: "Row 1", source: "taught", mapped: "note" }
  ]
};

describe("xlsx export", () => {
  it("lays the capture out as tabs: summary, fields, one per table, timeline notes", () => {
    const sheets = captureSheets(app);
    expect(sheets.map(s => s.name)).toEqual(["Summary", "Captured Fields", "Vehicles List", "Policies List", "Timeline Notes", "Notes Vehicles List"]);
    expect(sheets[2]).toEqual({ name: "Vehicles List", columns: ["VIN", "Make"], rows: [["JTMBF4DV4A5030644", "TOYOTA"], ["5TDDKRFH9FS121015", "TOYOTA"]] });
    expect(sheets[4]!.rows).toEqual([["Policy", "Notes", "Remarks", "<b>A & B</b>"]]);
    expect(sheets[5]!.rows).toEqual([["Insured (account)", "RAV4"]]);
  });

  it("writes a valid package: one worksheet + Excel Table per tab, text cells, escaped XML", () => {
    const bytes = buildWorkbook(captureSheets(app));
    const files = unzipSync(bytes);
    const names = Object.keys(files);
    expect(names).toEqual(expect.arrayContaining([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/worksheets/sheet3.xml", "xl/tables/table3.xml", "xl/worksheets/_rels/sheet3.xml.rels"
    ]));
    const table = strFromU8(files["xl/tables/table3.xml"]!);
    expect(table).toContain('ref="A1:B3"');
    expect(table).toContain('<tableColumn id="1" name="VIN"/>');
    const policies = strFromU8(files["xl/worksheets/sheet4.xml"]!);
    // leading zero survives (text cell, never a number)
    expect(policies).toContain('<t xml:space="preserve">0989815765</t>');
    const notes = strFromU8(files["xl/worksheets/sheet5.xml"]!);
    expect(notes).toContain("&lt;b&gt;A &amp; B&lt;/b&gt;");
    // handed to openpyxl by the release check
    const out = path.resolve(__dirname, "../.tmp");
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "capture-test.xlsx"), bytes);
  });

  it("names columns A..Z, AA..", () => {
    expect([0, 25, 26, 51, 52, 701].map(colName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ"]);
  });

  it("keeps sheet names legal and unique, and gives empty tables a row", () => {
    const files = unzipSync(buildWorkbook([
      { name: "Drivers/List: [all]?", columns: ["A"], rows: [["1"]] },
      { name: "Drivers List  all", columns: ["A", "A", ""], rows: [] }
    ]));
    const wb = strFromU8(files["xl/workbook.xml"]!);
    expect(wb).toContain('name="Drivers List all"');
    expect(wb).toContain('name="Drivers List all 2"');
    const t2 = strFromU8(files["xl/tables/table2.xml"]!);
    expect(t2).toContain('name="A 2"');
    expect(t2).toContain('name="Column 3"');
    expect(t2).toContain('ref="A1:C2"');
  });
});
