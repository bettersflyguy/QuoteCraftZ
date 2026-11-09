// @vitest-environment jsdom
/** Repeated form cards (Vehicle 1 / Vehicle 2): every mapped field of a
 * card lands in ONE table row, columns named by the fields' own labels. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Field = { label: string; value: string; section: string; group: string; mapped?: string };
let ingest: (taught: unknown, controls: unknown) => { fields: Field[] };

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
  ingest = (globalThis as unknown as { __bettersPortalIngest: typeof ingest }).__bettersPortalIngest;
});

const card = (n: number, vin: string, year: string, make: string) => `
  <div class="vehicle-card" id="c${n}">
    <div class="card-head"><span>Vehicle ${n}</span></div>
    <mat-form-field class="mat-form-field"><label>* VIN</label><input name="vin" type="text" value="${vin}"></mat-form-field>
    <mat-form-field class="mat-form-field"><label>* Year</label><mat-select role="combobox"><span>${year}</span></mat-select></mat-form-field>
    <mat-form-field class="mat-form-field"><label>* Make</label><mat-select role="combobox"><span>${make}</span></mat-select></mat-form-field>
  </div>`;

describe("labelled-field keys (EZLynx steps)", () => {
  const ezCard = (n: number, vin: string, year: string) => `
    <div class="card"><span>Vehicle ${n}</span>
      <mat-form-field class="mat-mdc-form-field"><label><span>*</span>VIN</label><input name="VIN" id="VIN-${n - 1}" value="${vin}"></mat-form-field>
      <mat-form-field class="mat-mdc-form-field"><label>Year</label><mat-select role="combobox"><span class="mat-mdc-select-value-text">${year}</span></mat-select></mat-form-field>
      <mat-form-field class="mat-mdc-form-field"><label># Days/Week</label><mat-select role="combobox"><span class="mat-mdc-select-value-text">5</span></mat-select></mat-form-field>
    </div>`;
  const taught = [
    { byLabel: "vin", page: "vehicles", label: "", path: "note" },
    { byLabel: "year", page: "vehicles", label: "", path: "note" },
    { byLabel: "days week", page: "vehicles", label: "", path: "note" }
  ];

  it("every vehicle card's labelled fields form one Vehicles table", () => {
    document.title = "Tracy Dittrich - Vehicles";
    document.body.innerHTML = `<main>${ezCard(1, "2FMDK38C09BA65577", "2009")}${ezCard(2, "2FMDA52207BA05536", "2007")}</main>`;
    const rows = new Map<string, Record<string, string>>();
    for (const f of ingest(taught, {}).fields.filter(x => x.mapped === "note")) {
      expect(f.section).toBe("Vehicles");
      rows.set(f.group, { ...(rows.get(f.group) ?? {}), [f.label]: f.value });
    }
    expect(Object.fromEntries(rows)).toEqual({
      "Row 1": { VIN: "2FMDK38C09BA65577", Year: "2009", "# Days/Week": "5" },
      "Row 2": { VIN: "2FMDA52207BA05536", Year: "2007", "# Days/Week": "5" }
    });
  });

  it("applies only on its own step", () => {
    document.title = "Tracy Dittrich - Drivers";
    expect(ingest(taught, {}).fields.filter(x => x.mapped === "note")).toEqual([]);
  });
});

describe("auto-matching names", () => {
  it("other kinds of names never take the insured's full name", () => {
    const mapper = (globalThis as unknown as { BettersPortalMapper: {
      buildCandidates: (p: unknown) => unknown[]; matchField: (n: string, c: unknown[]) => { path: string } | null } }).BettersPortalMapper;
    const candidates = mapper.buildCandidates({ normalized: { contact: { fullName: "Tracy Dittrich" } }, fields: [] });
    for (const label of ["Maiden Name", "Account Name", "Nickname", "Assigned Producer Name", "Business Name"]) {
      expect(mapper.matchField(label, candidates)?.path, label).not.toBe("contact.fullName");
    }
    expect(mapper.matchField("Full Name", candidates)?.path).toBe("contact.fullName");
  });
});

describe("click-to-map on any site", () => {
  type Row = { key: string; label: string };
  const pickAfterClick = async (target: () => Element) => {
    // a finished pick broadcasts a cancel to every frame (async): let the
    // previous test's message drain before arming again
    await new Promise(r => setTimeout(r, 60));
    const pending = (globalThis as unknown as { __bettersPortalPick: (ms?: number) => Promise<Row | "timeout" | null> }).__bettersPortalPick(2000);
    await new Promise(r => setTimeout(r, 20));
    target().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return pending;
  };

  it("a value inside a labelled field box maps by label", async () => {
    document.title = "Momentum";
    document.body.innerHTML = `<main><mat-form-field class="mat-mdc-form-field"><label>Line of Business</label>
      <mat-select id="mat-select-17" role="combobox"><span id="mat-select-value-17" class="mat-mdc-select-value-text">Personal Auto</span></mat-select></mat-form-field></main>`;
    const row = await pickAfterClick(() => document.querySelector(".mat-mdc-select-value-text")!);
    expect(row).toMatchObject({ key: "field:line of business", label: "Line of Business" });
  });

  it("otherwise a selector that never anchors on a generated id", async () => {
    document.body.innerHTML = `<main><div id="mat-tab-content-3"><div class="summary"><b>Premium</b><span>$1,200</span></div></div></main>`;
    const row = await pickAfterClick(() => document.querySelector(".summary span")!);
    expect(row && row !== "timeout" ? row.key : "").toMatch(/^pick:/);
    expect(row && row !== "timeout" ? row.key : "").not.toContain("mat-tab-content-3");
  });
});

describe("repeated form cards", () => {
  it("VIN, Year and Make of each vehicle share one row of one table", () => {
    document.body.innerHTML = `<main><h1>Auto</h1><div id="cards">${card(1, "2FMDK38C09BA65577", "2009", "FORD")}${card(2, "2FMDA52207BA05536", "2007", "FORD")}</div></main>`;
    const res = ingest(
      [
        // id-anchored pick (no structural repeat): found by label in every card
        { selector: "#c1 > mat-form-field:nth-of-type(2) > mat-select > span", label: "", path: "note" },
        // structural pick on card 1
        { selector: "#cards > div:nth-of-type(1) > mat-form-field:nth-of-type(3) > mat-select > span", label: "", path: "note" }
      ],
      { "text:vin": "note" }
    );
    const notes = res.fields.filter(f => f.mapped === "note");
    const table = new Map<string, Record<string, string>>();
    for (const f of notes) {
      // the page is headed by its line of business: Auto's vehicles, not Home's
      expect(f.section).toBe("Auto: Vehicles");
      table.set(f.group, { ...(table.get(f.group) ?? {}), [f.label]: f.value });
    }
    expect(Object.fromEntries(table)).toEqual({
      "Row 1": { VIN: "2FMDK38C09BA65577", Year: "2009", Make: "FORD" },
      "Row 2": { VIN: "2FMDA52207BA05536", Year: "2007", Make: "FORD" }
    });
  });
});
