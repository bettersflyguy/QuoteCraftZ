/** The shipped EZLynx share file (public/mappings): imports cleanly, covers
 * every field the data service returns, and its choices resolve. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildFieldMapExport, fieldKeyOf, isDataServiceTarget, parseFieldMapImport } from "@/portal/fieldMaps";
import { EZLYNX_FIELDS, effectiveTargets, ezlynxFields } from "@/sources/ezlynxSource";
import { translateCapturedChoices } from "@/portal/choiceRouting";
import type { FieldCatalog } from "@/crm/fieldCatalog";
import type { CapturedApplicant } from "@/types";

const file = readFileSync(path.resolve(__dirname, "../public/mappings/quotecraftz-ezlynx-mappings.json"), "utf8");

describe("EZLynx share file", () => {
  const parsed = parseFieldMapImport(file);
  const ez = parsed.dataServices["ezlynx"]!;

  it("carries the EZLynx page fields as labelled-field keys", () => {
    const site = parsed.maps["https://app.ezlynx.com"]!;
    expect(Object.keys(site).length).toBe(62);
    expect(site[fieldKeyOf("Vehicles", "VIN")]).toBe("note");
    expect(site[fieldKeyOf("Vehicles", "# Days/Week")]).toBe("note");
    expect(site[fieldKeyOf("Policy Info", "Prior Carrier")]).toBe("coverage.currentCarrier");
    expect(site[fieldKeyOf("Coverage", "Towing & Labor")]).toBe("note:opportunity");
    expect(Object.keys(site).every(k => k.startsWith("field:"))).toBe(true);
  });

  it("imports every data-service field with a valid target, nothing dropped", () => {
    expect(parsed.dropped).toBe(0);
    expect(Object.keys(ez).sort()).toEqual(EZLYNX_FIELDS.map(f => f.id).sort());
    for (const t of Object.values(ez)) expect(isDataServiceTarget(t)).toBe(true);
    expect(Object.values(ez).some(t => t.startsWith("secure:"))).toBe(false);
    expect(Object.keys(parsed.options["dataservice:ezlynx"] ?? {})).toEqual(expect.arrayContaining(
      ["contact.gendercode", "contact.familystatuscode", "contact.educationcode", "contact.iacrm_role", "account.iacrm_insuredtype"]));
  });

  it("routes an EZLynx applicant to the CRM columns with exact choices", () => {
    const opt = (pairs: [number, string][]) => pairs.map(([value, label]) => ({ value, label }));
    const catalog: FieldCatalog = { envId: "e", fetchedAt: 0, entities: [
      { key: "account", logical: "account", set: "accounts", label: "Insured (account)", array: false,
        columns: [{ name: "iacrm_insuredtype", label: "Insured Type", type: "Picklist", options: opt([[1, "Personal"], [2, "Commercial"]]) }] },
      { key: "primarycontact", logical: "contact", set: "contacts", label: "Primary contact", array: false,
        columns: [{ name: "educationcode", label: "Education", type: "Picklist", options: opt([[298400006, "Bachelors"], [298400008, "PhD"]]) }] },
      { key: "contacts", logical: "contact", set: "contacts", label: "Related contacts (all rows)", array: true,
        columns: [{ name: "iacrm_role", label: "Contact Role", type: "Picklist", options: opt([[2, "Spouse"], [329910003, "Spouse"], [329910010, "Child"]]) }] }
    ] };
    const a: CapturedApplicant = {
      ezlynxApplicantId: 1, firstName: "Tracy", lastName: "Dittrich", dateOfBirth: "1972-03-11", dlNumber: null, dlState: null,
      address: { street: "7901 120TH AVE N", city: "CHAMPLIN", state: "MN", postalCode: "55316" }, phones: [], emails: [],
      details: { education: "Bachelors", isCommercial: "No", occupation: "Nurse - RN" },
      coApplicants: [{ firstName: "Alexander", lastName: "Dittrich", relationship: "Spouse", phone: null, email: null, dateOfBirth: null, dlNumber: null, dlState: null }],
      isCommercial: false
    };
    const fields = translateCapturedChoices(ezlynxFields(a, ez), parsed.options["dataservice:ezlynx"], catalog);
    const by = (label: string, group = "") => fields.find(f => f.label === label && f.group === group);
    expect(by("Education")).toMatchObject({ mapped: "crm:primarycontact.educationcode", value: "Bachelors" });
    expect(by("Commercial applicant")).toMatchObject({ mapped: "crm:account.iacrm_insuredtype", value: "Personal" });
    expect(by("Occupation")?.mapped).toBe("crm:primarycontact.iacrm_employmentoccupation");
    // "Spouse" is listed twice in the CRM: the file's binding picks the one
    expect(by("Relationship", "Row 1")).toMatchObject({ mapped: "crm:contact2.iacrm_role", value: "Spouse" });
  });

  it("the defaults match the file, so users who never import get the same routes", () => {
    const defaults = effectiveTargets(undefined);
    for (const [id, t] of Object.entries(ez)) {
      if (t.startsWith("crm:") && !["applicant.isCommercial", "coApplicant.relationship", "applicant.unit"].includes(id)) {
        expect(defaults[id], id).toBe(t);
      }
    }
  });

  it("a full Settings export carries the data-service mappings back out", () => {
    const again = parseFieldMapImport(JSON.stringify(buildFieldMapExport({}, parsed.options, parsed.dataServices)));
    expect(again.dataServices).toEqual(parsed.dataServices);
    expect(again.options).toEqual(parsed.options);
  });
});
