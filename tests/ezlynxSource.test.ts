import { describe, it, expect } from "vitest";
import { coveredPageLabels, ezlynxFields, mergeHeldQuotes, quotesFromRun, effectiveTargets } from "@/sources/ezlynxSource";
import { normalize } from "@/boldpenguin/normalize";
import { buildQuoteOps, type CommitPayload } from "@/crm/mapping";
import type { CapturedApplicant, CapturedRun } from "@/types";
import type { HeldQuote } from "@/boldpenguin/types";

const applicant: CapturedApplicant = {
  ezlynxApplicantId: 72815548,
  details: { gender: "Male", maritalStatus: "Separated", occupation: "Nurse - RN", leadSource: "Unknown", county: "Hennepin" },
  firstName: "Tracy", lastName: "Dittrich", dateOfBirth: "1972-03-11",
  dlNumber: "D123", dlState: "MN",
  address: { street: "7901 120TH AVE N", city: "CHAMPLIN", state: "MN", postalCode: "55316" },
  phones: [{ type: "Home", number: "6129867235" }],
  emails: [],
  coApplicants: [
    { firstName: "Alexander", lastName: "Dittrich", relationship: "Child", phone: null, email: "alexdittrich77@gmail.com", dateOfBirth: "1999-01-14", dlNumber: "T540", dlState: "MN" },
    { firstName: "Elizabeth", lastName: "Dittrich", relationship: "Child", phone: null, email: null, dateOfBirth: "2007-01-19", dlNumber: null, dlState: null }
  ],
  isCommercial: false
};

const run: CapturedRun = {
  applicant,
  openApplicationId: 67532821,
  capturedAt: "2026-11-08T18:00:00Z",
  ratedAt: "2026-11-07T14:18:00Z",
  blocks: [{
    lob: "Home", applicantQuoteId: 523608381, icq: null,
    quotes: [
      { key: "ezlynx:1:req", kind: "requested", carrierEzlynxId: 11, carrierName: "Nationwide Insurance", quoteNumber: null, premium: 2285.81, termMonths: 12, coverageSummary: "Cov A: $198000", coverageLines: [], raw: {} },
      { key: "ezlynx:2:alt1", kind: "alternate", carrierEzlynxId: 22, carrierName: "Liberty Mutual (Formerly Safeco)", quoteNumber: null, premium: 2947.03, termMonths: 12, coverageSummary: "Cov A: $198,000", coverageLines: [], raw: {} }
    ],
    errors: [{ carrierName: "Foremost", message: "Carrier Abort: product unavailable" }]
  }]
};

describe("EZLynx data-service source", () => {
  it("routes applicant fields by the default mappings into the shared pipeline", () => {
    const fields = ezlynxFields(applicant, undefined);
    const n = normalize(fields);
    expect(n["contact"]?.["firstName"]).toBe("Tracy");
    expect(n["contact"]?.["lastName"]).toBe("Dittrich");
    expect(n["address"]?.["city"]).toBe("CHAMPLIN");
    // every person is one Contacts table: row 1 the applicant (the primary
    // contact), then the related contacts in their slots
    expect(fields.filter(f => f.section === "Contacts" && f.label === "First name").map(f => [f.group, f.value, f.mapped]))
      .toEqual([["Row 1", "Tracy", "contact.firstName"], ["Row 2", "Alexander", "contact2.firstName"], ["Row 3", "Elizabeth", "contact3.firstName"]]);
    expect(n["contact2"]?.["firstName"]).toBe("Alexander");
    expect(n["contact3"]?.["firstName"]).toBe("Elizabeth");
    // the primary insured's own first name is never taken from a co-applicant
    expect(n["contact"]?.["firstName"]).not.toBe("Alexander");
  });

  it("honors the agent's Settings mappings: CRM columns, notes, or not mapped", () => {
    const fields = ezlynxFields(applicant, {
      "applicant.phone": "crm:account.telephone2",
      "coApplicant.relationship": "note",
      "applicant.city": ""
    });
    expect(fields.find(f => f.label === "Primary phone")?.mapped).toBe("crm:account.telephone2");
    expect(fields.find(f => f.label === "Relationship" && f.group === "Row 2")?.mapped).toBe("note");
    expect(fields.find(f => f.label === "City")?.mapped).toBeUndefined();
    expect(effectiveTargets({ "applicant.city": "" })["applicant.city"]).toBe("");
    expect(effectiveTargets({})["applicant.city"]).toBe("address.city");
  });

  it("holds the run's quotes as Estimated, selected, carriers from remembered aliases", () => {
    const quotes = quotesFromRun(run, { 11: "carrier-guid-nationwide" });
    expect(quotes.map(q => [q.key, q.lob, q.carrierId, q.premiumStatus, q.selected, q.kind])).toEqual([
      ["ezlynx:1:req", "Home", "carrier-guid-nationwide", "estimated", true, "requested"],
      ["ezlynx:2:alt1", "Home", null, "estimated", true, "alternate"]
    ]);
    expect(quotes[0]!.link).toBe("https://app.ezlynx.com/web/account/72815548/rating/quote-results/67532821/523608381");
  });

  it("a newer run replaces the source's quotes but keeps the agent's choices on carried-over quotes", () => {
    const first = quotesFromRun(run, {});
    first[1] = { ...first[1]!, premiumStatus: "firm", selected: false, carrierId: "lm-guid" };
    const portal: HeldQuote = { ...first[0]!, key: "portal:express.nationwide.com", provider: "Portal", source: "express.nationwide.com" };
    const merged = mergeHeldQuotes([...first, portal], [
      quotesFromRun(run, {})[1]!,                                                     // carried over
      { ...quotesFromRun(run, {})[0]!, key: "ezlynx:9:req" }                        // new in this run
    ]);
    expect(merged.map(q => q.key)).toEqual(["portal:express.nationwide.com", "ezlynx:2:alt1", "ezlynx:9:req"]);
    const carried = merged.find(q => q.key === "ezlynx:2:alt1")!;
    expect([carried.premiumStatus, carried.selected, carried.carrierId]).toEqual(["firm", false, "lm-guid"]);
  });
});

