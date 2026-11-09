/** The applicant and every contact are ONE Contacts list (row 1 = the
 * applicant); the account's primary contact is a choice at load, never a
 * silent change to an account that already has one. */
import { describe, it, expect, vi } from "vitest";
import { ensureInsuredData, type AccountEnrichmentState, type EnrichApi } from "@/crm/enrich";
import { effectiveTargets, ezlynxFields, ezlynxSecure } from "@/sources/ezlynxSource";
import { normalizeApplicant } from "@/ezlynx/normalize";
import { normalize } from "@/boldpenguin/normalize";
import { buildTimelineNote, contactAddressOf, otherLine, primarySlots } from "@/crm/appCommit";
import { captureSheets } from "@/panel/captureSheets";
import type { CapturedApplication } from "@/boldpenguin/types";
import type { CapturedApplicant } from "@/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

describe("saved mappings carry over to the merged list", () => {
  it("the applicant's mapping wins and applies to every person", () => {
    const t = effectiveTargets({
      "applicant.gender": "crm:primarycontact.gendercode",
      "coApplicant.gender": "note",
      "applicant.maidenName": "note:contact",
      "coApplicant.relationship": "crm:contacts[].iacrm_role",
      "applicant.firstName": "contact.firstName",
      "applicant.city": ""
    });
    expect(t["person.gender"]).toBe("crm:contacts[].gendercode");
    expect(t["person.maidenName"]).toBe("note:contacts[]");
    expect(t["person.relationship"]).toBe("crm:contacts[].iacrm_role");
    expect(t["person.firstName"]).toBe("contacts[].firstName");
    // the account's own fields keep their ids and choices
    expect(t["applicant.city"]).toBe("");
    // a choice made on the merged field itself wins over a legacy one
    expect(effectiveTargets({ "person.gender": "", "applicant.gender": "crm:primarycontact.gendercode" })["person.gender"]).toBe("");
  });
});

describe("one Contacts list", () => {
  const raw = {
    id: 1, firstName: "David", lastName: "Johnson", maidenName: "",
    socialSecurityNumber: "111-22-3333",
    contacts: [{ firstName: "Karen", lastName: "Johnson", maidenName: "Smith", socialSecurityNumber: "444-55-6666", relationship: { name: "Spouse" } }]
  };
  const fields = ezlynxFields(normalizeApplicant(raw), { "person.maidenName": "note:contacts[]" });

  it("row 1 is the applicant on the primary forms, row 2 the first related contact", () => {
    const routed = fields.filter(f => f.section === "Contacts").map(f => [f.group, f.label, f.mapped]);
    expect(routed).toEqual(expect.arrayContaining([
      ["Row 1", "First name", "contact.firstName"], ["Row 2", "First name", "contact2.firstName"],
      ["Row 2", "Maiden name", "note:contact2"]
    ]));
    // each person's own timeline: the applicant's is the primary contact's note
    const own = ezlynxFields(normalizeApplicant({ ...raw, maidenName: "Lee" }), { "person.maidenName": "note:contacts[]" });
    expect(own.find(f => f.group === "Row 1" && f.label === "Maiden name")?.mapped).toBe("note:contact");
  });

  it("secured values go to each person's own record", () => {
    expect(ezlynxSecure(normalizeApplicant(raw), undefined).filter(s => s.path.endsWith("socialsecuritynumber"))).toEqual([
      { path: "secure:primarycontact.iacrm_socialsecuritynumber", value: "111-22-3333" },
      { path: "secure:contact2.iacrm_socialsecuritynumber", value: "444-55-6666" }
    ]);
  });
});

describe("primary contact choice", () => {
  const applicant: CapturedApplicant = {
    ezlynxApplicantId: 1, firstName: "David", lastName: "Johnson", dateOfBirth: null, dlNumber: null, dlState: null,
    address: null, phones: [], emails: [],
    coApplicants: [{ firstName: "Karen", lastName: "Johnson", relationship: "Spouse", phone: null, email: null, dateOfBirth: null, dlNumber: null, dlState: null, slot: 2 }],
    isCommercial: false
  };
  const state = (primaryContactId: string | null): AccountEnrichmentState => ({
    telephone1: null, emailaddress1: null, address1_line1: null, address1_city: null, address1_stateorprovince: null, address1_postalcode: null,
    iacrm_mobilephone: null, iacrm_insuredfirstname: "David", iacrm_insuredlastname: "Johnson", primaryContactId
  });
  const api = (s: AccountEnrichmentState) => {
    const a = {
      getAccountEnrichmentState: vi.fn(async () => s),
      updateAccount: vi.fn(async (_e: unknown, _id: string, _p: Record<string, unknown>) => undefined),
      getAccountContacts: vi.fn(async () => []),
      contactHasDlColumns: vi.fn(async () => false),
      createContact: vi.fn(async (_e: unknown, c: { firstName: string }) => `NEW-${c.firstName}`)
    };
    return a as unknown as EnrichApi & typeof a;
  };
  const primaryOf = (a: ReturnType<typeof api>) =>
    (a.updateAccount.mock.calls[0]?.[2] as Record<string, unknown> | undefined)?.["primarycontactid@odata.bind"];

  it("defaults to the applicant on an account with none", async () => {
    const a = api(state(null));
    await ensureInsuredData(ENV, "ACC", applicant, a);
    expect(primaryOf(a)).toBe("/contacts(NEW-David)");
  });

  it("the agent's pick becomes the primary contact; the named insured stays the applicant", async () => {
    const a = api(state(null));
    await ensureInsuredData(ENV, "ACC", applicant, a, { slot: 2, explicit: true });
    expect(primaryOf(a)).toBe("/contacts(NEW-Karen)");
  });

  it("an existing primary is never changed by default, only by an explicit pick", async () => {
    const kept = api(state("EXISTING"));
    await ensureInsuredData(ENV, "ACC", applicant, kept);
    expect(primaryOf(kept)).toBeUndefined();
    const changed = api(state("EXISTING"));
    await ensureInsuredData(ENV, "ACC", applicant, changed, { slot: 2, explicit: true });
    expect(primaryOf(changed)).toBe("/contacts(NEW-Karen)");
  });
});

