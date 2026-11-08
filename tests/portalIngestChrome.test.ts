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
    const sections = new Set(ingest().fields.map(f => f.section));
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
