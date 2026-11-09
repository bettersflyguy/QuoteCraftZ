/** The applicant's addresses belong to the applicant: each row is an
 * address on THEIR contact record (row 1 = the contact's Address 1). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { upsertRecordAddress } from "@/crm/dataverse";
import { ezlynxFields } from "@/sources/ezlynxSource";
import { normalizeApplicant } from "@/ezlynx/normalize";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };
beforeEach(() => vi.restoreAllMocks());

describe("address owner", () => {
  it("a new address is created on the person's contact", async () => {
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
      return { ok: true, status: 200, json: async () => (method === "GET" ? { value: [] } : { customeraddressid: "A4" }), text: async () => "", headers: new Headers() } as unknown as Response;
    }));
    expect((await upsertRecordAddress(ENV, "contact", "C1", 4, { line1: "18833 96th Ave N" })).outcome).toBe("created");
    const post = calls.find(c => c.method === "POST")!;
    expect(post.body).toMatchObject({ line1: "18833 96th Ave N", addressnumber: 4, "parentid_contact@odata.bind": "/contacts(C1)" });
  });

  it("each address row names whose it is", () => {
    const fields = ezlynxFields(normalizeApplicant({
      id: 1, firstName: "Tracy", lastName: "Dittrich",
      primaryAddress: { type: { name: "Home" }, address1: "7901 120TH AVE N", city: "CHAMPLIN", state: "MN", postalCode: "55316" },
      addresses: [{ type: { name: "Other" }, address1: "18833 96th Avenue North", city: "Maple Grove", state: "MN", postalCode: "55369" }]
    }), undefined);
    const rows = fields.filter(f => f.section === "Addresses" && f.label === "Person").map(f => [f.group, f.value]);
    expect(rows).toEqual([["Row 1", "Tracy Dittrich"], ["Row 2", "Tracy Dittrich"]]);
    expect(fields.find(f => f.section === "Addresses" && f.group === "Row 2" && f.label === "Street address")?.mapped).toBe("crm:address2.line1");
  });
});
