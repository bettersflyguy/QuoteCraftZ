import { describe, it, expect, vi } from "vitest";
import { ensureInsuredData, type AccountEnrichmentState, type EnrichApi } from "@/crm/enrich";
import type { CapturedApplicant } from "@/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

const applicant: CapturedApplicant = {
  ezlynxApplicantId: 1,
  firstName: "Jill",
  lastName: "Kerns",
  dateOfBirth: "1973-04-03",
  address: { street: "2866 ASPEN LAKE DR NE", city: "BLAINE", state: "MN", postalCode: "55449" },
  phones: [{ type: "Mobile", number: "7632211445" }],
  emails: ["steven.kerns@gmail.com"],
  coApplicants: [{ firstName: "STEVEN", lastName: "KERNS", relationship: "Spouse" }],
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

function makeApi(state: AccountEnrichmentState, contacts: { contactId: string; firstName: string; lastName: string }[]) {
  const api = {
    getAccountEnrichmentState: vi.fn(async () => state),
    updateAccount: vi.fn(async (_e: unknown, _id: string, _patch: Record<string, unknown>) => undefined),
    getAccountContacts: vi.fn(async () => contacts),
    createContact: vi.fn(async (_e: unknown, c: { firstName: string }) => `NEW-${c.firstName}`)
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
    const api = makeApi(state, [{ contactId: "C1", firstName: "Jill", lastName: "Kerns" }]);
    await ensureInsuredData(ENV, "ACC", applicant, api);
    const patch = (api.updateAccount.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    expect(patch["telephone1"]).toBeUndefined();
    expect(patch["address1_city"]).toBeUndefined();
    expect(patch["address1_line1"]).toBe("2866 ASPEN LAKE DR NE"); // still fills what IS empty
  });

  it("creates applicant + co-applicant contacts, skipping case-insensitive matches", async () => {
    const api = makeApi(emptyState(), [{ contactId: "C9", firstName: "steven", lastName: "kerns" }]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.contactsCreated).toEqual(["Jill Kerns"]); // STEVEN KERNS matched existing steven kerns
    const created = api.createContact.mock.calls[0]![1];
    expect(created).toMatchObject({ mobilePhone: "7632211445", email: "steven.kerns@gmail.com", birthdate: "1973-04-03" });
  });

  it("sets primary contact only when unset", async () => {
    const api = makeApi(emptyState(), []);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(r.primaryContactSet).toBe(true);
    const patch = api.updateAccount.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch["primarycontactid@odata.bind"]).toBe("/contacts(NEW-Jill)");

    const api2 = makeApi({ ...emptyState(), primaryContactId: "EXISTING" }, [{ contactId: "C1", firstName: "Jill", lastName: "Kerns" }]);
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
      { contactId: "C1", firstName: "Jill", lastName: "Kerns" },
      { contactId: "C2", firstName: "STEVEN", lastName: "KERNS" }
    ]);
    const r = await ensureInsuredData(ENV, "ACC", applicant, api);
    expect(api.updateAccount).not.toHaveBeenCalled();
    expect(api.createContact).not.toHaveBeenCalled();
    expect(r.filledFields).toEqual([]);
  });
});
