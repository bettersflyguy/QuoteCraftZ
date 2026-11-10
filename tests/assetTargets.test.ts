/** The insured's assets and the records on them are mapping targets: lists
 * whose rows fan into one record each. */
import { describe, it, expect } from "vitest";
import { isCrmTarget, isRoutablePath, toRowTarget, rowTargetOf } from "@/portal/fieldMaps";
import { CATALOG_ENTITIES, slotEntityKey } from "@/crm/fieldCatalog";
import { columnKeyOf, entityKeyOf } from "@/portal/optionMaps";
import { assetName } from "@/crm/dataverse";
import { rowSections } from "@/crm/appCommit";
import type { CapturedApplication } from "@/boldpenguin/types";

const LISTS: [string, string, string][] = [
  ["vehicles", "vehicle", "iacrm_vehicle"], ["watercraft", "watercraft", "iacrm_watercraft"],
  ["properties", "property", "iacrm_property"], ["equipment", "equipment", "iacrm_equipment"],
  ["scheduleditems", "scheduleditem", "iacrm_scheduleditem"], ["additionalinterests", "additionalinterest", "iacrm_additionalinterest"],
  ["propertyrenovations", "propertyrenovation", "iacrm_propertyrenovation"], ["propertylosses", "propertyloss", "iacrm_propertyloss"],
  ["propertyparties", "propertyparty", "iacrm_propertyparty"]
];

describe("asset mapping targets", () => {
  it.each(LISTS)("%s: a list whose rows are its records", (key, slot, logical) => {
    expect(CATALOG_ENTITIES.find(e => e.key === key)).toMatchObject({ logical, array: true });
    expect(isCrmTarget(`crm:${key}[].iacrm_name`)).toBe(true);
    expect(toRowTarget(`crm:${key}[].iacrm_name`, 2)).toBe(`crm:${slot}2.iacrm_name`);
    expect(rowTargetOf(`crm:${slot}2.iacrm_name`)).toEqual({ arrayPath: `crm:${key}[].iacrm_name`, row: 2 });
    expect(isRoutablePath(`crm:${slot}2.iacrm_name`)).toBe(true);
    expect(slotEntityKey(slot)).toBe(key);
    expect(entityKeyOf(`crm:${slot}3.iacrm_name`)).toBe(key);
    expect(columnKeyOf(`crm:${slot}3.iacrm_name`)).toBe(`${logical}.iacrm_name`);
  });

  it("a property row and a policy row never collide", () => {
    expect(isRoutablePath("crm:property1.iacrm_yearbuilt")).toBe(true);
    expect(entityKeyOf("crm:policy1.iacrm_premium")).toBe("policies");
    expect(entityKeyOf("crm:propertyloss1.iacrm_name")).toBe("propertylosses");
  });

  it("names an asset with no name mapped", () => {
    expect(assetName({ iacrm_year: 2019, iacrm_make: "Honda", iacrm_model: "Civic" }, "Vehicle")).toBe("2019 Honda Civic");
    expect(assetName({ iacrm_addressline1: "7901 120th Ave N" }, "Property")).toBe("7901 120th Ave N");
    expect(assetName({}, "Renovation 1")).toBe("Renovation 1");
  });

  it("knows which page a row came from", () => {
    const app = { fields: [
      { label: "VIN", value: "X", section: "Vehicles", group: "Row 1", source: "taught", mapped: "crm:vehicle1.iacrm_vin" },
      { label: "Lienholder", value: "Bank", section: "Vehicles", group: "Row 1", source: "taught", mapped: "crm:additionalinterest1.iacrm_name" }
    ] } as unknown as CapturedApplication;
    expect([...rowSections(app, "crm:additionalinterest1")]).toEqual(["Vehicles"]);
  });
});
