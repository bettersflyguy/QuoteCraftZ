// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CapturedApplication } from "@/boldpenguin/types";
import { buildPropertyNote, buildTimelineNote } from "@/crm/appCommit";
import { writePropertyNotes } from "@/crm/propertyNotes";
import { familyKeyOf, isArrayPath, isNoteTarget, noteLabelOf, parseFieldMapImport, rowTargetOf, toRowTarget } from "@/portal/fieldMaps";
import type { PortalScanRow } from "@/boldpenguin/types";

const app = {
  schemaVersion: "1.1", capturedAt: "2026-11-19T00:00:00Z", normalized: {},
  completion: { likelyCompleted: false, matchedPhrases: [], hasReviewStep: false }, scannedSections: ["Home"],
  source: { system: "EZLynx", title: "Home", url: "https://app.ezlynx.com/home" },
  fields: [
    { label: "Retirees Credit", value: "Yes", section: "Home", group: "Row 1", mapped: "note:property1", source: "taught" },
    { label: "Wood Stoves", value: "2", section: "Home", group: "Row 1", mapped: "note:property1", source: "taught" },
    { label: "Dwelling Type", value: "Duplex", section: "Home", group: "Row 2", mapped: "note:property2", source: "taught" }
  ]
} as CapturedApplication;

describe("property collection notes", () => {
  it("keeps multiple labeled values on their property without overwriting", () => {
    const first = buildPropertyNote(app, 1)!;
    expect(first.count).toBe(2);
    expect(first.html).toContain("Retirees Credit");
    expect(first.html).toContain("Wood Stoves");
    expect(first.html).not.toContain("Duplex");
    expect(buildPropertyNote(app, 2)!.html).toContain("Duplex");
    expect(buildTimelineNote(app, "account")).toBeNull();
    expect(isNoteTarget("note:property1")).toBe(true);
    expect(isNoteTarget("note:property0")).toBe(false);
    expect(isArrayPath("note:properties[]")).toBe(true);
    expect(noteLabelOf("note:property2")).toBe("Notes: Property 2");
    expect(toRowTarget("note:properties[]", 2)).toBe("note:property2");
    expect(rowTargetOf("note:property2")).toEqual({ arrayPath: "note:properties[]", row: 2 });
  });

  it("writes only to each loaded property and reports an unmatched row", async () => {
    const write = vi.fn(async (_id: string, _subject: string, _html: string) => "created" as const);
    const result = await writePropertyNotes(app, [
      { asset: "vehicles", row: "crm:vehicle2", id: "VEHICLE" },
      { asset: "properties", row: "crm:property2", id: "PROPERTY-TWO" }
    ], write);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toBe("PROPERTY-TWO");
    expect(write.mock.calls[0]![2]).toContain("Duplex");
    expect(result[0]).toMatchObject({ key: "Notes for Property 1", status: 0 });
    expect(result[1]!.status).toBe(204);
  });

  it("round-trips property notes in mapping share files", () => {
    const file = JSON.stringify({ type: "iacrm-quote-connector-fieldmaps", version: 1, maps: { "https://x.example": { "field:dwelling type": "note:properties[]" } } });
    expect(parseFieldMapImport(file).maps["https://x.example"]!["field:dwelling type"]).toBe("note:properties[]");
  });
});