describe("premium status on write", () => {
  const payload = (status?: "firm" | "estimated"): CommitPayload => ({
    run, accountId: "acc", quotingMethodId: null,
    blockSelections: { Home: { opportunityId: "opp", lineOfBusinessId: null, desiredEffectiveDate: null } },
    carrierMap: {}, selectedKeys: ["ezlynx:1:req"], ownerId: null, ownerName: null,
    accountCreatedByPanel: false, createdOpportunityIds: [],
    premiumStatusByKey: status ? { "ezlynx:1:req": status } : undefined
  });
  const FIRM = 738590002, ESTIMATED = 738590000;
  it("writes Firm when the agent chose it, Estimated otherwise, never downgrading a CRM Firm", () => {
    expect(buildQuoteOps(payload("firm"), { byKey: new Map(), keyColumn: true })[0]!.body["iacrm_premium_status"]).toBe(FIRM);
    expect(buildQuoteOps(payload("estimated"), { byKey: new Map(), keyColumn: true })[0]!.body["iacrm_premium_status"]).toBe(ESTIMATED);
    expect(buildQuoteOps(payload(), { byKey: new Map(), keyColumn: true })[0]!.body["iacrm_premium_status"]).toBe(ESTIMATED);
    expect(buildQuoteOps(payload("estimated"), { byKey: new Map([["ezlynx:1:req", { id: "Q-1", premiumStatus: FIRM }]]), keyColumn: true })[0]!.body).not.toHaveProperty("iacrm_premium_status");
  });
});

describe("everything the data service returns is listed and captured", () => {
  it("captures detail fields: gender/marital default to CRM, the rest kept unmapped", () => {
    const fields = ezlynxFields(applicant, undefined);
    // the applicant: account-level fields, and their own row 1 of Contacts
    const by = (label: string) => fields.find(f => (f.section === "Insured" || (f.section === "Contacts" && f.group === "Row 1")) && f.label === label);
    // gender/marital go to the CRM columns and still bridge to the
    // semantic fields that drive fill
    expect(by("Gender")?.mapped).toBe("crm:primarycontact.gendercode");
    expect(by("Marital status")?.mapped).toBe("crm:primarycontact.familystatuscode");
    expect(by("Occupation")).toMatchObject({ value: "Nurse - RN", mapped: "crm:primarycontact.iacrm_employmentoccupation" });
    expect(by("County")).toMatchObject({ value: "Hennepin", mapped: "crm:account.address1_county" });
    expect(by("Lead source")?.mapped).toBeUndefined();
    const n = normalize(fields);
    expect(n["contact"]?.["gender"]).toBe("Male");
    expect(n["crm:primarycontact"]?.["gendercode"]).toBe("Male");
  });

  it("reports which on-screen labels mapped service fields cover", () => {
    const labels = coveredPageLabels(undefined);
    // scoped: the applicant's own panel, the primary address inside it, and
    // each contact's panel / the new-contact form
    expect(labels).toEqual(expect.arrayContaining([
      "applicant info>first name", "applicant info>dob", "applicant info/primary address>postal code", "applicant info>gender",
      "co applicant>gender", "#contact>gender", "applicant info/*address>city"
    ]));
    // never unscoped: a contact's Gender or the Other Address City is not the applicant's
    expect(labels).not.toContain("gender");
    expect(labels).not.toContain("city");
    expect(labels).toContain("applicant info>occupation");
    expect(labels).not.toContain("applicant info>lead source");
    expect(coveredPageLabels({ "applicant.leadSource": "note" })).toContain("applicant info>lead source");
  });
});
