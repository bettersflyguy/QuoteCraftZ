/** ADO 3745 research (no fix): why the EZLynx data-service Mappings lookup
 * can show only the six built-in "Contacts (all rows)" targets, and which
 * catalog branch hides a contact choice column such as Driver status or
 * License status. Every test here asserts TODAY's behaviour (0.1.69) so the
 * reproduction is green in CI; a fix is expected to change these tests. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backing, reset } from "./helpers/chromeStub";
import { buildFieldCatalog, filterColumns, getFieldCatalog, type FieldCatalog, type RawAttribute } from "@/crm/fieldCatalog";
import { readFileSync } from "node:fs";
import { MAP_PATH_GROUPS } from "@/portal/fieldMaps";
import type { CrmEnvironment } from "@/crm/environments";

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;
const named = (name: string, extra: object = {}) => Object.assign(new Error("x"), { name }, extra);

const attr = (LogicalName: string, AttributeType: string, label: string, extra: Partial<RawAttribute> = {}): RawAttribute => ({
  LogicalName, AttributeType, IsValidForCreate: true, IsValidForUpdate: true, DisplayName: { UserLocalizedLabel: { Label: label } }, ...extra
});
const opt = (Value: number, label: string | null) => ({ Value, Label: { UserLocalizedLabel: label === null ? null : { Label: label } } });

/** Contact metadata as the panel would read it; the two status columns are
 * HYPOTHETICAL names: the owner's real logical names are still needed. */
const CONTACT_ATTRS = [
  attr("firstname", "String", "First Name"),
  attr("familystatuscode", "Picklist", "Marital Status"),
  attr("iacrm_driverstatus", "Picklist", "Driver status"),
  attr("iacrm_licensestatus", "Picklist", "License status")
];

type Faults = { contactAttributes?: Error; allAttributes?: Error; picklistProbe?: Error; nullOptionLabels?: boolean };

function api(f: Faults = {}) {
  const calls: string[] = [];
  return {
    calls,
    dvJson: async <T,>(_e: CrmEnvironment, path: string): Promise<T> => {
      calls.push(path);
      const contact = path.startsWith("EntityDefinitions(LogicalName='contact')");
      if (path.includes("PicklistAttributeMetadata")) {
        if (f.picklistProbe && contact) throw f.picklistProbe;
        const label = (l: string) => (f.nullOptionLabels ? null : l);
        return { value: CONTACT_ATTRS.filter(a => a.AttributeType === "Picklist").map(a => ({ LogicalName: a.LogicalName, OptionSet: { Options: [opt(1, label("Valid")), opt(2, label("Suspended"))] } })) } as T;
      }
      if (path.includes("Microsoft.Dynamics.CRM.")) return { value: [] } as T;
      if (f.allAttributes) throw f.allAttributes;
      if (contact) { if (f.contactAttributes) throw f.contactAttributes; return { value: CONTACT_ATTRS } as T; }
      if (path.startsWith("EntityDefinitions(LogicalName='account')")) return { value: [attr("name", "String", "Account Name")] } as T;
      if (path.startsWith("EntityDefinitions(LogicalName='iacrm_policy')")) return { value: [attr("iacrm_policynumber", "String", "Policy Number")] } as T;
      throw new Error("no such entity");
    }
  };
}

/** Copy of MapEditor.tsx captureGroups (lines 25-33): the panel modules pull
 * in Fluent UI, which does not load under the Node test environment. */
function captureGroups(catalog: FieldCatalog | null) {
  const riskData = MAP_PATH_GROUPS.filter(g => /risk data/.test(g.group));
  if (!catalog?.entities.length) return MAP_PATH_GROUPS;
  const crm = catalog.entities.map(e => ({
    group: e.label,
    paths: e.columns.map(c => ({ path: `crm:${e.key}${e.array ? "[]" : ""}.${c.name}`, label: c.label }))
  }));
  return [...crm, ...riskData];
}

/** Copy of DataServiceMapEditor.tsx lines 123-133 (inline in a useMemo, not
 * exported): built-in groups merged with the catalog's groups by name. */
