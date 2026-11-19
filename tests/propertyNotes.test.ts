// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CapturedApplication } from "@/boldpenguin/types";
import { buildPropertyNote, buildTimelineNote } from "@/crm/appCommit";
import { writePropertyNotes } from "@/crm/propertyNotes";
import { isArrayPath, isNoteTarget, noteLabelOf, parseFieldMapImport } from "@/portal/fieldMaps";

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
  const g = globalThis as unknown as { __bettersPortalIngest: (t: unknown, c: unknown) => { fields: Field[] } };
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
});
