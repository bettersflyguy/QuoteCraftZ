/** ADO 3723: the built-in vehicle "Purchase date" target writes the vehicle's
 * Acquired date (iacrm_acquireddate); the CRM field list says why it is
 * unavailable instead of one generic line. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reset } from "./helpers/chromeStub";
import { routeMessage, realDeps, type Deps } from "@/workerRouter";
import { normalize, VEHICLE_PURCHASE_COLUMN } from "@/boldpenguin/normalize";
import { crmGroup } from "@/crm/appCommit";
import { PATH_LABEL, MAP_PATH_GROUPS, isRoutablePath, toRowTarget, rowTargetOf, isDataServiceTarget } from "@/portal/fieldMaps";
import { buildFieldCatalog, coerceGroup, type FieldCatalog, type RawAttribute } from "@/crm/fieldCatalog";
import { catalogUnavailableNote, classifyCatalogError, ROLE_TASK } from "@/crm/catalogNote";
import type { CrmEnvironment } from "@/crm/environments";
import type { CapturedApplication } from "@/boldpenguin/types";
import starter from "../public/mappings/quotecraftz-ezlynx-mappings.json";

beforeEach(() => reset());

const field = (label: string, value: string, mapped: string, row = "Row 1") =>
  ({ label, value, section: "Auto: Vehicles", group: row, source: "taught" as const, mapped });

describe("built-in vehicle Purchase date target", () => {
  it("is a named built-in target with a row form", () => {
    expect(PATH_LABEL.get("vehicles[].purchaseDate")).toBe("Vehicle purchase date");
    expect(MAP_PATH_GROUPS.flatMap(g => g.paths).some(p => p.path === "vehicles[].purchaseDate")).toBe(true);
    expect(toRowTarget("vehicles[].purchaseDate", 2)).toBe("vehicle2.purchaseDate");
    expect(rowTargetOf("vehicle2.purchaseDate")).toEqual({ arrayPath: "vehicles[].purchaseDate", row: 2 });
    expect(isRoutablePath("vehicle2.purchaseDate")).toBe(true);
    expect(isDataServiceTarget("vehicles[].purchaseDate")).toBe(true);
  });

  it("routes to iacrm_acquireddate on that vehicle's own row", () => {
    expect(VEHICLE_PURCHASE_COLUMN).toBe("iacrm_acquireddate");
    const n = normalize([
      field("VIN", "1FTEW1EP5KFA00001", "crm:vehicle1.iacrm_vin"),
      field("Purchase Date", "05/14/2020", "vehicle1.purchaseDate"),
      field("Purchase Date", "2021-08-01", "vehicle2.purchaseDate", "Row 2")
    ]);
    expect(n["crm:vehicle1"]).toEqual({ iacrm_vin: "1FTEW1EP5KFA00001", iacrm_acquireddate: "05/14/2020" });
    expect(n["crm:vehicle2"]).toEqual({ iacrm_acquireddate: "2021-08-01" });
  });

  it("with no date captured, writes nothing for it", () => {
    const n = normalize([
      field("VIN", "1FTEW1EP5KFA00001", "crm:vehicle1.iacrm_vin"),
      field("Purchase Date", "", "vehicle1.purchaseDate")
    ]);
    expect(n["crm:vehicle1"]).toEqual({ iacrm_vin: "1FTEW1EP5KFA00001" });
    expect(normalize([field("Purchase Date", "  ", "vehicle1.purchaseDate")])["crm:vehicle1"]).toBeUndefined();
  });

  it("an explicit crm column mapping for the same vehicle wins over the built-in", () => {
    const n = normalize([
      field("Purchase Date", "05/14/2020", "crm:vehicle1.iacrm_acquireddate"),
      field("Bought", "01/01/1999", "vehicle1.purchaseDate")
    ]);
    expect(n["crm:vehicle1"]!["iacrm_acquireddate"]).toBe("05/14/2020");
  });

  it("is the default mapping for the EZLynx Vehicles step's Purchase Date", () => {
    const map = starter.maps["https://app.ezlynx.com"] as Record<string, string>;
    expect(map["field:vehicles|purchase date"]).toBe("vehicles[].purchaseDate");
  });

  it("coerces to the CRM date (US or ISO text), and drops an unreadable one", () => {
    const entity = { key: "vehicles" as const, logical: "iacrm_vehicle", set: "iacrm_vehicles", label: "Vehicles (all rows)", array: true,
      columns: [{ name: "iacrm_acquireddate", label: "Acquired Date", type: "DateTime" as const, dateOnly: true }] };
    expect(coerceGroup(entity, { iacrm_acquireddate: "05/14/2020" })).toEqual({ iacrm_acquireddate: "2020-05-14" });
    expect(coerceGroup(entity, { iacrm_acquireddate: "2021-08-01" })).toEqual({ iacrm_acquireddate: "2021-08-01" });
    expect(coerceGroup(entity, { iacrm_acquireddate: "sometime" })).toEqual({});
  });
});

describe("Load writes the purchase date", () => {
  const catalog: FieldCatalog = { envId: "dev", fetchedAt: Date.now(), entities: [
    { key: "vehicles", logical: "iacrm_vehicle", set: "iacrm_vehicles", label: "Vehicles (all rows)", array: true, columns: [
      { name: "iacrm_vin", label: "VIN", type: "String", maxLength: 17 },
      { name: "iacrm_acquireddate", label: "Acquired Date", type: "DateTime", dateOnly: true }
    ] }
  ] };

  async function load(fields: ReturnType<typeof field>[]) {
    const app = { fields, normalized: normalize(fields) } as unknown as CapturedApplication;
    const upsertAsset = vi.fn(async () => ({ outcome: "created" as const, id: "V-1" }));
    const deps: Deps = {
      ...realDeps,
      getActiveEnvironment: vi.fn(async () => ({ id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" })) as unknown as Deps["getActiveEnvironment"],
      getFieldCatalog: vi.fn(async () => catalog) as unknown as Deps["getFieldCatalog"],
      upsertAsset: upsertAsset as unknown as Deps["upsertAsset"]
    };
    // exactly what the Load step sends for Vehicle 1
    const values = crmGroup(app, "crm:vehicle1");
    const res = values ? await routeMessage({ type: "panel/upsertAsset", asset: "vehicles", accountId: "A-1", values }, deps) : null;
    return { res, upsertAsset };
  }

  it("with a date: the vehicle record gets iacrm_acquireddate as a date", async () => {
    const { res, upsertAsset } = await load([
      field("VIN", "1FTEW1EP5KFA00001", "crm:vehicle1.iacrm_vin"),
      field("Purchase Date", "05/14/2020", "vehicle1.purchaseDate")
    ]);
    expect(res?.ok).toBe(true);
    expect(upsertAsset).toHaveBeenCalledTimes(1);
    expect((upsertAsset.mock.calls[0] as unknown[])[3]).toEqual({ iacrm_vin: "1FTEW1EP5KFA00001", iacrm_acquireddate: "2020-05-14" });
  });

  it("without a date: the vehicle is written without that column", async () => {
    const { upsertAsset } = await load([
      field("VIN", "1FTEW1EP5KFA00001", "crm:vehicle1.iacrm_vin"),
      field("Purchase Date", "", "vehicle1.purchaseDate")
    ]);
    expect((upsertAsset.mock.calls[0] as unknown[])[3]).toEqual({ iacrm_vin: "1FTEW1EP5KFA00001" });
  });

  it("a date alone still loads the vehicle row, and none at all loads nothing", async () => {
    const only = await load([field("Purchase Date", "05/14/2020", "vehicle1.purchaseDate")]);
    expect((only.upsertAsset.mock.calls[0] as unknown[])[3]).toEqual({ iacrm_acquireddate: "2020-05-14" });
    const none = await load([field("Purchase Date", "", "vehicle1.purchaseDate")]);
    expect(none.upsertAsset).not.toHaveBeenCalled();
  });
});

describe("CRM field list unavailable", () => {
  const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;
  const failing = (err: Error) => ({ dvJson: async <T,>(): Promise<T> => { throw err; } });
  const named = (name: string, extra: object = {}) => Object.assign(new Error("x"), { name }, extra);

  it("a 403 on every table is a missing security role and points at Task 3704", async () => {
    const c = await buildFieldCatalog(env, failing(named("CrmAccessError", { status: 403 })));
    expect(c.entities).toEqual([]);
    expect(c.unavailable).toEqual({ kind: "role", status: 403 });
    const note = catalogUnavailableNote(c.unavailable);
    expect(note).toContain(ROLE_TASK);
    expect(note).toContain("Showing built-in targets.");
  });

  it("separates a rejected sign-in, a missing sign-in and any other failure", async () => {
    expect((await buildFieldCatalog(env, failing(named("CrmAccessError", { status: 401 })))).unavailable).toEqual({ kind: "rejected", status: 401 });
    expect((await buildFieldCatalog(env, failing(named("AuthRequiredError")))).unavailable).toEqual({ kind: "signin" });
    const other = (await buildFieldCatalog(env, failing(new Error("Dataverse 500 for EntityDefinitions")))).unavailable;
    expect(other).toEqual({ kind: "other", detail: "Dataverse 500 for EntityDefinitions" });
    expect(catalogUnavailableNote({ kind: "signin" })).toContain("sign in to the CRM");
    expect(catalogUnavailableNote({ kind: "rejected", status: 401 })).toContain("401");
    expect(catalogUnavailableNote(other)).toContain("Dataverse 500");
    expect(catalogUnavailableNote(undefined)).toContain("returned no fields");
    expect(classifyCatalogError(undefined)).toEqual({ kind: "other", detail: "" });
  });

  it("when only some tables fail the catalog is usable and carries no reason", async () => {
    const attr = (LogicalName: string, label: string): RawAttribute => ({ LogicalName, AttributeType: "String", IsValidForCreate: true, IsValidForUpdate: true, DisplayName: { UserLocalizedLabel: { Label: label } } });
    const api = { dvJson: async <T,>(_e: CrmEnvironment, path: string): Promise<T> => {
      if (path.startsWith("EntityDefinitions(LogicalName='account')/Attributes?")) return { value: [attr("name", "Account Name")] } as T;
      if (path.includes("Microsoft.Dynamics.CRM.")) return { value: [] } as T;
      throw named("CrmAccessError", { status: 403 });
    } };
    const c = await buildFieldCatalog(env, api);
    expect(c.entities.map(e => e.key)).toEqual(["account"]);
    expect(c.unavailable).toBeUndefined();
  });

  it("the worker returns the reason with an empty catalog instead of failing", async () => {
    const deps: Deps = {
      ...realDeps,
      getActiveEnvironment: vi.fn(async () => env) as unknown as Deps["getActiveEnvironment"],
      getFieldCatalog: vi.fn(async () => { throw named("CrmAccessError", { status: 403 }); }) as unknown as Deps["getFieldCatalog"]
    };
    const r = await routeMessage({ type: "panel/crmFieldCatalog" }, deps);
    expect(r.ok).toBe(true);
    expect((r as { data: FieldCatalog }).data.unavailable).toEqual({ kind: "role", status: 403 });
    expect((r as { data: FieldCatalog }).data.entities).toEqual([]);
  });

  it("the new wording has no em or en dashes", () => {
    const all = [{ kind: "signin" as const }, { kind: "rejected" as const, status: 401 as const }, { kind: "role" as const, status: 403 as const }, { kind: "other" as const, detail: "d" }, undefined]
      .map(r => catalogUnavailableNote(r)).join("");
    expect(/[\u2013\u2014]/.test(all)).toBe(false);
  });
});