function dataServiceGroups(catalog: FieldCatalog | null) {
  const merged = new Map<string, { path: string; label: string }[]>();
  for (const g of [...MAP_PATH_GROUPS, ...(catalog ? captureGroups(catalog) : [])]) {
    const paths = merged.get(g.group) ?? [];
    for (const p of g.paths) if (!paths.some(x => x.path === p.path)) paths.push(p);
    merged.set(g.group, paths);
  }
  return [...merged.entries()].map(([group, paths]) => ({ group, paths }));
}
const contactsGroup = (c: FieldCatalog | null) => dataServiceGroups(c).find(g => g.group === "Contacts (all rows)")!.paths;
const groupNames = (c: FieldCatalog | null) => dataServiceGroups(c).map(g => g.group);
const BUILT_IN_SIX = MAP_PATH_GROUPS.find(g => g.group === "Contacts (all rows)")!.paths.map(p => p.path);

describe("ADO 3745: the copied panel logic still matches the source", () => {
  it("captureGroups and the data-service merge are unchanged, and the data-service editor never shows the catalog reason", () => {
    const mapEditor = readFileSync("src/panel/MapEditor.tsx", "utf8");
    const dse = readFileSync("src/panel/DataServiceMapEditor.tsx", "utf8");
    expect(mapEditor).toContain("if (!catalog?.entities.length) return MAP_PATH_GROUPS;");
    expect(mapEditor).toContain("paths: e.columns.map(c => ({ path: `crm:${e.key}${e.array ? \"[]\" : \"\"}.${c.name}`, label: c.label }))");
    expect(dse).toContain("for (const g of [...MAP_PATH_GROUPS, ...(catalog ? captureGroups(catalog) : [])]) {");
    expect(dse).toContain(".then(setCatalog).catch(() => setCatalog(null));");
    // MapEditor shows catalogUnavailableNote; the EZLynx data-service editor does not
    expect(mapEditor).toContain("catalogUnavailableNote");
    expect(dse).not.toMatch(/unavailable|catalogUnavailableNote/);
  });
});