describe("a page's contacts list that restates the primary insured", () => {
  it("knows which row is the primary, so its note lands on the primary contact", () => {
    const app = {
      fields: [], capturedAt: 0, source: { system: "x", title: "" },
      normalized: normalize([
        { label: "First name", value: "David", mapped: "contact.firstName" },
        { label: "Last name", value: "Johnson", mapped: "contact.lastName" },
        { label: "Name", value: "David Johnson", mapped: "contact2.fullName" },
        { label: "Name", value: "Karen Johnson", mapped: "contact3.fullName" }
      ])
    } as unknown as CapturedApplication;
    expect(primarySlots(app)).toEqual([2]);
  });
});

describe("the primary row is marked", () => {
  it("Contacts and Addresses tables show which row is the primary", () => {
    const a = normalizeApplicant({
      id: 1, firstName: "Tracy", lastName: "Dittrich",
      primaryAddress: { type: { name: "Home" }, address1: "7901 120TH AVE N", city: "CHAMPLIN", state: "MN", postalCode: "55316" },
      addresses: [{ type: { name: "Other" }, address1: "18833 96th Avenue North", city: "Maple Grove", state: "MN", postalCode: "55369" }],
      contacts: [{ firstName: "Alex", lastName: "Dittrich" }]
    });
    const fields = ezlynxFields(a, undefined);
    const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" }, quotes: [] } as unknown as CapturedApplication;
    const sheet = (name: string) => captureSheets(app).find(s => s.name === name)!;
    expect(sheet("Contacts").columns[0]).toBe("Primary");
    expect(sheet("Contacts").rows.map(r => [r[0], r[1]])).toEqual([["Yes", "Tracy"], ["", "Alex"]]);
    expect(sheet("Addresses").rows.map(r => r[0])).toEqual(["Yes", ""]);
  });
});
describe("the account's address is the primary contact's", () => {
  it("a picked contact's own address is what the review shows for the account", () => {
    const fields = ezlynxFields(normalizeApplicant({
      id: 1, firstName: "David", lastName: "Johnson",
      primaryAddress: { address1: "1 Main St", city: "Champlin", state: "MN", postalCode: "55316" },
      contacts: [{ firstName: "Karen", lastName: "Johnson", primaryAddress: { address1: "9 Lake Rd", city: "Duluth", state: "MN", postalCode: "55802" } }]
    }), undefined);
    const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;
    expect(contactAddressOf(app, 2)).toEqual({ street: "9 Lake Rd", city: "Duluth", state: "MN", postalCode: "55802" });
    expect(contactAddressOf(app, 3)).toBeNull();
  });
});
describe("a form takes a step's value by its policy type", () => {
  it("offers Auto's and Home's prior carrier as separate captured values", async () => {
    const { capturedTargets } = await import("@/panel/capturedTargets");
    const targets = capturedTargets([
      { label: "Prior Carrier", section: "Auto: Policy Info" },
      { label: "Prior Carrier", section: "Home: Policy Info" }
    ]);
    expect(targets.map(t => t.value)).toEqual(["label:prior carrier", "label:auto policy info prior carrier", "label:home policy info prior carrier"]);
    expect(targets[1]!.label).toBe("Auto: Policy Info > Prior Carrier");
  });
});
describe("each line's opportunity gets its own tables", () => {
  it("Auto's prior policy never lands on the Home opportunity", () => {
    const f = (section: string, label: string, value: string) => ({ label, value, section, group: "", source: "taught" as const, mapped: "note:opportunity" });
    const app = { capturedAt: 0, source: { system: "EZLynx", title: "" }, normalized: {}, fields: [
      f("Auto: Policy Info", "Prior Policy Expiration Date", "12/01/2019"),
      f("Home: Policy Info", "Prior Policy Expiration Date", "05/18/2026"),
      f("Coverage", "Notes", "general")
    ] } as unknown as CapturedApplication;
    const auto = buildTimelineNote(app, "opportunity", "Auto")!.html;
    expect(auto).toContain("Auto: Policy Info");
    expect(auto).not.toContain("05/18/2026");
    expect(auto).toContain("general");
    expect(buildTimelineNote(app, "opportunity", "Home")!.html).not.toContain("12-01-2019");
    expect(otherLine("Home: Policy Info", "Homeowners")).toBe(false);
  });
});