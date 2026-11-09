import { describe, it, expect } from "vitest";
import { buildFieldCatalog, catalogLabel, coerce, coerceGroup, filterColumns, type CatalogColumn, type RawAttribute } from "@/crm/fieldCatalog";
import type { CrmEnvironment } from "@/crm/environments";

const attr = (LogicalName: string, AttributeType: string, label: string | null, extra: Partial<RawAttribute> = {}): RawAttribute => ({
  LogicalName, AttributeType, IsValidForCreate: true, IsValidForUpdate: true,
  DisplayName: label === null ? null : { UserLocalizedLabel: { Label: label } }, ...extra
});

describe("CRM column catalog filter", () => {
  it("keeps core writable columns and drops system, GUID, relational, shadow, secured and identifier-class columns", () => {
    const cols = filterColumns([
      attr("address1_city", "String", "Address 1: City"),
      attr("emailaddress1", "String", "Email"),
      attr("iacrm_fein", "String", "FEIN"),                                   // FEIN stays (standing rule)
      attr("numberofemployees", "Integer", "Number of Employees"),
      attr("revenue", "Money", "Annual Revenue"),
      attr("revenue_base", "Money", "Annual Revenue (Base)"),                  // calculated base currency
      attr("accountid", "Uniqueidentifier", "Account", { IsPrimaryId: true }), // GUID
      attr("primarycontactid", "Lookup", "Primary Contact"),                   // relational
      attr("ownerid", "Owner", "Owner"),                                       // relational
      attr("parentcustomeridname", "String", "Parent name", { AttributeOf: "parentcustomerid" }), // shadow
      attr("createdon", "DateTime", "Created On", { IsValidForCreate: false, IsValidForUpdate: false }),
      attr("iacrm_amsexternalid", "String", "AMS External ID"),                // AMS-reserved
      attr("iacrm_ssn", "String", "Social Security Number"),                   // identifier-class
      attr("iacrm_secret", "String", "Secret", { IsSecured: true }),           // field-secured
      attr("versionnumber", "BigInt", "Version Number"),
      attr("governmentid", "String", "Government"),                           // identifier-class
      attr("iacrm_synctoams", "Boolean", "Sync to AMS"),                       // AMS-owned (could trigger a push)
      attr("adx_preferredlcid", "Integer", "Preferred Language"),              // portal plumbing
      attr("nolabel", "String", null)
    ]);
    expect(cols.map(c => c.name).sort()).toEqual(["address1_city", "emailaddress1", "iacrm_fein", "numberofemployees", "revenue"]);
  });
});

describe("value coercion", () => {
  const col = (type: CatalogColumn["type"], extra: Partial<CatalogColumn> = {}): CatalogColumn => ({ name: "x", label: "X", type, ...extra });

  it("coerces each column type and refuses values that don't fit", () => {
    expect(coerce(col("String", { maxLength: 5 }), "Champlin")).toBe("Champ");
    expect(coerce({ ...col("String"), name: "emailaddress1" }, "paperless delivery")).toBeUndefined();
    expect(coerce({ ...col("String"), name: "emailaddress1" }, "a@b.com")).toBe("a@b.com");
    expect(coerce(col("Integer"), "1,250 employees")).toBe(1250);
    expect(coerce(col("Integer"), "none")).toBeUndefined();
    expect(coerce(col("Money"), "$2,693.50")).toBe(2693.5);
    expect(coerce(col("DateTime"), "06/01/2026")).toBe("2026-06-01");
    expect(coerce(col("DateTime"), "2026-12-01T00:00")).toBe("2026-12-01");
    expect(coerce(col("DateTime"), "soon")).toBeUndefined();
    expect(coerce(col("Boolean"), "Yes")).toBe(true);
    expect(coerce(col("Boolean"), "unchecked")).toBe(false);
    expect(coerce(col("Boolean"), "maybe")).toBeUndefined();
    const pick = col("Picklist", { options: [{ value: 1, label: "Personal" }, { value: 2, label: "Commercial" }] });
    expect(coerce(pick, "commercial")).toBe(2);
    expect(coerce(pick, "Farm")).toBeUndefined();
  });

  it("coerceGroup drops unknown columns and invalid values", () => {
    const entity = {
      key: "account" as const, logical: "account", set: "accounts", label: "Insured (account)", array: false,
      columns: [{ name: "address1_city", label: "City", type: "String" as const }, { name: "numberofemployees", label: "Employees", type: "Integer" as const }]
    };
    expect(coerceGroup(entity, { address1_city: "Champlin", numberofemployees: "n/a", iacrm_amsexternalid: "x", evil: "y" }))
      .toEqual({ address1_city: "Champlin" });
    expect(coerceGroup(undefined, { address1_city: "Champlin" })).toEqual({});
  });
});

describe("catalog build", () => {
  it("reads each logical entity once, enriches types, and labels targets", async () => {
    const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;
    const calls: string[] = [];
    const api = {
      dvJson: async <T,>(_e: CrmEnvironment, path: string): Promise<T> => {
        calls.push(path);
        if (path.includes("StringAttributeMetadata")) return { value: [{ LogicalName: "address1_city", MaxLength: 80 }] } as T;
        if (path.includes("PicklistAttributeMetadata")) {
          return { value: [{ LogicalName: "iacrm_insuredtype", OptionSet: { Options: [{ Value: 1, Label: { UserLocalizedLabel: { Label: "Personal" } } }] } }] } as T;
        }
        if (path.includes("Microsoft.Dynamics.CRM.")) return { value: [] } as T;
        if (path.startsWith("EntityDefinitions(LogicalName='account')") || path.startsWith("EntityDefinitions(LogicalName='contact')")) {
          return { value: [attr("address1_city", "String", "Address 1: City"), attr("iacrm_insuredtype", "Picklist", "Insured Type"), attr("statuscode2", "Picklist", "Orphan Picklist")] } as T;
        }
        throw new Error("no such entity");
      }
    };
    const catalog = await buildFieldCatalog(env, api);
    // contact metadata is shared by primary + related contacts: one read
    expect(calls.filter(c => c.startsWith("EntityDefinitions(LogicalName='contact')/Attributes?")).length).toBe(1);
    expect(catalog.entities.map(e => e.key)).toEqual(["account", "primarycontact", "contacts"]);
    const account = catalog.entities[0]!;
    expect(account.columns.find(c => c.name === "address1_city")?.maxLength).toBe(80);
    // a picklist whose options can't be resolved can never take a value - hidden
    expect(account.columns.map(c => c.name)).not.toContain("statuscode2");
    expect(catalogLabel(catalog, "crm:contacts[].address1_city")).toBe("Contacts: Address 1: City");
    expect(catalogLabel(catalog, "crm:account.nope")).toBeNull();
  });
});
