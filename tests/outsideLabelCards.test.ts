// @vitest-environment jsdom
/** EZLynx's Drivers step: a question whose label sits ABOVE its dropdown
 * box ("Driver Telematics/Smartride/Right Track Discount"), on every driver
 * card, with the cards laid out differently. A mapping taught by clicking
 * the dropdown's text on one card reads every card, by that label. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Field = { label: string; value: string; section: string; group: string; mapped?: string };
let ingest: (taught: unknown, controls: unknown) => { fields: Field[] };
let boxLabel: (el: Element) => string;

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
  const g = globalThis as unknown as { __bettersPortalIngest: typeof ingest; __bettersFormFieldLabel: typeof boxLabel };
  ingest = g.__bettersPortalIngest;
  boxLabel = g.__bettersFormFieldLabel;
});

const LABEL = "Driver Telematics/Smartride/Right Track Discount";
/* the dropdown: its own label-less box, the question text above it, an
 * info icon after it; card 2 marks it required and wraps it once more */
const question = (n: number, value: string, required: boolean) => `
  <div class="question">
    <div class="q-label">${required ? "<span>*</span> " : ""}<span>${LABEL}</span></div>
    <div class="q-row">
      <mat-form-field class="mat-mdc-form-field">
        <div class="mat-mdc-text-field-wrapper">
          <mat-select role="combobox" aria-labelledby="val${n}">
            <div class="mat-mdc-select-trigger"><span id="val${n}" class="mat-mdc-select-value-text">${value}</span><div class="mat-mdc-select-arrow-wrapper"><div class="mat-mdc-select-arrow"></div></div></div>
          </mat-select>
        </div>
      </mat-form-field>
      <span class="info">i</span>
    </div>
  </div>`;
const page = () => {
  document.title = "Tracy Dittrich - Drivers";
  document.body.innerHTML = `<main>
    <div class="card" id="c1"><span>Primary Insured</span>
      <mat-form-field class="mat-mdc-form-field"><label>First Name</label><input name="firstName" value="Tracy"></mat-form-field>
      ${question(1, "Yes", false)}
    </div>
    <div class="card" id="c2"><span>Additional Driver</span>
      <mat-form-field class="mat-mdc-form-field"><label>First Name</label><input name="firstName" value="Alexander"></mat-form-field>
      <div class="extra-wrap">${question(2, "No", true)}</div>
    </div>
  </main>`;
};

describe("a question labelled above its dropdown box", () => {
  it("the box is named by the question above it", () => {
    page();
    expect(boxLabel(document.getElementById("val1")!)).toBe(LABEL);
    expect(boxLabel(document.getElementById("val2")!)).toBe(LABEL);
    // a box with its own label keeps it
    expect(boxLabel(document.querySelector("input")!)).toBe("First Name");
  });

  it("a mapping taught on card 1's dropdown text reads every card, one row each", () => {
    page();
    const taught = [{ selector: "#c1 .mat-mdc-select-value-text", label: "Yes", path: "crm:contacts[].iacrm_telematicsagreement", section: "" }];
    const rows = ingest(taught, {}).fields.filter(f => f.mapped?.includes("iacrm_telematicsagreement"))
      .map(f => `${f.group} | ${f.mapped} | ${f.value}`);
    expect(rows).toEqual([
      "Row 1 | crm:contact2.iacrm_telematicsagreement | Yes",
      "Row 2 | crm:contact3.iacrm_telematicsagreement | No"
    ]);
  });

  it("a label mapping on that question (what a new click saves) reads every card", () => {
    page();
    const taught = [{ byLabel: "driver telematics smartride right track discount", page: "drivers", label: "", path: "crm:contacts[].iacrm_telematicsagreement" }];
    const values = ingest(taught, {}).fields.filter(f => f.mapped?.includes("iacrm_telematicsagreement")).map(f => f.value);
    expect(values).toEqual(["Yes", "No"]);
  });
});
