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

  it("keys twin controls by their section (expansion panels and sub-sections)", () => {
    document.body.innerHTML = PAGE;
    const rows = g.__bettersPortalScan!(null, {}) as { key: string; label: string }[];
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.label]));
    expect(byKey["text:prefix@applicant info"]).toBe("Applicant Info: Prefix");
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

  it("a contact's panel is not the applicant's: service labels stay in their own panel", () => {
    document.body.innerHTML = `<main>${panel("app", "Applicant Info", field("Gender", "g1", "gender", "Female"))}${panel("co", "Co-Applicant", field("Gender", "g2", "gender", "Male"))}</main>`;
    g.__bettersPortalPeekAll!({
      items: [{ key: "service:applicant.gender", label: "Primary contact: Gender", kind: "mapped", labels: ["applicant info>gender"] }],
      map: {}, payload: null, pageLabels: ["applicant info>gender"]
    });
    const outline = (id: string) => (document.getElementById(id)!.closest("mat-form-field") as HTMLElement).style.outline + (document.getElementById(id) as HTMLElement).style.outline;
    expect(outline("g1")).toMatch(/13a10e|rgb\(19, 161, 14\)/);
    expect(outline("g2")).toMatch(/d13438|rgb\(209, 52, 56\)/);
    expect(document.body.textContent).not.toMatch(/Primary contact: Gender[\s\S]*Primary contact: Gender/);
    g.__bettersPortalPeekAll!(null);
  });

  it("the new-contact form is known by its page heading", () => {
    document.body.innerHTML = `<header><h1>Contact</h1></header><main>${field("Gender", "g3", "gender", "")}</main>`;
    g.__bettersPortalPeekAll!({ items: [], map: {}, payload: null, pageLabels: ["applicant info>gender", "#contact>gender"] });
    expect((document.getElementById("g3") as HTMLElement).style.outline).not.toMatch(/d13438|rgb\(209, 52, 56\)/);
    g.__bettersPortalPeekAll!(null);
  });

  it("clicking a styled dropdown picks that dropdown, never the input in the next box", async () => {
    // EZLynx: "Address State" (mat-select, no input) beside "Postal Code"
    document.body.innerHTML = `<main>${panel("app", "Applicant Info", `<div class="row">
      <div class="wrap"><mat-form-field class="mat-mdc-form-field"><label>*Address State</label>
        <mat-select role="combobox" name="ratingState"><div class="trigger"><span id="st">MN</span></div></mat-select></mat-form-field></div>
      <div class="wrap">${field("Postal Code", "zip", "postalCode", "55316")}</div></div>`)}</main>`;
    await new Promise(r => setTimeout(r, 60));
    const pending = g.__bettersPortalPick!(5000) as Promise<{ key: string; label: string } | null>;
    document.getElementById("st")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    const row = await pending;
    expect(row!.key).toBe("field:applicant info>address state");
    expect(row!.label).toBe("Applicant Info: Address State");
  });

  it("a rating step's values are the prior / new policy of that line", () => {
    document.title = "Tracy Dittrich - Policy Info";
    document.body.innerHTML = `<header><h1>Auto</h1></header><main>${field("Prior Carrier", "pc", "priorCarrier", "Travelers")}${field("Prior Policy Expiration Date", "px", "priorExp", "12/01/2019")}${field("Years with Continuous Coverage", "yc", "years", "More than 15")}${field("New Policy Term", "nt", "term", "12 Month")}${field("Paperless", "pl", "paperless", "Yes")}</main>`;
    const r = g.__bettersPortalIngest!([
      { byLabel: "prior carrier", page: "policy info", label: "", path: "coverage.currentCarrier" },
      { byLabel: "prior policy expiration date", page: "policy info", label: "", path: "note:opportunity" },
      { byLabel: "years with continuous coverage", page: "policy info", label: "", path: "note:opportunity" },
      { byLabel: "new policy term", page: "policy info", label: "", path: "note:opportunity" },
      { byLabel: "paperless", page: "policy info", label: "", path: "note:opportunity" }
    ], {}) as { fields: { label: string; value: string; section: string; mapped?: string }[] };
    const taught = r.fields.filter(f => f.mapped).map(f => [f.section, f.label]);
    expect(taught).toEqual([
      ["Prior Auto Policy", "Prior Carrier"],
      ["Prior Auto Policy", "Prior Policy Expiration Date"],
      ["Prior Auto Policy", "Years with Continuous Coverage"],
      ["Opportunity Policy - Auto", "New Policy Term"],
      ["Opportunity Policy - Auto", "Paperless"]
    ]);
    document.title = "";
  });

  it("a heading that is not a line of business never names a policy", () => {
    document.title = "Quote - Applicant";
    document.body.innerHTML = `<header><h1>Get a Quote</h1></header><main>${field("Prior Carrier", "pc2", "pc", "Travelers")}</main>`;
    const r = g.__bettersPortalIngest!([{ byLabel: "prior carrier", page: "", label: "", path: "note:opportunity" }], {}) as { fields: { section: string; mapped?: string }[] };
    expect(r.fields.find(f => f.mapped)!.section).toBe("Get a Quote: Applicant");
    document.title = "";
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
