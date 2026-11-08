import { describe, it, expect, vi } from "vitest";
import { ensureInsuredData, type AccountEnrichmentState, type EnrichApi } from "@/crm/enrich";
import type { CapturedApplicant } from "@/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

const applicant: CapturedApplicant = {
  ezlynxApplicantId: 1,
  firstName: "Jill",
  lastName: "Kerns",
  dateOfBirth: "1973-04-03",
  dlNumber: "K123456789", dlState: "MN",
  address: { street: "2866 ASPEN LAKE DR NE", city: "BLAINE", state: "MN", postalCode: "55449" },
  phones: [{ type: "Mobile", number: "7632211445" }],
  emails: ["steven.kerns@gmail.com"],
  coApplicants: [{ firstName: "STEVEN", lastName: "KERNS", relationship: "Spouse", phone: null, email: null, dateOfBirth: "1971-06-20", dlNumber: null, dlState: null }],
  isCommercial: false
};

function emptyState(): AccountEnrichmentState {
  return {
    telephone1: null, emailaddress1: null,
    address1_line1: null, address1_city: null, address1_stateorprovince: null, address1_postalcode: null,
    iacrm_mobilephone: null, iacrm_insuredfirstname: null, iacrm_insuredlastname: null,
    primaryContactId: null
  };
}

type TestContact = { contactId: string; firstName: string; lastName: string; email: string | null; mobilePhone: string | null; telephone1: string | null };
const bare = (contactId: string, firstName: string, lastName: string): TestContact =>
  ({ contactId, firstName, lastName, email: null, mobilePhone: null, telephone1: null });

function makeApi(state: AccountEnrichmentState, contacts: TestContact[]) {
  const api = {
    getAccountEnrichmentState: vi.fn(async () => state),
    updateAccount: vi.fn(async (_e: unknown, _id: string, _patch: Record<string, unknown>) => undefined),
    getAccountContacts: vi.fn(async () => contacts),
    contactHasDlColumns: vi.fn(async () => false),
    createContact: vi.fn(
      async (_e: unknown, c: { firstName: string; lastName: string; birthdate: string | null }) => `NEW-${c.firstName}`
    )
  };
  return api as unknown as EnrichApi & typeof api;
}