describe("ADO 3745: Contacts lookup shows only the six built-ins", () => {
  it("baseline: a healthy catalog adds the contact columns, License status and Driver status included", async () => {
    const c = await buildFieldCatalog(env, api());
    const paths = contactsGroup(c).map(p => p.path);
    expect(BUILT_IN_SIX).toHaveLength(6);
    expect(paths.length).toBeGreaterThan(6);
    expect(paths).toContain("crm:contacts[].iacrm_licensestatus");
    expect(paths).toContain("crm:contacts[].iacrm_driverstatus");
  });

  it("cause A: the contact table's Attributes read fails -> both contact entities dropped, no reason, exactly the six built-ins", async () => {
    const c = await buildFieldCatalog(env, api({ contactAttributes: named("CrmAccessError", { status: 403 }) }));
    expect(c.entities.map(e => e.key)).toEqual(["account", "policies"]);   // contacts AND primarycontact gone (shared fetch)
    expect(c.unavailable).toBeUndefined();                                // silent: reason kept only when EVERY table fails
    expect(contactsGroup(c).map(p => p.path)).toEqual(BUILT_IN_SIX);
    // fingerprint: other CRM groups still listed, "Primary contact" is not
    expect(groupNames(c)).toContain("Insured (account)");
    expect(groupNames(c)).not.toContain("Primary contact");
  });

  it("cause B: every table fails (sign-in, 401/403, network) -> empty catalog, exactly the six built-ins, and only built-in groups", async () => {
    const c = await buildFieldCatalog(env, api({ allAttributes: named("CrmAccessError", { status: 403 }) }));
    expect(c.entities).toEqual([]);
    expect(c.unavailable).toEqual({ kind: "role", status: 403 });        // the reason exists, but DataServiceMapEditor never reads it
    expect(contactsGroup(c).map(p => p.path)).toEqual(BUILT_IN_SIX);
    expect(groupNames(c)).toEqual(MAP_PATH_GROUPS.map(g => g.group));
  });

  it("cause C: the panel message itself fails -> line 98 catch sets null -> exactly the six built-ins, no note", () => {
    expect(contactsGroup(null).map(p => p.path)).toEqual(BUILT_IN_SIX);
    expect(groupNames(null)).toEqual(MAP_PATH_GROUPS.map(g => g.group));
  });

  it("not the six-only cause: a failed contact Picklist probe hides EVERY contact choice column (Driver status, License status) but keeps the rest", async () => {
    const c = await buildFieldCatalog(env, api({ picklistProbe: new Error("Dataverse 500") }));
    const paths = contactsGroup(c).map(p => p.path);
    expect(paths).toContain("crm:contacts[].firstname");                   // so the list is longer than six
    expect(paths.length).toBe(7);
    expect(paths).not.toContain("crm:contacts[].iacrm_driverstatus");
    expect(paths).not.toContain("crm:contacts[].iacrm_licensestatus");
    expect(paths).not.toContain("crm:contacts[].familystatuscode");
    expect(c.unavailable).toBeUndefined();
  });

  it("not the six-only cause: option labels without a UserLocalizedLabel (user language) also hide the choice columns", async () => {
    const c = await buildFieldCatalog(env, api({ nullOptionLabels: true }));
    const paths = contactsGroup(c).map(p => p.path);
    expect(paths).toContain("crm:contacts[].firstname");
    expect(paths).not.toContain("crm:contacts[].iacrm_licensestatus");
  });

  it("filter rules: a status column is kept as Picklist, but dropped as a lookup, multi-select, Status type, secured, or unlabeled column", () => {
    const keep = filterColumns([attr("iacrm_licensestatus", "Picklist", "License status"), attr("iacrm_driverstatus", "Picklist", "Driver status")]);
    expect(keep.map(c => c.name).sort()).toEqual(["iacrm_driverstatus", "iacrm_licensestatus"]);
    const drop = filterColumns([
      attr("iacrm_licensestatusid", "Lookup", "License status"),
      attr("iacrm_licensestatus2", "Virtual", "License status"),          // multi-select choice reports AttributeType Virtual
      attr("iacrm_driverstatus2", "Status", "Driver status"),
      attr("iacrm_licensestatus3", "Picklist", "License status", { IsSecured: true }),
      { ...attr("iacrm_licensestatus4", "Picklist", "x"), DisplayName: { UserLocalizedLabel: null } }
    ]);
    expect(drop).toEqual([]);
  });
});

describe("ADO 3745: the 24 h cache and a partial catalog", () => {
  it("a catalog missing the contact tables is cached; served for up to 10 minutes after the contact table recovers, then re-read", async () => {
    let now = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const first = await getFieldCatalog(env, api({ contactAttributes: named("CrmAccessError", { status: 403 }) }));
    expect(first.entities.map(e => e.key)).toEqual(["account", "policies"]);
    expect((backing["crm/fieldCatalog/v7/dev"] as FieldCatalog).entities.map(e => e.key)).toEqual(["account", "policies"]);

    now += 9 * 60 * 1000;                                                // contact read would now work, cache still served
    const healthy = api();
    const second = await getFieldCatalog(env, healthy);
    expect(healthy.calls).toEqual([]);
    expect(contactsGroup(second).map(p => p.path)).toEqual(BUILT_IN_SIX);

    now += 2 * 60 * 1000;                                                // > 10 min: default EZLynx contact targets are missing -> re-read
    const third = await getFieldCatalog(env, healthy);
    expect(healthy.calls.length).toBeGreaterThan(0);
    expect(third.entities.map(e => e.key)).toContain("contacts");
  });

  it("an all-tables-failed catalog is never cached", async () => {
    await getFieldCatalog(env, api({ allAttributes: named("AuthRequiredError") }));
    expect(backing["crm/fieldCatalog/v7/dev"]).toBeUndefined();
  });
});
