// @vitest-environment jsdom
/** OUTPUT direction (fill carrier forms from the capture or the CRM) and the
 * secured pass-through channel. Page scripts are tested as shipped. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFieldMapExport, isFillTarget, parseFieldMapImport, rowTargetOf, toRowTarget
} from "@/portal/fieldMaps";
import { buildFillValues, displayDate } from "@/portal/fillValues";
import { alignRelatedContacts, maskSecure, secureRecordOf, slotNamesOf } from "@/portal/secureFill";
import { catalogLabel, filterColumns, securedColumns, type FieldCatalog, type RawAttribute } from "@/crm/fieldCatalog";
import { buildCrmColumnFields } from "@/crm/crmSource";
import { normalize } from "@/boldpenguin/normalize";
import type { CapturedApplication } from "@/boldpenguin/types";

type G = Record<string, unknown>;
const g = globalThis as unknown as G;

beforeAll(() => {
  // jsdom lacks CSS.escape
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
  };
  for (const f of ["portal-mapper.js", "portal-fill.js", "portal-ingest.js"]) {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
  }
});

const attr = (LogicalName: string, Label: string, extra: Partial<RawAttribute> = {}): RawAttribute =>
  ({ LogicalName, AttributeType: "String", IsValidForCreate: true, IsValidForUpdate: true, DisplayName: { UserLocalizedLabel: { Label } }, ...extra });

describe("row targets", () => {
  it("a form control names one row of a list, and back", () => {
    expect(toRowTarget("contacts[].dateOfBirth", 1)).toBe("contact2.dateOfBirth");
    expect(toRowTarget("vehicles[].vin", 3)).toBe("vehicle3.vin");
    expect(toRowTarget("crm:contacts[].birthdate", 2)).toBe("crm:contact3.birthdate");
    expect(toRowTarget("crm:policies[].iacrm_premium", 1)).toBe("crm:policy1.iacrm_premium");
    expect(toRowTarget("secure:contacts[].iacrm_socialsecuritynumber", 1)).toBe("secure:contact2.iacrm_socialsecuritynumber");
    expect(toRowTarget("contacts[].email", 0)).toBeNull();
    expect(rowTargetOf("crm:contact3.birthdate")).toEqual({ arrayPath: "crm:contacts[].birthdate", row: 2 });
    expect(rowTargetOf("vehicle2.vin")).toEqual({ arrayPath: "vehicles[].vin", row: 2 });
    expect(rowTargetOf("contact.firstName")).toBeNull();
    expect(isFillTarget("crm:contact3.birthdate")).toBe(true);
    expect(isFillTarget("secure:primarycontact.iacrm_socialsecuritynumber")).toBe(true);
    expect(isFillTarget("secure:contacts[].iacrm_socialsecuritynumber")).toBe(false);
  });
});

describe("share files never carry secured mappings", () => {
  it("export strips them and import drops them", () => {
    const maps = { "https://carrier.example.com": {
      "text:ssn": "secure:primarycontact.iacrm_socialsecuritynumber",
      "text:city": "address.city",
      "text:dob2": "contact3.dateOfBirth"
    } };
    expect(buildFieldMapExport(maps).maps["https://carrier.example.com"]).toEqual({ "text:city": "address.city", "text:dob2": "contact3.dateOfBirth" });
    const tampered = JSON.stringify({ ...buildFieldMapExport({}), maps });
    const parsed = parseFieldMapImport(tampered);
    expect(parsed.maps["https://carrier.example.com"]).toEqual({ "text:city": "address.city", "text:dob2": "contact3.dateOfBirth" });
    expect(parsed.secured).toBe(1);
  });
});

describe("secured catalog columns", () => {
  const raw = [
    attr("iacrm_socialsecuritynumber", "Social Security Number", { IsSecured: true }),
    attr("adx_identity_passwordhash", "Password Hash", { IsSecured: true }),
    attr("iacrm_driverslicense", "Drivers License"),
    attr("iacrm_driverslicensestate", "Drivers License State"),
    attr("governmentid", "Government"),
    attr("address1_city", "City")
  ];
  it("identifier columns are secured-only; plumbing never appears", () => {
    expect(securedColumns(raw).map(c => c.name).sort()).toEqual(["governmentid", "iacrm_driverslicense", "iacrm_socialsecuritynumber"]);
    const regular = filterColumns(raw).map(c => c.name);
    expect(regular).toContain("address1_city");
    expect(regular).toContain("iacrm_driverslicensestate");
    expect(regular).not.toContain("iacrm_driverslicense");
    expect(regular).not.toContain("iacrm_socialsecuritynumber");
  });
  it("labels row slots and secured targets", () => {
    const catalog: FieldCatalog = { envId: "e", fetchedAt: 0, entities: [
      { key: "primarycontact", logical: "contact", set: "contacts", label: "Primary contact", array: false,
        columns: [{ name: "birthdate", label: "Birthday", type: "DateTime" }],
        secured: [{ name: "iacrm_socialsecuritynumber", label: "Social Security Number", type: "String" }] },
      { key: "contacts", logical: "contact", set: "contacts", label: "Related contacts (all rows)", array: true,
        columns: [{ name: "birthdate", label: "Birthday", type: "DateTime" }],
        secured: [{ name: "iacrm_socialsecuritynumber", label: "Social Security Number", type: "String" }] }
    ] };
    expect(catalogLabel(catalog, "crm:contact3.birthdate")).toBe("Related contact 2: Birthday");
    expect(catalogLabel(catalog, "secure:primarycontact.iacrm_socialsecuritynumber")).toBe("Secured: Primary contact: Social Security Number");
    expect(catalogLabel(catalog, "secure:contact2.iacrm_socialsecuritynumber")).toBe("Secured: Related contact 1: Social Security Number");
    expect(catalogLabel(catalog, "crm:primarycontact.iacrm_socialsecuritynumber")).toBeNull();
  });
});

function appOf(fields: CapturedApplication["fields"]): CapturedApplication {
  return { schemaVersion: "1.1", fields, normalized: normalize(fields) } as unknown as CapturedApplication;
}

describe("fill values", () => {
  it("names every target the capture holds: CRM columns, row slots, bridges, dates", () => {
    const catalog: FieldCatalog = { envId: "e", fetchedAt: 0, entities: [
      { key: "account", logical: "account", set: "accounts", label: "Insured (account)", array: false,
        columns: [{ name: "address1_county", label: "County", type: "String" }, { name: "address1_city", label: "City", type: "String" }] },
      { key: "contacts", logical: "contact", set: "contacts", label: "Related contacts (all rows)", array: true,
        columns: [{ name: "firstname", label: "First Name", type: "String" }, { name: "lastname", label: "Last Name", type: "String" },
          { name: "birthdate", label: "Birthday", type: "DateTime" }, { name: "gendercode", label: "Gender", type: "Picklist" }] }
    ] };
    const fields = buildCrmColumnFields({
      account: null, contact: null, riskAnswers: [],
      full: {
        account: { address1_county: "Hennepin", address1_city: "Champlin" },
        primary: null,
        related: [{ firstname: "Alexander", lastname: "Dittrich", birthdate: "1999-01-14", gendercode: 1, "gendercode@OData.Community.Display.V1.FormattedValue": "Male" }]
      }
    }, catalog);
    const values = buildFillValues(appOf(fields));
    expect(values["crm:account.address1_county"]).toBe("Hennepin");
    expect(values["address.city"]).toBe("Champlin");                // bridged from the CRM column
    expect(values["crm:contact2.birthdate"]).toBe("1/14/1999");
    expect(values["crm:contact2.gendercode"]).toBe("Male");         // display value, not 1
    expect(values["contact2.firstName"]).toBe("Alexander");          // slot bridge
    expect(Object.keys(values).some(k => k.startsWith("secure:"))).toBe(false);
    expect(displayDate("2026-03-11T05:00:00Z")).toBe("3/11/2026");
  });
});

describe("secured records", () => {
  it("a related-contact slot binds only by name when the capture names it", () => {
    const related = [
      { id: "a", firstName: "Elizabeth", lastName: "Dittrich" },
      { id: "b", firstName: "Alexander", lastName: "Dittrich" }
    ];
    expect(alignRelatedContacts(related, { 2: { firstName: "Alexander", lastName: "Dittrich" }, 3: { firstName: "Zed", lastName: "Nobody" } }))
      .toEqual(["b", ""]);
    expect(alignRelatedContacts(related, {})).toEqual(["a", "b"]);
    const recs = { accountId: "acc", primaryContactId: "pc", relatedContactIds: ["b", ""] };
    expect(secureRecordOf("secure:contact2.iacrm_socialsecuritynumber", recs)).toEqual({ set: "contacts", id: "b", column: "iacrm_socialsecuritynumber" });
    expect(secureRecordOf("secure:contact3.iacrm_socialsecuritynumber", recs)).toBeNull();
    expect(secureRecordOf("secure:primarycontact.governmentid", recs)?.id).toBe("pc");
    expect(slotNamesOf({ contact2: { fullName: "Alexander Dittrich" }, contact: { firstName: "Tracy" } }))
      .toEqual({ 2: { firstName: "Alexander", lastName: "Dittrich" } });
    expect(maskSecure("123-45-6789")).toBe("•••• 6789");
    expect(maskSecure("123")).toBe("••••");
  });
});

describe("page filler", () => {
  const form = () => {
    document.body.innerHTML = `
      <label for="county">County</label><input id="county" name="county" type="text">
      <label for="d2dob">Driver 2 date of birth</label><input id="d2dob" name="d2dob" type="text">
      <label for="ssn">SSN</label><input id="ssn" name="ssn" type="text">
      <label for="ssn2">Social Security Number</label><input id="ssn2" name="ssn2" type="text">`;
  };
  const fill = (p: unknown, ov: unknown) =>
    (g["__bettersPortalFill"] as (p: unknown, o: boolean, a: boolean, ov: unknown) => Promise<Record<string, unknown>>)(p, false, false, ov);

  it("fills any mapped target, holds secured fields for their own pass, never auto-fills an SSN box", async () => {
    form();
    const overrides = {
      "text:county": "crm:account.address1_county",
      "text:d2dob": "crm:contact3.birthdate",
      "text:ssn": "secure:primarycontact.iacrm_socialsecuritynumber"
    };
    const r = await fill({ normalized: {}, fields: [], values: { "crm:account.address1_county": "Hennepin", "crm:contact3.birthdate": "1/19/2007" } }, overrides);
    expect((document.getElementById("county") as HTMLInputElement).value).toBe("Hennepin");
    expect((document.getElementById("d2dob") as HTMLInputElement).value).toBe("1/19/2007");
    expect((document.getElementById("ssn") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("ssn2") as HTMLInputElement).value).toBe("");
    expect(r["secure"]).toEqual([{ key: "text:ssn", path: "secure:primarycontact.iacrm_socialsecuritynumber" }]);
    expect(JSON.stringify(r)).not.toContain("123-45");

    const s = await (g["__bettersPortalFillSecure"] as (v: unknown, o: boolean, ov: unknown) => Promise<{ filled: unknown[]; missing: number }>)(
      { "secure:primarycontact.iacrm_socialsecuritynumber": "123-45-6789" }, false, overrides);
    expect((document.getElementById("ssn") as HTMLInputElement).value).toBe("123-45-6789");
    expect((document.getElementById("ssn2") as HTMLInputElement).value).toBe("");
    expect(s.filled).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain("6789");
  }, 10000);
});

describe("page ingester", () => {
  it("routes mapped controls, sends secured values apart, never captures identifier data", () => {
    document.body.innerHTML = `<main>
      <label for="county">County</label><input id="county" name="county" type="text" value="Hennepin">
      <label for="ssn">SSN</label><input id="ssn" name="ssn" type="text" value="123-45-6789">
      <label for="tin">Social Security Number</label><input id="tin" name="tin" type="text" value="987-65-4321">
      <p id="note">Passport 12345</p></main>`;
    const res = (g["__bettersPortalIngest"] as (t: unknown, c: unknown) => { fields: { label: string; value: string; mapped?: string }[]; secure: { path: string; value: string }[] })(
      [{ selector: "#note", label: "", path: "note" }],
      { "text:county": "crm:account.address1_county", "text:ssn": "secure:primarycontact.iacrm_socialsecuritynumber" });
    expect(res.fields.find(f => f.label === "County")?.mapped).toBe("crm:account.address1_county");
    expect(res.secure).toEqual([{ path: "secure:primarycontact.iacrm_socialsecuritynumber", value: "123-45-6789" }]);
    const all = JSON.stringify(res.fields);
    expect(all).not.toContain("123-45-6789");
    expect(all).not.toContain("987-65-4321");
    expect(all).not.toContain("Passport 12345");
  });

  it("a form field mapped to a timeline note is captured for that note, and never filled", async () => {
    document.body.innerHTML = `<main><label for="vin">VIN</label><input id="vin" name="vin" type="text" value="2FMDK38C09BA65577"></main>`;
    const res = (g["__bettersPortalIngest"] as (t: unknown, c: unknown) => { fields: { label: string; value: string; mapped?: string }[] })(
      [], { "text:vin": "note:opportunity" });
    expect(res.fields.find(f => f.label === "VIN")).toMatchObject({ value: "2FMDK38C09BA65577", mapped: "note:opportunity" });
    (document.getElementById("vin") as HTMLInputElement).value = "";
    const r = await (g["__bettersPortalFill"] as (p: unknown, o: boolean, a: boolean, ov: unknown) => Promise<Record<string, unknown>>)(
      { normalized: {}, fields: [{ label: "VIN", value: "X", section: "", group: "" }], values: {} }, false, false, { "text:vin": "note:opportunity" });
    expect((document.getElementById("vin") as HTMLInputElement).value).toBe("");
    expect(r["noData"]).toEqual([]);
  }, 10000);
});
