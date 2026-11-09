// @vitest-environment jsdom
/** "Notes: Related contact (each row)": a contact row's values go on THAT
 * person's own timeline (row 1 = note:contact2), never the primary's. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeApplicant } from "@/ezlynx/normalize";
import { ezlynxFields } from "@/sources/ezlynxSource";
import { normalize } from "@/boldpenguin/normalize";
import { buildRelatedContactNote, buildTimelineNote, coApplicantsFromCapture, relatedNoteSlots } from "@/crm/appCommit";
import { isNoteTarget, noteLabelOf, noteRecordOf, parseFieldMapImport } from "@/portal/fieldMaps";
import type { CapturedApplication } from "@/boldpenguin/types";

const raw = {
  id: 1, firstName: "David", lastName: "Johnson",
  contacts: [
    { firstName: "Karen", lastName: "Johnson", maidenName: "Smith", relationship: { name: "Spouse" }, isCoApplicant: true },
    { firstName: "Sam", lastName: "Johnson", relationship: { name: "Child" }, isCoApplicant: false }
  ]
};

describe("related contact notes", () => {
  const fields = ezlynxFields(normalizeApplicant(raw), { "coApplicant.maidenName": "note:contacts[]", "coApplicant.relationship": "note:contacts[]", "applicant.maidenName": "note:contacts[]" });
  const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;

  it("each contact row resolves to its own related contact", () => {
    const routed = fields.filter(f => f.mapped?.startsWith("note:")).map(f => [f.label, f.value, f.mapped]);
    expect(routed).toEqual([
      ["Maiden name", "Smith", "note:contact2"], ["Relationship", "Spouse", "note:contact2"],
      ["Relationship", "Child", "note:contact3"]
    ]);
    expect(noteRecordOf("note:contact3")).toBe("relatedcontact");
    expect(noteLabelOf("note:contact3")).toBe("Notes: Related contact 2");
    expect(isNoteTarget("note:contacts[]")).toBe(true);
  });

  it("never lands on the primary contact's or the insured's note", () => {
    expect(buildTimelineNote(app, "contact")).toBeNull();
    expect(buildTimelineNote(app, "account")).toBeNull();
  });

  it("one note per related contact, matched to their CRM contact by slot", () => {
    expect(relatedNoteSlots(app)).toEqual([2, 3]);
    const karen = buildRelatedContactNote(app, 2)!;
    expect(karen.count).toBe(2);
    expect(karen.html).toContain("<tr><td>Maiden name</td><td>Smith</td></tr>");
    expect(karen.html).not.toContain("Child");
    expect(coApplicantsFromCapture(app).map(c => [c.firstName, c.slot])).toEqual([["Karen", 2], ["Sam", 3]]);
  });

  it("travels in share files", () => {
    const file = JSON.stringify({ type: "iacrm-quote-connector-fieldmaps", version: 1, maps: { "https://x.example": { "field:relationship": "note:contacts[]" } } });
    expect(parseFieldMapImport(file).maps["https://x.example"]).toEqual({ "field:relationship": "note:contacts[]" });
  });
});

describe("on a page", () => {
  type G = Record<string, (...a: unknown[]) => unknown>;
  const g = globalThis as unknown as G;
  beforeAll(() => {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
    };
    Element.prototype.getClientRects = function (this: Element) {
      return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
    };
    for (const f of ["portal-mapper.js", "portal-ingest.js", "portal-fill.js"]) {
      // eslint-disable-next-line no-new-func
      new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
    }
  });

  it("each repeated card's field goes to that card's related contact", () => {
    const card = (n: number, rel: string) =>
      `<div class="card-${n}"><h3>Driver ${n}</h3><mat-form-field class="mat-mdc-form-field"><label>Relationship</label><input name="rel${n}" value="${rel}"></mat-form-field></div>`;
    document.body.innerHTML = `<main>${card(1, "Spouse")}${card(2, "Child")}</main>`;
    const r = g.__bettersPortalIngest!([{ byLabel: "relationship", page: "", label: "", path: "note:contacts[]" }], {}) as
      { fields: { value: string; mapped?: string }[] };
    expect(r.fields.filter(f => f.mapped?.startsWith("note")).map(f => [f.value, f.mapped])).toEqual([
      ["Spouse", "note:contact2"], ["Child", "note:contact3"]
    ]);
  });
});
