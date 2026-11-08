// @vitest-environment jsdom
/** One-for-one choice mappings: source wording <-> exact CRM choice value. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { autoMatchOption, columnKeyOf, toCrmChoice, toSourceText } from "@/portal/optionMaps";
import { translateCapturedChoices, translateFillChoices } from "@/portal/choiceRouting";
import { buildFieldMapExport, parseFieldMapImport } from "@/portal/fieldMaps";
import { coerce, type FieldCatalog } from "@/crm/fieldCatalog";
import type { CapturedAppField } from "@/boldpenguin/types";

const EDUCATION = [
  { value: 1, label: "High School" },
  { value: 2, label: "Associate's" },
  { value: 3, label: "Bachelor's" },
  { value: 4, label: "Master's" },
  { value: 5, label: "Doctorate" }
];
const catalog: FieldCatalog = { envId: "e", fetchedAt: 0, entities: [
  { key: "primarycontact", logical: "contact", set: "contacts", label: "Primary contact", array: false,
    columns: [{ name: "educationcode", label: "Education", type: "Picklist", options: EDUCATION }] },
  { key: "contacts", logical: "contact", set: "contacts", label: "Related contacts (all rows)", array: true,
    columns: [{ name: "educationcode", label: "Education", type: "Picklist", options: EDUCATION }] }
] };

describe("choice mapping", () => {
  it("keys per CRM column so every row shares one mapping", () => {
    expect(columnKeyOf("crm:primarycontact.educationcode")).toBe("contact.educationcode");
    expect(columnKeyOf("crm:contact3.educationcode")).toBe("contact.educationcode");
    expect(columnKeyOf("crm:contacts[].educationcode")).toBe("contact.educationcode");
    expect(columnKeyOf("crm:policy2.iacrm_status")).toBe("iacrm_policy.iacrm_status");
    expect(columnKeyOf("contact.gender")).toBeNull();
  });

  it("the agent's binding wins; unbound text falls back to a unique guess", () => {
    const map = { "Bachelors Degree": 3, "Some College": 2, "Graduate": 4 };
    expect(toCrmChoice("bachelors degree", map, EDUCATION)?.value).toBe(3);
    expect(toCrmChoice("Graduate", map, EDUCATION)?.label).toBe("Master's");
    expect(toCrmChoice("Doctorate", map, EDUCATION)?.value).toBe(5);
    expect(autoMatchOption("Vocational", EDUCATION)).toBeNull();
    expect(toSourceText("Master's", map, EDUCATION)).toBe("Graduate");
    expect(toSourceText("4", map, EDUCATION)).toBe("Graduate");
    expect(toSourceText("Doctorate", map, EDUCATION)).toBeNull();
    // the load's own coercion uses the same guess as a safety net
    expect(coerce(catalog.entities[0]!.columns[0]!, "Bachelors")).toBe(3);
  });

  it("capture carries the CRM label; fill carries the form's wording", () => {
    const scope = { "contact.educationcode": { "Some College": 2 } };
    const fields: CapturedAppField[] = [
      { label: "Education", value: "Some College", section: "Applicant", group: "", source: "dataservice", mapped: "crm:primarycontact.educationcode" },
      { label: "Education", value: "Vocational", section: "Co-applicants", group: "Row 1", source: "dataservice", mapped: "crm:contact2.educationcode" },
      { label: "City", value: "Champlin", section: "Applicant", group: "", source: "dataservice", mapped: "address.city" }
    ];
    const out = translateCapturedChoices(fields, scope, catalog);
    expect(out.map(f => f.value)).toEqual(["Associate's", "Vocational", "Champlin"]);
    const values = translateFillChoices(
      { "crm:primarycontact.educationcode": "Associate's", "crm:contact2.educationcode": "Doctorate" },
      { "select:edu": "crm:primarycontact.educationcode", "select:edu2": "crm:contact2.educationcode" },
      scope, catalog);
    expect(values["crm:primarycontact.educationcode"]).toBe("Some College");
    expect(values["crm:contact2.educationcode"]).toBe("Doctorate");
  });

  it("share files carry choice mappings for the sites they map, validated", () => {
    const file = buildFieldMapExport(
      { "https://carrier.example.com": { "select:edu": "crm:primarycontact.educationcode" } },
      {
        "https://carrier.example.com": { "contact.educationcode": { "Some College": 2 } },
        "https://other.example.com": { "contact.educationcode": { "x": 1 } }
      });
    expect(Object.keys(file.options ?? {})).toEqual(["https://carrier.example.com"]);
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.options["https://carrier.example.com"]["Bad Key!"] = { a: 1 };
    tampered.options["https://carrier.example.com"]["contact.educationcode"]["Text"] = "not a number";
    const parsed = parseFieldMapImport(JSON.stringify(tampered));
    expect(parsed.options).toEqual({ "https://carrier.example.com": { "contact.educationcode": { "Some College": 2 } } });
  });
});

describe("page scan lists a selection field's choices", () => {
  beforeAll(() => {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
    };
    // jsdom has no layout: every attached element gets one box
    Element.prototype.getClientRects = function (this: Element) {
      return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
    };
    for (const f of ["portal-mapper.js", "portal-fill.js"]) {
      // eslint-disable-next-line no-new-func
      new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
    }
  });
  it("in the page's own wording, without placeholders", () => {
    document.body.innerHTML = `
      <label for="edu">Education</label>
      <select id="edu" name="edu"><option value="">Select...</option><option>Some College</option><option>Bachelors Degree</option></select>`;
    const rows = (globalThis as unknown as { __bettersPortalScan: (p: unknown, o: unknown) => { key: string; options?: string[] }[] })
      .__bettersPortalScan(null, {});
    expect(rows.find(r => r.key === "select:edu")?.options).toEqual(["Some College", "Bachelors Degree"]);
  });

  type Choices = { current: string; options: string[]; refused?: boolean } | null;
  const readChoices = (key: string) =>
    (globalThis as unknown as { __bettersPortalChoices: (k: string) => Promise<Choices> }).__bettersPortalChoices(key);

  it("reads a styled dropdown's current value and its options by opening and closing it", async () => {
    // Angular-Material-like: options exist only while the overlay is open
    document.body.innerHTML = `
      <label id="lbl">Education</label>
      <mat-select id="edu" role="combobox" aria-labelledby="lbl"><span id="shown">Bachelors</span></mat-select>
      <div class="cdk-overlay-container"></div>`;
    const host = document.getElementById("edu")!;
    const overlay = document.querySelector(".cdk-overlay-container")!;
    host.addEventListener("click", () => {
      overlay.innerHTML = `<div role="listbox"><mat-option role="option">High School</mat-option><mat-option role="option">Bachelors</mat-option><mat-option role="option">Masters</mat-option></div>`;
    });
    host.addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Escape") overlay.innerHTML = ""; });
    const r = await readChoices("pick:#shown");
    expect(r).toEqual({ current: "Bachelors", options: ["High School", "Bachelors", "Masters"] });
    expect(overlay.innerHTML).toBe("");                       // closed again
    expect(document.getElementById("shown")!.textContent).toBe("Bachelors"); // nothing selected
  });

  it("reads a native select without opening it, and refuses identifier fields", async () => {
    document.body.innerHTML = `
      <label for="edu">Education</label>
      <select id="edu" name="edu"><option value="">Select...</option><option>Some College</option><option selected>Bachelors Degree</option></select>
      <label for="ssnq">SSN type</label>
      <select id="ssnq" name="ssnq"><option>Full</option></select>`;
    expect(await readChoices("select:edu")).toEqual({ current: "Bachelors Degree", options: ["Some College", "Bachelors Degree"] });
    expect((await readChoices("select:ssnq"))?.refused).toBe(true);
  });
});
