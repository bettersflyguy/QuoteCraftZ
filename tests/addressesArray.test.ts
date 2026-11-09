// @vitest-environment jsdom
/** Addresses are a list: every address the source holds becomes one CRM
 * address row (row N = address number N on the account; 1 and 2 are its
 * Address 1 / Address 2, 3+ its More Addresses), from the EZLynx data
 * service or from a page's address cards. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeApplicant } from "@/ezlynx/normalize";
import { ezlynxFields, coveredPageLabels } from "@/sources/ezlynxSource";
import { isCrmTarget, isRoutablePath, rowTargetOf, toRowTarget } from "@/portal/fieldMaps";
import { catalogLabel, type FieldCatalog } from "@/crm/fieldCatalog";
import { normalize } from "@/boldpenguin/normalize";
import { addressRows } from "@/crm/appCommit";
import { familyKeyOf } from "@/portal/fieldMaps";

const raw = {
  id: 1, firstName: "Tracy", lastName: "Dittrich",
  primaryAddress: { type: { id: 1, name: "Home" }, address1: "7901 120TH AVE N", unit: "", address2: "", city: "CHAMPLIN", state: "MN", county: "Hennepin", postalCode: "55316", postalCodeSuffix: "2356", yearsAtAddress: "15", monthsAtAddress: "0" },
  addresses: [
    { type: { id: 4, name: "Other" }, address1: "18833 96th Avenue North", city: "Maple Grove", state: "MN", county: "Hennepin", postalCode: "55369" },
    { type: { id: 2, name: "Mailing" }, address1: "PO Box 12", city: "Champlin", state: "MN", postalCode: "55316" }
  ]
};

describe("EZLynx addresses", () => {
  it("captures every address, the primary first", () => {
    const a = normalizeApplicant(raw);
    expect(a.addresses!.map(x => [x.type, x.street])).toEqual([
      ["Home", "7901 120TH AVE N"], ["Other", "18833 96th Avenue North"], ["Mailing", "PO Box 12"]
    ]);
  });

  it("routes each address to its own CRM address row", () => {
    const fields = ezlynxFields(normalizeApplicant(raw), undefined);
    const routed = Object.fromEntries(fields.filter(f => f.section === "Addresses").map(f => [f.mapped, f.value]));
    expect(routed["crm:address1.line1"]).toBe("7901 120TH AVE N");
    expect(routed["crm:address1.name"]).toBe("Home");
    expect(routed["crm:address2.city"]).toBe("Maple Grove");
    expect(routed["crm:address3.line1"]).toBe("PO Box 12");
    expect(routed["crm:address3.name"]).toBe("Mailing");
    // the applicant's own primary-address fields still feed the account
    expect(fields.find(f => f.mapped === "address.city")?.value).toBe("CHAMPLIN");
    const app = normalize(fields);
    expect(addressRows({ normalized: app as Record<string, unknown> })).toEqual([1, 2, 3]);
  });

  it("covers every address card on the page", () => {
    expect(coveredPageLabels(undefined)).toEqual(expect.arrayContaining(["*address>city", "primary address>city"]));
  });
});

describe("addresses target grammar", () => {
  it("is a list whose rows are address numbers", () => {
    expect(isCrmTarget("crm:addresses[].city")).toBe(true);
    expect(toRowTarget("crm:addresses[].city", 1)).toBe("crm:address1.city");
    expect(toRowTarget("crm:addresses[].city", 3)).toBe("crm:address3.city");
    expect(rowTargetOf("crm:address2.city")).toEqual({ arrayPath: "crm:addresses[].city", row: 2 });
    expect(isRoutablePath("crm:address3.line1")).toBe(true);
  });

  it("row 1 feeds the primary address everywhere else (identity, fill)", () => {
    const app = normalize([{ label: "City", value: "Champlin", mapped: "crm:address1.city" }]);
    expect((app["address"] as Record<string, string>)["city"]).toBe("Champlin");
  });

  it("labels rows as Address N", () => {
    const catalog: FieldCatalog = { envId: "x", fetchedAt: 0, entities: [
      { key: "addresses", logical: "customeraddress", set: "customeraddresses", label: "Addresses (all rows)", array: true, columns: [{ name: "city", label: "City", type: "String" }] }
    ] };
    expect(catalogLabel(catalog, "crm:address3.city")).toBe("Address 3: City");
    expect(catalogLabel(catalog, "crm:addresses[].city")).toBe("Addresses: City");
  });
});

const panel = (title: string, inner: string) =>
  `<mat-expansion-panel><mat-expansion-panel-header><span><mat-panel-title><mat-icon>check_circle</mat-icon> ${title} </mat-panel-title></span></mat-expansion-panel-header><div>${inner}</div></mat-expansion-panel>`;
const field = (label: string, id: string, name: string, value: string) =>
  `<mat-form-field class="mat-mdc-form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${value}"></mat-form-field>`;
const PAGE = `<main>${panel("Applicant Info",
  field("Postal Code", "rating", "postalCode", "55316") +
  panel("Primary Address", field("City", "c1", "addressCity", "CHAMPLIN")) +
  panel("Other Address", field("City", "c2", "addressCity", "Maple Grove")) +
  panel("Mailing Address", field("City", "c3", "addressCity", "Champlin")))}</main>`;

describe("address cards on a page", () => {
  type G = Record<string, (...a: unknown[]) => unknown>;
  const g = globalThis as unknown as G;
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

  it("one card's field mapped to Addresses reads every address card, one row each", () => {
    document.body.innerHTML = PAGE;
    const r = g.__bettersPortalIngest!([{ byLabel: "other address>city", page: "", label: "", path: "crm:addresses[].city", section: "Addresses" }], {}) as
      { fields: { value: string; mapped?: string }[] };
    expect(r.fields.filter(f => f.mapped).map(f => [f.mapped, f.value])).toEqual([
      ["crm:address1.city", "CHAMPLIN"], ["crm:address2.city", "Maple Grove"], ["crm:address3.city", "Champlin"]
    ]);
  });

  it("a control's list mapping becomes that every-card label mapping", () => {
    expect(familyKeyOf({ fieldLabel: "*City", section: "other address" }))
      .toEqual({ key: "field:other address>city", label: "City (every address)" });
    expect(familyKeyOf({ fieldLabel: "Prefix", section: "" })).toBeNull();
  });

  it("the data service's address fields cover every card, not the rating ZIP", () => {
    document.body.innerHTML = PAGE;
    g.__bettersPortalPeekAll!({ items: [], map: {}, payload: null, pageLabels: ["*address>city"] });
    const red = /d13438|rgb\(209, 52, 56\)/;
    const outline = (id: string) => (document.getElementById(id) as HTMLElement).style.outline;
    expect(["c1", "c2", "c3"].map(outline).some(o => red.test(o))).toBe(false);
    expect(outline("rating")).toMatch(red);
    g.__bettersPortalPeekAll!(null);
  });
});
