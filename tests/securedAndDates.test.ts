// @vitest-environment jsdom
/** US dates for people, EZLynx SSN/DL# through the secured channel only,
 * and the one green/red peek. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { usDate } from "@/util/usDate";
import { ezlynxFields, ezlynxSecure, withoutSsn } from "@/sources/ezlynxSource";
import type { CapturedApplicant } from "@/types";

describe("US dates", () => {
  it("formats whole date values as MM-DD-YYYY and leaves other text alone", () => {
    expect(usDate("1972-03-11")).toBe("03-11-1972");
    expect(usDate("2026-03-11T05:00:00Z")).toBe("03-11-2026");
    expect(usDate("3/11/1972")).toBe("03-11-1972");
    expect(usDate("03-11-1972")).toBe("03-11-1972");
    expect(usDate("Expires 3/11/1972")).toBe("Expires 3/11/1972");
    expect(usDate("$1,200")).toBe("$1,200");
    expect(usDate("13/40/2020")).toBe("13/40/2020");
  });
});

describe("EZLynx SSN and DL#", () => {
  const a: CapturedApplicant = {
    ezlynxApplicantId: 1, firstName: "Tracy", lastName: "Dittrich", dateOfBirth: "1972-03-11",
    dlNumber: "K011156496702", dlState: "MN", ssn: "123-45-6789",
    address: null, phones: [], emails: [], isCommercial: false,
    coApplicants: [{ firstName: "Alex", lastName: "Dittrich", relationship: "Child", phone: null, email: null, dateOfBirth: null, dlNumber: "T540", dlState: "MN", ssn: "987-65-4321" }]
  };
  it("go to the secured channel only, never into capture fields", () => {
    expect(ezlynxSecure(a, undefined)).toEqual([
      { path: "secure:primarycontact.iacrm_socialsecuritynumber", value: "123-45-6789" },
      { path: "secure:primarycontact.iacrm_driverslicense", value: "K011156496702" },
      { path: "secure:contact2.iacrm_socialsecuritynumber", value: "987-65-4321" },
      { path: "secure:contact2.iacrm_driverslicense", value: "T540" }
    ]);
    const text = JSON.stringify(ezlynxFields(a, { "applicant.ssn": "" }));
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("987-65-4321");
    expect(text).not.toContain("K011156496702");
    // "not mapped" means not sent anywhere, not "kept in the capture"
    expect(ezlynxSecure(a, { "applicant.ssn": "" }).map(s => s.path)).not.toContain("secure:primarycontact.iacrm_socialsecuritynumber");
    expect(JSON.stringify(withoutSsn(a))).not.toMatch(/123-45-6789|987-65-4321/);
  });
});

describe("one peek: mapped green, unmapped red", () => {
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
  it("outlines mapped fields green and everything else the capture reads red", () => {
    document.body.innerHTML = `<main>
      <label for="vin">VIN</label><input id="vin" name="vin" value="X">
      <label for="color">Color</label><input id="color" name="color" value="Blue">
      <mat-form-field class="mat-mdc-form-field"><label>Gender</label><mat-select role="combobox"><span class="mat-mdc-select-value-text">Female</span></mat-select></mat-form-field>
    </main>`;
    const r = (globalThis as unknown as { __bettersPortalPeekAll: (a: unknown) => { shown: number; unmapped: number } }).__bettersPortalPeekAll({
      items: [
        { key: "text:vin", label: "Notes: Insured (account)", kind: "mapped" },
        { key: "field:gender", label: "Primary contact: Gender", kind: "mapped" }
      ],
      map: {}, payload: null, pageLabels: []
    });
    expect(r.shown).toBe(2);
    const outline = (id: string) => (document.getElementById(id) as HTMLElement).style.outline;
    expect(outline("vin")).toMatch(/13a10e|rgb\(19, 161, 14\)/);
    expect(outline("color")).toMatch(/d13438|rgb\(209, 52, 56\)/);
    expect(r.unmapped).toBe(1);
  });
});
