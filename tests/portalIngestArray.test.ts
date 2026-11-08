// @vitest-environment jsdom
/** Array-relationship taught captures: teaching ONE row's cell pulls that
 * cell from EVERY row of the repeated structure. The ingest ships as a plain
 * injected script - test it as shipped, against a real DOM. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Field = { label: string; value: string; mapped?: string; source: string };
type Ingest = (taught: unknown) => { fields: Field[] };

let ingest: Ingest;

beforeAll(() => {
  const src = readFileSync(path.resolve(__dirname, "../public/portal/portal-ingest.js"), "utf8");
  // the script is an IIFE that registers globalThis.__bettersPortalIngest
  // eslint-disable-next-line no-new-func
  new Function(src)();
  ingest = (globalThis as unknown as { __bettersPortalIngest: Ingest }).__bettersPortalIngest;
});

function taughtOnly(taught: unknown): Field[] {
  return ingest(taught).fields.filter(f => f.source === "taught");
}

describe("array taught captures", () => {
  it("fans one taught cell out across every table row, row-aligned across columns", () => {
    document.body.innerHTML = `
      <table id="rc"><tbody>
        <tr><td><span>Tracey Dittrich</span></td><td><a>tracey@example.com</a></td></tr>
        <tr><td><span>Jamie Dittrich</span></td><td><a>jamie@example.com</a></td></tr>
        <tr><td><span>Kim Dittrich</span></td><td><a>kim@example.com</a></td></tr>
      </tbody></table>`;
    const fields = taughtOnly([
      { selector: "#rc > tbody > tr:nth-of-type(2) > td:nth-of-type(1) > span", label: "Related contact full name", path: "contacts[].fullName" },
      { selector: "#rc > tbody > tr:nth-of-type(2) > td:nth-of-type(2) > a", label: "Related contact email", path: "contacts[].email" }
    ]);
    expect(fields.map(f => [f.mapped, f.value])).toEqual([
      ["contact2.fullName", "Tracey Dittrich"],
      ["contact3.fullName", "Jamie Dittrich"],
      ["contact4.fullName", "Kim Dittrich"],
      ["contact2.email", "tracey@example.com"],
      ["contact3.email", "jamie@example.com"],
      ["contact4.email", "kim@example.com"]
    ]);
  });

  it("varies the ROW axis, not the cell axis, and keeps hidden rows' numbering aligned", () => {
    document.body.innerHTML = `
      <div id="cards">
        <div><p>2019</p><p>Honda</p></div>
        <div hidden><p>2020</p><p>Ford</p></div>
        <div><p>2021</p><p>Tesla</p></div>
      </div>`;
    const fields = taughtOnly([
      { selector: "#cards > div:nth-of-type(1) > p:nth-of-type(1)", label: "Vehicle year", path: "vehicles[].year" }
    ]);
    // hidden row 2 is skipped but row 3 keeps its slot number
    expect(fields.map(f => [f.mapped, f.value])).toEqual([
      ["vehicle1.year", "2019"],
      ["vehicle3.year", "2021"]
    ]);
  });

  it("falls back to the single taught element when nothing repeats", () => {
    document.body.innerHTML = `<div id="solo"><span>only@example.com</span></div>`;
    const fields = taughtOnly([
      { selector: "#solo > span", label: "Related contact email", path: "contacts[].email" }
    ]);
    expect(fields.map(f => [f.mapped, f.value])).toEqual([["contact2.email", "only@example.com"]]);
  });

  it("single (non-array) teachings keep their explicit path and single row", () => {
    document.body.innerHTML = `
      <table id="t"><tbody>
        <tr><td>a@example.com</td></tr>
        <tr><td>b@example.com</td></tr>
      </tbody></table>`;
    const fields = taughtOnly([
      { selector: "#t > tbody > tr:nth-of-type(1) > td:nth-of-type(1)", label: "Email", path: "contact.email" }
    ]);
    expect(fields.map(f => [f.mapped, f.value])).toEqual([["contact.email", "a@example.com"]]);
  });
});

describe("CRM-column array captures", () => {
  it("fan out to crm:contactN with the same numbering as semantic contact arrays", () => {
    document.body.innerHTML = `
      <table id="rc2"><tbody>
        <tr><td>Alaxander</td><td>Duluth</td></tr>
        <tr><td>Tracy</td><td>Champlin</td></tr>
      </tbody></table>`;
    const fields = taughtOnly([
      { selector: "#rc2 > tbody > tr:nth-of-type(1) > td:nth-of-type(1)", label: "Related contact first name", path: "contacts[].firstName" },
      { selector: "#rc2 > tbody > tr:nth-of-type(1) > td:nth-of-type(2)", label: "Related contacts: Address 1: City", path: "crm:contacts[].address1_city" }
    ]);
    expect(fields.map(f => [f.mapped, f.value])).toEqual([
      ["contact2.firstName", "Alaxander"],
      ["contact3.firstName", "Tracy"],
      ["crm:contact2.address1_city", "Duluth"],
      ["crm:contact3.address1_city", "Champlin"]
    ]);
  });

  it("single CRM targets keep their path; policies arrays start at 1", () => {
    document.body.innerHTML = `
      <div id="h"><span>Champlin</span></div>
      <table id="pl"><tbody>
        <tr><td>989815765</td></tr><tr><td>502346899300</td></tr>
      </tbody></table>`;
    const fields = taughtOnly([
      { selector: "#h > span", label: "Insured (account): Address 1: City", path: "crm:account.address1_city" },
      { selector: "#pl > tbody > tr:nth-of-type(1) > td:nth-of-type(1)", label: "Policies: Policy Number", path: "crm:policies[].iacrm_policynumber" }
    ]);
    expect(fields.map(f => [f.mapped, f.value])).toEqual([
      ["crm:account.address1_city", "Champlin"],
      ["crm:policy1.iacrm_policynumber", "989815765"],
      ["crm:policy2.iacrm_policynumber", "502346899300"]
    ]);
  });
});

describe("array teachings render as tables", () => {
  it("emit rows under the record type with plain column names", () => {
    document.body.innerHTML = `
      <table id="rc3"><tbody>
        <tr><td>Alaxander</td><td>T540230618409</td></tr>
        <tr><td>Elizabeth</td><td>Y000108341300</td></tr>
      </tbody></table>`;
    const fields = (globalThis as unknown as { __bettersPortalIngest: (t: unknown) => { fields: { label: string; value: string; section: string; group: string; source: string }[] } })
      .__bettersPortalIngest([
        { selector: "#rc3 > tbody > tr:nth-of-type(1) > td:nth-of-type(1)", label: "First Name", section: "Related contacts", path: "crm:contacts[].firstname" },
        { selector: "#rc3 > tbody > tr:nth-of-type(1) > td:nth-of-type(2)", label: "Drivers License", section: "Related contacts", path: "crm:contacts[].iacrm_dlnumber" }
      ]).fields.filter(f => f.source === "taught");
    expect(fields.map(f => [f.section, f.group, f.label, f.value])).toEqual([
      ["Related contacts", "Row 1", "First Name", "Alaxander"],
      ["Related contacts", "Row 2", "First Name", "Elizabeth"],
      ["Related contacts", "Row 1", "Drivers License", "T540230618409"],
      ["Related contacts", "Row 2", "Drivers License", "Y000108341300"]
    ]);
  });
});
