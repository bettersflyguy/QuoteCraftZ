// @vitest-environment jsdom
/** Ingest must read insured data, not the AMS page's own chrome: title-bar
 * toolbars must not leak into section names, and data-grid row selectors,
 * Actions menus and view settings must not become "fields". Tested as
 * shipped against a NowCerts-shaped DOM. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Field = { label: string; value: string; section: string; source: string };
let ingest: () => { fields: Field[] };

beforeAll(() => {
  // browsers provide CSS.escape; jsdom does not
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(path.resolve(__dirname, "../public/portal/portal-ingest.js"), "utf8"))();
  ingest = (globalThis as unknown as { __bettersPortalIngest: (t?: unknown) => { fields: Field[] } }).__bettersPortalIngest;
});

const PAGE = `
  <div class="page-title">
    <span>Dittrich, Tracey</span>
    <a class="btn btn-success">SEND CERTIFICATE</a>
    <div class="btn-group"><button>RATE!</button></div>
    <button>AUTOMATION</button><button>ADD</button><button>ACTIONS</button><a class="btn">EDIT</a>
  </div>
  <main>
    <label><input type="checkbox" checked> Show Archived</label>
    <label for="ps">Page Size</label><select id="ps"><option selected>10</option></select>
    <table id="contacts">
      <tr><th><input type="checkbox" aria-label="Select All Rows"></th><th>First Name</th><th>Last Name</th><th>Type</th></tr>
      <tr><td><input type="checkbox" aria-label="Select Row"></td><td>Alaxander</td><td>Dittrich</td><td>Child</td></tr>
      <tr><td><select aria-label="row menu"><option selected>Edit</option></select></td><td>Tracey</td><td>Dittrich</td><td>Owner</td></tr>
    </table>
    <table id="form">
      <tr><td><label for="fn">First Name</label></td><td><input id="fn" value="Tracey"></td></tr>
      <tr><td><label for="pc">Paperless</label></td><td><input id="pc" type="checkbox" checked></td></tr>
      <tr><td><label for="st">State</label></td><td><select id="st"><option selected>MN</option></select></td></tr>
    </table>
    <table id="drivers">
      <tr><th>Driver</th><th>DOB</th><th>License</th></tr>
      <tr><td><input aria-label="Driver 1 name" value="Tracey Dittrich"></td><td>03/11/1972</td><td>MN</td></tr>
      <tr><td><input aria-label="Driver 2 name" value="Tracy Dittrich"></td><td>03/11/1972</td><td>MN</td></tr>
    </table>
  </main>`;

describe("ingest skips page chrome", () => {
  it("names the section from the heading's own words, not its toolbar", () => {
    document.body.innerHTML = PAGE;
    const sections = new Set(ingest().fields.filter(f => !/^Row \d+$/.test((f as { group?: string }).group ?? "")).map(f => f.section));
    expect([...sections]).toEqual(["Dittrich, Tracey"]);
  });

  it("drops grid selectors, Actions menus and view settings but keeps real form data", () => {
    document.body.innerHTML = PAGE;
    const controls = ingest().fields.filter(f => f.source === "control").map(f => `${f.label}=${f.value}`);
    // real data, including a checkbox and a select in a label/value form
    // table and editable text inputs inside a data grid
    expect(controls).toEqual(expect.arrayContaining([
      "First Name=Tracey", "Paperless=Yes", "State=MN",
      "Driver 1 name=Tracey Dittrich", "Driver 2 name=Tracy Dittrich"
    ]));
    // page chrome
    for (const junk of ["Show Archived", "Page Size", "Select All Rows", "Select Row", "row menu"]) {
      expect(controls.some(c => c.startsWith(junk + "="))).toBe(false);
    }
  });
});

type GridField = Field & { group: string };
const gridOf = (fields: GridField[], title: string) => {
  const rows = new Map<string, Record<string, string>>();
  for (const f of fields.filter(x => x.section === title && /^Row \d+$/.test(x.group))) {
    rows.set(f.group, { ...(rows.get(f.group) ?? {}), [f.label]: f.value });
  }
  return [...rows.values()];
};

const LISTS = `
  <main>
    <div class="panel">
      <div class="panel-heading"><span class="panel-title">VEHICLES LIST</span> <a class="btn">+ Add New</a></div>
      <table>
        <thead><tr><th></th><th>Visible</th><th>Type</th><th>VIN</th><th>Make</th><th>Year</th></tr></thead>
        <tbody>
          <tr><td><select aria-label="Actions"><option>Edit</option></select></td><td><input type="checkbox" checked disabled></td><td>Other</td><td>JTMBF4DV4A5030644</td><td>TOYOTA</td><td>2010</td></tr>
          <tr><td><select aria-label="Actions"><option>Edit</option></select></td><td><input type="checkbox" checked disabled></td><td>Other</td><td>5TDDKRFH9FS121015</td><td>TOYOTA</td><td>2015</td></tr>
          <tr style="display:none"><td></td><td></td><td>Hidden</td><td>X</td><td>X</td><td>X</td></tr>
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-heading"><span class="panel-title">POLICIES LIST</span></div>
      <div class="k-grid">
        <div class="k-grid-header"><table><thead><tr><th></th><th>Number</th><th>Eff. Date</th><th>Premium</th><th>Status</th></tr></thead></table></div>
        <div class="k-grid-content"><table><tbody>
          <tr><td><select aria-label="Actions"><option>Edit</option></select></td><td><a>989815765</a> , <a>989815765</a> <button>+</button></td><td>06/01/2026</td><td>$2,692.00</td><td>Active</td></tr>
          <tr><td><select aria-label="Actions"><option>Edit</option></select></td><td><a>502346899300</a></td><td>02/01/2026</td><td>$3,892.14</td><td>Active</td></tr>
        </tbody></table></div>
      </div>
    </div>
  </main>`;

describe("data grids are captured as arrays", () => {
  it("captures every visible row under the grid's own title and column headers", () => {
    document.body.innerHTML = LISTS;
    const fields = ingest().fields as GridField[];
    expect(gridOf(fields, "Vehicles list")).toEqual([
      { Visible: "Yes", Type: "Other", VIN: "JTMBF4DV4A5030644", Make: "TOYOTA", Year: "2010" },
      { Visible: "Yes", Type: "Other", VIN: "5TDDKRFH9FS121015", Make: "TOYOTA", Year: "2015" }
    ]);
    // the loose page-text VIN scan stays quiet when a grid carries the VINs
    expect(fields.some(f => /^VIN( \d)?$/.test(f.label) && f.group === "")).toBe(false);
  });

  it("reads split-header (Kendo) grids and strips row buttons from cell text", () => {
    document.body.innerHTML = LISTS;
    expect(gridOf(ingest().fields as GridField[], "Policies list")).toEqual([
      { Number: "989815765, 989815765", "Eff. Date": "06/01/2026", Premium: "$2,692.00", Status: "Active" },
      { Number: "502346899300", "Eff. Date": "02/01/2026", Premium: "$3,892.14", Status: "Active" }
    ]);
  });
});

describe("Add to notes (timeline) teachings", () => {
  it("a note on a grid cell takes the whole column under the grid's title and header", () => {
    document.body.innerHTML = LISTS;
    const fields = (globalThis as unknown as { __bettersPortalIngest: (t: unknown) => { fields: (GridField & { mapped?: string })[] } })
      .__bettersPortalIngest([{ selector: "main > div:nth-of-type(1) > table > tbody > tr:nth-of-type(1) > td:nth-of-type(4)", label: "", path: "note" }])
      .fields.filter(f => f.mapped === "note");
    expect(fields.map(f => [f.section, f.group, f.label, f.value])).toEqual([
      ["Vehicles list", "Row 1", "VIN", "JTMBF4DV4A5030644"],
      ["Vehicles list", "Row 2", "VIN", "5TDDKRFH9FS121015"]
    ]);
  });

  it("a note on a single value keeps its on-page label", () => {
    document.body.innerHTML = `<main><div><b>Customer since</b><span id="since">11/04/2019</span></div></main>`;
    const fields = (globalThis as unknown as { __bettersPortalIngest: (t: unknown) => { fields: (GridField & { mapped?: string })[] } })
      .__bettersPortalIngest([{ selector: "#since", label: "", path: "note" }])
      .fields.filter(f => f.mapped === "note");
    expect(fields.map(f => [f.section, f.group, f.label, f.value])).toEqual([["Notes", "", "Customer since", "11/04/2019"]]);
  });
});
