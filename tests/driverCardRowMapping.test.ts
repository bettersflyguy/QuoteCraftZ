// @vitest-environment jsdom
/** EZLynx's Drivers step: the "Primary Insured" and "Additional Driver"
 * cards share one box key per label. A person mapping saved on that key
 * ("First Name" -> Related contact 1, Row 1) must read EVERY card, one
 * person per card, instead of sending every card's name to one person. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import type { CapturedAppField } from "@/boldpenguin/types";

type Field = CapturedAppField;
let ingest: (taught: unknown, controls: unknown) => { fields: Field[] };
let keyOf: (el: Element) => string;
let scan: (payload: unknown, overrides: unknown) => { key: string; repeats?: number }[];

beforeAll(() => {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  };
  for (const f of ["portal-mapper.js", "portal-fill.js", "portal-ingest.js"]) {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
  }
  const g = globalThis as unknown as { __bettersPortalIngest: typeof ingest; __bettersControlKey: typeof keyOf; __bettersPortalScan: typeof scan };
  ingest = g.__bettersPortalIngest;
  keyOf = g.__bettersControlKey;
  scan = g.__bettersPortalScan;
});

/* the label text and the box's accessible name differ on purpose: the
 * repeat count must not depend on them agreeing */
const card = (title: string, first: string, last: string) => `
  <div class="card"><span>${title}</span>
    <mat-form-field class="mat-mdc-form-field"><label><span>*</span>First Name</label><input name="firstName" aria-label="Applicant first name" value="${first}"></mat-form-field>
    <mat-form-field class="mat-mdc-form-field"><label><span>*</span>Last Name</label><input name="lastName" aria-label="Applicant last name" value="${last}"></mat-form-field>
  </div>`;

const site = { system: "EZLynx", url: "https://app.ezlynx.com/x", title: "Tracy Dittrich" };

function page() {
  document.title = "Tracy Dittrich - Drivers";
  document.body.innerHTML = `<main>${card("Primary Insured", "Tracy", "Dittrich")}${card("Additional Driver", "Alexander", "Dittrich")}</main>`;
  const [first, last] = Array.from(document.querySelectorAll("input"));
  return { first: keyOf(first!), last: keyOf(last!) };
}

describe("a one-row person mapping on a box every driver card shares", () => {
  it("reads every card, one person per card", () => {
    const k = page();
    const fields = ingest([], { [k.first]: "crm:contact2.firstname", [k.last]: "crm:contact2.lastname" }).fields
      .filter(f => f.mapped?.startsWith("crm:"));
    const rows = fields.map(f => `${f.group} | ${f.mapped} | ${f.value}`).sort();
    expect(rows).toEqual([
      "Row 1 | crm:contact2.firstname | Tracy",
      "Row 1 | crm:contact2.lastname | Dittrich",
      "Row 2 | crm:contact3.firstname | Alexander",
      "Row 2 | crm:contact3.lastname | Dittrich"
    ]);
  });

  it("lands Tracy on the primary insured and Alexander on Related contact 1", () => {
    const k = page();
    const held = mergeIngestedFields(null, [
      { label: "First name", value: "Tracy", section: "Contacts", group: "Row 1", source: "dataservice", mapped: "contact.firstName" },
      { label: "Last name", value: "Dittrich", section: "Contacts", group: "Row 1", source: "dataservice", mapped: "contact.lastName" }
    ], site).app;
    const fields = ingest([], { [k.first]: "crm:contact2.firstname", [k.last]: "crm:contact2.lastname" }).fields;
    const out = mergeIngestedFields(held, fields, site).app;
    const byPath = Object.fromEntries(out.fields.filter(f => f.mapped?.startsWith("crm:")).map(f => [f.mapped, f.value]));
    expect(byPath["crm:contact2.firstname"]).toBe("Alexander");
    expect(Object.values(byPath)).not.toContain(undefined);
    expect(out.fields.filter(f => f.value === "Tracy" && f.mapped === "crm:contact2.firstname")).toEqual([]);
  });

  it("the mapping editor sees the box as repeated, so it offers every card", () => {
    page();
    const rows = scan(null, {});
    const first = rows.find(r => r.key.includes("firstName"));
    expect(first?.repeats).toBe(2);
  });

  it("a box on one card only keeps its one-row mapping", () => {
    document.title = "Tracy Dittrich - Drivers";
    document.body.innerHTML = `<main>${card("Additional Driver", "Alexander", "Dittrich")}</main>`;
    const first = keyOf(document.querySelector("input")!);
    const f = ingest([], { [first]: "crm:contact2.firstname" }).fields.find(x => x.mapped?.startsWith("crm:"));
    expect(f).toMatchObject({ mapped: "crm:contact2.firstname", value: "Alexander" });
  });
});
