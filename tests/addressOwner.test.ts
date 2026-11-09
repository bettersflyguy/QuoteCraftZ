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
import { normalize } from "@/boldpenguin/normalize";
import { accountAddressColumns, addressChoices } from "@/crm/appCommit";
import type { CapturedApplication } from "@/boldpenguin/types";

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

  it("every person's addresses share one table, each on its owner's record", () => {
    const fields = ezlynxFields(normalizeApplicant({
      id: 1, firstName: "David", lastName: "Johnson",
      primaryAddress: { type: { name: "Home" }, address1: "1 Main St", city: "Champlin", state: "MN", postalCode: "55316", county: "Hennepin" },
      addresses: [{ type: { name: "Seasonal" }, address1: "5 Cabin Ln", city: "Brainerd", state: "MN", postalCode: "56401" }],
      contacts: [{ firstName: "Karen", lastName: "Johnson", primaryAddress: { type: { name: "Home" }, address1: "9 Lake Rd", city: "Duluth", state: "MN", postalCode: "55802" } }]
    }), undefined);
    const row = (g: string) => Object.fromEntries(fields.filter(f => f.section === "Addresses" && f.group === g).map(f => [f.label, [f.value, f.mapped]]));
    expect(row("Row 1")["Street address"]).toEqual(["1 Main St", "crm:address1.line1"]);
    expect(row("Row 2")["Street address"]).toEqual(["5 Cabin Ln", "crm:address2.line1"]);
    expect(row("Row 3")["Person"]![0]).toBe("Karen Johnson");
    expect(row("Row 3")["Street address"]).toEqual(["9 Lake Rd", "crm:contact2.address1_line1"]);

    // the Load step's Account address picker: any of them, whose it is
    const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;
    const choices = addressChoices(app);
    expect(choices.map(c => [c.person, c.street])).toEqual([
      ["David Johnson", "1 Main St"], ["David Johnson", "5 Cabin Ln"], ["Karen Johnson", "9 Lake Rd"]
    ]);
    expect(accountAddressColumns(choices[2]!)).toMatchObject({ address1_line1: "9 Lake Rd", address1_city: "Duluth", address1_county: "" });
  });
});