describe("ensureInsuredData", () => {
  it("fills empty fields incl. custom iacrm_ columns and routes mobile correctly", async () => {
    const api = makeApi(emptyState(), []);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    const patch = api.updateAccount.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch).toMatchObject({
      telephone1: "7632211445",
      iacrm_mobilephone: "7632211445",
      emailaddress1: "steven.kerns@gmail.com",
      address1_city: "BLAINE",
      iacrm_insuredfirstname: "Jill",
      iacrm_insuredlastname: "Kerns"
    });
    expect(r.filledFields).toContain("iacrm_mobilephone");
  });

  it("never overwrites non-empty values", async () => {
    const state = { ...emptyState(), telephone1: "9990001111", address1_city: "EDINA" };
    const api = makeApi(state, [bare("C1", "Jill", "Kerns")]);
    await ensureInsuredData(ENV, "ACC", applicant, api);
    const patch = (api.updateAccount.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    expect(patch["telephone1"]).toBeUndefined();
    expect(patch["address1_city"]).toBeUndefined();
    expect(patch["address1_line1"]).toBe("2866 ASPEN LAKE DR NE"); // still fills what IS empty
  });

  it("matches on exact email regardless of name", async () => {
    const api = makeApi(emptyState(), [
      { ...bare("C1", "Jillian", "Kerns-Smith"), email: "STEVEN.KERNS@GMAIL.COM" }
    ]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).not.toContain("Jill Kerns"); // email matched
  });

  it("matches on first+last+phone all three", async () => {
    const api = makeApi(emptyState(), [
      { ...bare("C1", "JILL", "KERNS"), email: "different@x.com", mobilePhone: "(763) 221-1445" }
    ]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).not.toContain("Jill Kerns"); // name+phone matched (digits-normalized)
  });

  it("does NOT match on name alone when contact data disagrees", async () => {
    const api = makeApi(emptyState(), [
      { ...bare("C1", "Jill", "Kerns"), email: "other.jill@x.com", mobilePhone: "6125550000" }
    ]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).toContain("Jill Kerns"); // same name, different person by data
  });

  it("writes secured DL fields only when the org has the columns", async () => {
    const withCols = makeApi(emptyState(), []);
    (withCols.contactHasDlColumns as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await ensureInsuredData(ENV, "ACC", applicant, withCols);
    const jill = withCols.createContact.mock.calls.map(c => c[1] as Record<string, unknown>).find(c => c["firstName"] === "Jill")!;
    expect(jill["dlNumber"]).toBe("K123456789");

    const withoutCols = makeApi(emptyState(), []);
    await ensureInsuredData(ENV, "ACC", applicant, withoutCols);
    const jill2 = withoutCols.createContact.mock.calls.map(c => c[1] as Record<string, unknown>).find(c => c["firstName"] === "Jill")!;
    expect(jill2["dlNumber"]).toBeNull();
  });

  it("retries contact creation without DL fields when the secured write is rejected", async () => {
    const api = makeApi(emptyState(), []);
    (api.contactHasDlColumns as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    let attempts = 0;
    (api.createContact as ReturnType<typeof vi.fn>).mockImplementation(
      async (_e: unknown, c: { firstName: string; dlNumber?: string | null }) => {
        attempts++;
        if (c.dlNumber) throw new Error("no field security profile");
        return "NEW-" + c.firstName;
      }
    );
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).toContain("Jill Kerns");
    expect(attempts).toBeGreaterThan(2); // rejected secured attempt + stripped retry
  });

  it("carries co-applicant DOB onto the created spouse contact", async () => {
    const api = makeApi(emptyState(), []);
    await ensureInsuredData(ENV, "ACC", applicant, api);
    const spouse = api.createContact.mock.calls
      .map(c => c[1])
      .find(c => c.firstName === "STEVEN");
    expect(spouse?.birthdate).toBe("1971-06-20");
  });

  it("falls back to name-only when neither side has email or phone (re-import safety)", async () => {
    const api = makeApi(emptyState(), [bare("C9", "steven", "kerns")]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).toEqual(["Jill Kerns"]); // co-applicant STEVEN (no data) matched bare steven
    const created = api.createContact.mock.calls[0]![1];
    expect(created).toMatchObject({ mobilePhone: "7632211445", email: "steven.kerns@gmail.com", birthdate: "1973-04-03" });
  });

  it("sets primary contact only when unset", async () => {
    const api = makeApi(emptyState(), []);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.primaryContactSet).toBe(true);
    const patch = api.updateAccount.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch["primarycontactid@odata.bind"]).toBe("/contacts(NEW-Jill)");

    const api2 = makeApi({ ...emptyState(), primaryContactId: "EXISTING" }, [bare("C1", "Jill", "Kerns")]);
    const r2 = await ensureInsuredData(ENV, "ACC", applicant, api2);
    expect(r2.primaryContactSet).toBe(false);
  });

  it("skips the account PATCH entirely when nothing needs filling", async () => {
    const full: AccountEnrichmentState = {
      telephone1: "x", emailaddress1: "x", address1_line1: "x", address1_city: "x",
      address1_stateorprovince: "x", address1_postalcode: "x", iacrm_mobilephone: "x",
      iacrm_insuredfirstname: "x", iacrm_insuredlastname: "x", primaryContactId: "P"
    };
    const api = makeApi(full, [
      { ...bare("C1", "Jill", "Kerns"), mobilePhone: "7632211445" },
      bare("C2", "STEVEN", "KERNS")
    ]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(api.updateAccount).not.toHaveBeenCalled();
    expect(api.createContact).not.toHaveBeenCalled();
    expect(r.filledFields).toEqual([]);
  });
});

describe("captured CRM columns on contacts", () => {
  const withExtra = (extra: Record<string, unknown>): CapturedApplicant => ({
    ...applicant,
    coApplicants: [{ ...applicant.coApplicants[0]!, extra }]
  });

  it("created related contacts receive their columns on create; matched ones are returned for fill-if-empty", async () => {
    const created = makeApi(emptyState(), []);
    const r1 = await ensureInsuredData(ENV, "ACC", withExtra({ address1_city: "Duluth" }), created);
    const steven = created.createContact.mock.calls.map(c => c[1] as { firstName: string; extra?: Record<string, unknown> }).find(c => c.firstName === "STEVEN");
    expect(steven?.extra).toEqual({ address1_city: "Duluth" });
    expect(r1.matchedCoContacts).toEqual([]);
    expect(r1.applicantContactId).toBe("NEW-Jill");

    const matched = makeApi(emptyState(), [bare("C-STEVEN", "STEVEN", "KERNS")]);
    const r2 = await ensureInsuredData(ENV, "ACC", withExtra({ address1_city: "Duluth" }), matched);
    expect(r2.matchedCoContacts).toEqual([{ contactId: "C-STEVEN", extra: { address1_city: "Duluth" } }]);
  });

  it("a column value the CRM rejects never blocks creating the person", async () => {
    const api = makeApi(emptyState(), []);
    api.createContact.mockImplementation(async (_e: unknown, c: { firstName: string; extra?: Record<string, unknown> }) => {
      if (c.extra && Object.keys(c.extra).length) throw new Error("400 bad column value");
      return `NEW-${c.firstName}`;
    });
    const r = await ensureInsuredData(ENV, "ACC", withExtra({ iacrm_badcol: "x" }), api);
    expect(r.contactsCreated).toContain("STEVEN KERNS");
  });
});
