/** Whole-settings share file: environments, every mapping, carrier matches
 * and preferences out; validated, scoped imports back in. */
import { describe, it, expect, beforeEach, vi } from "vitest";

const store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (k: string | null) => (k === null ? { ...store } : { [k]: store[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o); }),
      remove: vi.fn(async (k: string) => { delete store[k]; })
    }
  }
});

const { applySettings, buildSettingsFile, describeImport, parseSettingsFile } = await import("@/options/settingsBundle");

const DEV = "https://agentcrmdev.crm.dynamics.com";
const PROD = "https://bettersinsurance.crm.dynamics.com";
const GUID = "0b6f1c2e-1111-4222-8333-444455556666";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store["env/list"] = [
    { id: "dev", name: "DEV", orgUrl: DEV, color: "red" },
    { id: "p1", name: "BINS PROD", orgUrl: PROD, color: "blue", appId: GUID }
  ];
  store["env/active"] = "p1";
  store["portal/fieldMap"] = {
    "https://www8.nowcerts.com": { "pick:#a > span": "crm:account.address1_city", "text:ssn": "secure:primarycontact.iacrm_socialsecuritynumber" },
    "https://app.ezlynx.com": { "text:vin": "note" }
  };
  store["portal/optionMap"] = { "https://app.ezlynx.com": { "contact.educationcode": { Bachelors: 298400006 } } };
  store[`carrier/aliases:${PROD}`] = { 11: GUID };
  store["portal/autoAdvance"] = false;
  store["owner/default:" + PROD] = { id: "someone" };          // per-user pick: never exported
  store["s:secure/pending"] = { x: "123-45-6789" };             // never exported
});

describe("all settings", () => {
  it("exports environments, mappings, data services, carrier matches and preferences only", async () => {
    const file = await buildSettingsFile({ kind: "all" });
    const text = JSON.stringify(file);
    expect(file.environments).toEqual([
      { name: "DEV", orgUrl: DEV, color: "red" },
      { name: "BINS PROD", orgUrl: PROD, color: "blue", appId: GUID }
    ]);
    expect(Object.keys(file.maps).sort()).toEqual(["https://app.ezlynx.com", "https://www8.nowcerts.com"]);
    expect(text).not.toContain("secure:");                     // secured mappings stay local
    // the effective mapping: the applicant and every contact are one Contacts list
    expect(file.dataServices?.["ezlynx"]?.["person.education"]).toBe("crm:contacts[].educationcode");
    expect(file.carrierAliases).toEqual({ [PROD]: { "11": GUID } });
    expect(file.preferences).toEqual({ autoAdvance: false });
    expect(text).not.toContain("someone");
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("env/active");
  });

  it("imports into another machine: environments merge by org URL, everything else lands", async () => {
    const file = JSON.stringify(await buildSettingsFile({ kind: "all" }));
    for (const k of Object.keys(store)) delete store[k];
    store["env/list"] = [{ id: "mine", name: "Prod (mine)", orgUrl: PROD, color: "green" }];
    const parsed = parseSettingsFile(file);
    expect(describeImport(parsed, { kind: "all" }, new Set())).toMatch(/2 environments/);
    expect(await applySettings(parsed, { kind: "all" })).toBe(true);
    const envs = store["env/list"] as { id: string; name: string; orgUrl: string }[];
    expect(envs.map(e => [e.id, e.name])).toEqual([["mine", "BINS PROD"], [expect.stringMatching(/^env_/), "DEV"]]);
    expect(Object.keys(store["portal/fieldMap"] as object).sort()).toEqual(["https://app.ezlynx.com", "https://www8.nowcerts.com"]);
    expect(store[`carrier/aliases:${PROD}`]).toEqual({ "11": GUID });
    expect(store["portal/autoAdvance"]).toBe(false);
  });

  it("refuses bad environments and carrier matches", () => {
    const parsed = parseSettingsFile(JSON.stringify({
      type: "iacrm-quote-connector-fieldmaps", version: 1, maps: {},
      environments: [{ name: "Evil", orgUrl: "https://evil.example.com" }, { name: "OK", orgUrl: `${DEV}/`, color: "purple" }],
      carrierAliases: { [DEV]: { "12": "not-a-guid", "13": GUID }, "https://evil.example.com": { "1": GUID } }
    }));
    expect(parsed.extras.environments).toEqual([{ name: "OK", orgUrl: DEV, color: "blue" }]);
    expect(parsed.extras.carrierAliases).toEqual({ [DEV]: { "13": GUID } });
  });
});

describe("scoped import / export", () => {
  it("one site exports just that site, and imports only that site from a whole-settings file", async () => {
    const site = await buildSettingsFile({ kind: "site", origin: "https://app.ezlynx.com" });
    expect(Object.keys(site.maps)).toEqual(["https://app.ezlynx.com"]);
    expect(site.options).toEqual({ "https://app.ezlynx.com": { "contact.educationcode": { Bachelors: 298400006 } } });
    expect(site.environments).toBeUndefined();

    const whole = parseSettingsFile(JSON.stringify(await buildSettingsFile({ kind: "all" })));
    store["portal/fieldMap"] = {};
    expect(await applySettings(whole, { kind: "site", origin: "https://www8.nowcerts.com" })).toBe(true);
    expect(Object.keys(store["portal/fieldMap"] as object)).toEqual(["https://www8.nowcerts.com"]);
    expect(await applySettings(whole, { kind: "site", origin: "https://other.example.com" })).toBe(false);
  });

  it("the data service scope carries only the data service and its choices", async () => {
    store["portal/optionMap"] = { "dataservice:ezlynx": { "account.iacrm_insuredtype": { Yes: 2, No: 1 } } };
    const ds = await buildSettingsFile({ kind: "dataservice", source: "ezlynx" });
    expect(Object.keys(ds.maps)).toEqual([]);
    expect(Object.keys(ds.dataServices ?? {})).toEqual(["ezlynx"]);
    expect(ds.options).toEqual({ "dataservice:ezlynx": { "account.iacrm_insuredtype": { Yes: 2, No: 1 } } });
  });
});
