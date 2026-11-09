// @vitest-environment jsdom
/** Twin sub-sections (EZLynx "Primary Address" / "Other Address") share
 * every label and input name: each is mapped, captured and peeked on its
 * own, while top-level fields and numbered repeats keep their plain keys. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIELD_KEY, fieldKeyOf } from "@/portal/fieldMaps";

type G = Record<string, (...a: unknown[]) => unknown>;
const g = globalThis as unknown as G;

const panel = (id: string, title: string, inner: string) =>
  `<mat-expansion-panel id="${id}"><mat-expansion-panel-header><span><mat-panel-title><mat-icon>check_circle</mat-icon> ${title} </mat-panel-title></span></mat-expansion-panel-header><div>${inner}</div></mat-expansion-panel>`;
const field = (label: string, id: string, name: string, value: string) =>
  `<mat-form-field class="mat-mdc-form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${value}"></mat-form-field>`;

const PAGE = `<main>${panel("app", "Applicant Info",
  field("Prefix", "prefix", "prefix", "Ms") +
  panel("p1", "Primary Address", field("City", "c1", "addressCity", "CHAMPLIN") + field("State", "s1", "addressState", "MN")) +
  panel("p2", "Other Address", field("City", "c2", "addressCity", "Maple Grove") + field("State", "s2", "addressState", "MN"))
)}</main>`;

describe("section-scoped field keys", () => {
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

  it("keys twin controls by their section, top-level ones stay plain", () => {
    document.body.innerHTML = PAGE;
    const rows = g.__bettersPortalScan!(null, {}) as { key: string; label: string }[];
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.label]));
    expect(byKey["text:prefix"]).toBe("Prefix");
    expect(byKey["text:addressCity@primary address"]).toBe("Primary Address: City");
    expect(byKey["text:addressCity@other address"]).toBe("Other Address: City");
    expect(byKey["text:addressCity"]).toBeUndefined();
  });

  it("a section-scoped label finds only that section's field", () => {
    document.body.innerHTML = PAGE;
    const ids = (k: string) => (g.__bettersFieldsByLabel!("", k) as HTMLElement[]).map(e => e.querySelector("input")!.id);
    expect(ids("other address>city")).toEqual(["c2"]);
    expect(ids("primary address>city")).toEqual(["c1"]);
    expect(ids("city")).toEqual(["c1", "c2"]);
  });

  it("captures a mapped Other Address field alone, under its section", () => {
    document.body.innerHTML = PAGE;
    const r = g.__bettersPortalIngest!(
      [{ byLabel: "other address>city", page: "", label: "", path: "note" }],
      { "text:addressState@other address": "note" }
    ) as { fields: { label: string; value: string; section: string; mapped?: string }[] };
    const noted = r.fields.filter(f => f.mapped === "note").map(f => [f.section, f.label, f.value]);
    expect(noted).toEqual(expect.arrayContaining([["Other Address", "City", "Maple Grove"], ["Other Address", "State", "MN"]]));
    expect(noted.some(n => n[2] === "CHAMPLIN")).toBe(false);
    expect(noted.filter(n => n[1] === "State")).toHaveLength(1);
  });

  it("data-service coverage of the primary address leaves its twin red", () => {
    document.body.innerHTML = PAGE;
    g.__bettersPortalPeekAll!({ items: [], map: {}, payload: null, pageLabels: ["primary address>city", "primary address>state", "prefix"] });
    const outline = (id: string) => (document.getElementById(id) as HTMLElement).style.outline;
    const red = /d13438|rgb\(209, 52, 56\)/;
    expect(outline("c1")).not.toMatch(red);
    expect(outline("s1")).not.toMatch(red);
    expect(outline("c2")).toMatch(red);
    expect(outline("s2")).toMatch(red);
    expect(outline("prefix")).not.toMatch(red);
    g.__bettersPortalPeekAll!(null);
  });

  it("numbered repeats are not sections", () => {
    document.body.innerHTML = `<main>${panel("v", "Vehicles",
      panel("v1", "Vehicle 1", field("VIN", "a", "vin", "X1")) + panel("v2", "Vehicle 2", field("VIN", "b", "vin", "X2")))}</main>`;
    const rows = g.__bettersPortalScan!(null, {}) as { key: string }[];
    expect(rows.map(r => r.key)).toEqual(["text:vin"]);
    expect((g.__bettersFieldsByLabel!("", "vin") as unknown[]).length).toBe(2);
  });

  it("share files accept section keys", () => {
    expect(fieldKeyOf("Details", "Other Address>City")).toBe("field:details|other address>city");
    expect(FIELD_KEY.test("field:details|other address>city")).toBe(true);
    expect(FIELD_KEY.test("field:other address>city")).toBe(true);
    expect(FIELD_KEY.test("field:a>b>c")).toBe(false);
  });
});