describe("capturing property notes", () => {
  type Field = { label: string; value: string; mapped?: string };
  const g = globalThis as unknown as {
    __bettersPortalIngest: (t: unknown, c: unknown) => { fields: Field[] };
    __bettersPortalPick: (timeout: number) => Promise<PortalScanRow | null | "timeout">;
    __bettersControlKey: (el: Element) => string;
    __bettersPortalScan: (payload: unknown, controls: Record<string, string>) => PortalScanRow[];
  };
  beforeAll(() => {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: s => s.replace(/([^\w-])/g, "\\$1") };
    HTMLElement.prototype.getBoundingClientRect = function () { return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect; };
    Element.prototype.getClientRects = function () { return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList; };
    for (const f of ["portal-mapper.js", "portal-ingest.js", "portal-fill.js"]) new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
  });

  it("reads every property's value in order and preserves distinct labels", () => {
    document.body.innerHTML = `<main>${["One Family", "Duplex"].map((value, i) => `<section><mat-form-field><label>Dwelling Type</label><input name="dwelling${i}" value="${value}"></mat-form-field></section>`).join("")}</main>`;
    const fields = g.__bettersPortalIngest([{ byLabel: "dwelling type", page: "", label: "Dwelling Type", path: "note:properties[]" }], {}).fields;
    expect(fields.filter(f => f.mapped?.startsWith("note:")).map(f => [f.value, f.mapped])).toEqual([
      ["One Family", "note:property1"], ["Duplex", "note:property2"]
    ]);
  });

  it("routes a singleton native field to Property 1 and excludes identifiers", () => {
    document.body.innerHTML = `<label for="retiree">Retirees Credit</label><input id="retiree" name="retiree" value="Yes"><label for="ssn">SSN</label><input id="ssn" name="ssn" value="123-45-6789">`;
    const fields = g.__bettersPortalIngest([], { "text:retiree": "note:properties[]", "text:ssn": "note:properties[]" }).fields.filter(f => f.mapped?.startsWith("note:"));
    expect(fields.map(f => [f.label, f.value, f.mapped])).toEqual([["Retirees Credit", "Yes", "note:property1"]]);
  });

  it("does not turn disabled system years into different property rows", async () => {
    document.title = "Applicant - Dwelling Info";
    document.body.innerHTML = `<main>${["Heating", "Electrical", "Plumbing", "Roofing"].map((system, i) =>
      `<mat-form-field><label for="yearUpdated${system}">Year Updated</label><input type="number" id="yearUpdated${system}" name="yearUpdated${system}" value="${2000 + i}" ${i < 3 ? "disabled" : ""}></mat-form-field>`
    ).join("")}</main>`;
    const heating = document.getElementById("yearUpdatedHeating")!;
    const picking = g.__bettersPortalPick(5000);
    heating.closest("mat-form-field")!.querySelector("label")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const row = await picking as PortalScanRow;
    expect(row).toMatchObject({ repeats: 1, fieldLabel: "Heating: Year Updated" });
    expect(familyKeyOf(row)).toBeNull();
    const controls = Object.fromEntries(Array.from(document.querySelectorAll("input")).slice(0, 3).map(el => [g.__bettersControlKey(el), "note:property1"]));
    const fields = g.__bettersPortalIngest([], controls).fields.filter(f => f.mapped === "note:property1");
    expect(fields.map(f => [f.label, f.value])).toEqual([
      ["Heating: Year Updated", "2000"], ["Electrical: Year Updated", "2001"], ["Plumbing: Year Updated", "2002"]
    ]);
  });

  it("uses the visible carrier question outside its nested form", () => {
    document.body.innerHTML = `<main><icq-question><label>Enter the year updated for the cooling type in YYYY format</label><div class="row"><icq-question-input><form><ez-read-only-field-wrapper><mat-form-field><input id="allied_coolingyear" name="questionInput" value="2020"></mat-form-field></ez-read-only-field-wrapper></form></icq-question-input></div></icq-question></main>`;
    const key = g.__bettersControlKey(document.querySelector("input")!);
    const fields = g.__bettersPortalIngest([], { [key]: "note:property1" }).fields.filter(f => f.mapped === "note:property1");
    expect(fields).toMatchObject([{ label: "Enter the year updated for the cooling type in YYYY format", value: "2020" }]);
  });

  it("keeps carrier select mappings stable when aria-labelledby points at the answer", async () => {
    document.title = "Applicant - Policy Info";
    document.body.innerHTML = `<main><icq-question><label>Number of Animals on Premises?</label><form><mat-form-field><mat-select id="animalpremises_ml" role="combobox" name="questionModel" aria-labelledby="answer"><span id="answer">None</span></mat-select></mat-form-field></form></icq-question></main>`;
    const control = document.querySelector("mat-select")!;
    const picking = g.__bettersPortalPick(5000);
    control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const row = await picking as PortalScanRow;
    expect(row.fieldLabel).toBe("Number of Animals on Premises?");
    const teaching = [{ byLabel: "number of animals on premises", page: "", label: row.fieldLabel, path: "note:properties[]" }];
    for (const answer of ["None", "2"]) {
      document.getElementById("answer")!.textContent = answer;
      const fields = g.__bettersPortalIngest(teaching, {}).fields.filter(f => f.mapped === "note:property1");
      expect(fields).toMatchObject([{ label: "Number of Animals on Premises?", value: answer }]);
    }
  });

  it("selects a read-only term without borrowing a neighboring date control", async () => {
    document.body.innerHTML = `<main><div><ez-read-only-field label="New Policy Term"><span>New Policy Term</span><span id="term">12 Month</span></ez-read-only-field><label for="effective">Effective Date</label><input id="effective" value="11/28/2026"></div></main>`;
    const picking = g.__bettersPortalPick(5000);
    document.getElementById("term")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(await picking).toMatchObject({ fieldLabel: "New Policy Term", label: "New Policy Term: 12 Month" });
  });

  it("keeps the context of equal calculated coverage amounts and breakage flags", () => {
    document.body.innerHTML = `<main>${["Other Structures", "Loss Of Use"].map((label, i) => `<div><mat-form-field><label>${label}</label><mat-select>10%</mat-select></mat-form-field><div class="coverage-amount"><ez-read-only-field><span>Amount</span><span id="amount${i}">$19,800</span></ez-read-only-field></div></div>`).join("")}<label for="coins">Breakage</label><input id="coins" name="coinsBreakage" type="checkbox"><label for="arts">Breakage</label><input id="arts" name="fineArtsBreakage" type="checkbox"></main>`;
    const fields = g.__bettersPortalIngest([0, 1].map(i => ({ selector: `#amount${i}`, label: "", path: "note:property1" })), { "checkbox:coinsBreakage": "note:property1", "checkbox:fineArtsBreakage": "note:property1" }).fields.filter(f => f.mapped === "note:property1");
    expect(fields.map(f => [f.label, f.value])).toEqual(expect.arrayContaining([
      ["Other Structures: Amount", "$19,800"], ["Loss Of Use: Amount", "$19,800"], ["Coins: Breakage", "No"], ["Fine Arts: Breakage", "No"]
    ]));
  });

  it("shows saved mappings for disabled and read-only fields in the editor scan", () => {
    document.body.innerHTML = `<label for="business">Business Name</label><input id="business" name="businessPursuitsName" disabled><label for="excluded">Exclude Masonry Veneer</label><input id="excluded" name="excludeMasonryVeneer" type="checkbox" disabled><label for="source">Source</label><input id="source" name="source" readonly>`;
    const mappings = { "text:businessPursuitsName": "note:property1", "checkbox:excludeMasonryVeneer": "note:property1", "text:source": "note:property1" };
    const rows = g.__bettersPortalScan(null, mappings);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => [row.key, row.mapped])).toEqual(Object.entries(mappings));
  });
});
