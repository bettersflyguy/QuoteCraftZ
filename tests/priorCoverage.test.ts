/** A captured prior policy ("Prior Auto Policy" table) becomes the
 * insured's CRM Prior Coverage record: one per line, carrier and term. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { priorCoverageColumns, priorCoveragesFromCapture } from "@/crm/appCommit";
import { upsertPriorCoverage } from "@/crm/dataverse";
import type { CapturedApplication } from "@/boldpenguin/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };
const f = (section: string, label: string, value: string) => ({ label, value, section, group: "", source: "taught" as const });
const app = { capturedAt: 0, source: { system: "EZLynx", url: "", title: "" }, normalized: {}, fields: [
  f("Prior Auto Policy", "Prior Carrier", "Travelers"),
  f("Prior Auto Policy", "Prior Policy Expiration Date", "12/01/2019"),
  f("Prior Auto Policy", "Prior Liability Limits", "100/300"),
  f("Prior Auto Policy", "Prior Policy Term", "12 Month"),
  f("Prior Auto Policy", "Prior Policy Premium", "$980"),
  f("Prior Auto Policy", "Years with Prior Carrier", "5"),
  f("Prior Auto Policy", "Years with Continuous Coverage", "More than 15"),
  f("New Auto Policy", "New Policy Term", "6 Month"),
  f("Prior Home Policy", "Prior Carrier", "Foremost")
] } as unknown as CapturedApplication;

beforeEach(() => vi.restoreAllMocks());

describe("prior coverage", () => {
  it("one draft per line, from that line's prior table only", () => {
    const drafts = priorCoveragesFromCapture(app);
    expect(drafts.map(d => [d.line, d.carrier])).toEqual([["Auto", "Travelers"], ["Home", "Foremost"]]);
    expect(drafts[0]).toMatchObject({ expirationDate: "12/01/2019", liabilityLimits: "100/300", term: "12 Month", premium: "$980", yearsWithCarrier: "5", yearsContinuous: "More than 15" });
  });

  it("as CRM columns", () => {
    expect(priorCoverageColumns(priorCoveragesFromCapture(app)[0]!, "EZLynx")).toEqual({
      iacrm_name: "Prior Auto Policy - Travelers", iacrm_priorcarriername: "Travelers", iacrm_expirationdate: "2019-12-01",
      iacrm_policyterm: 298400001, iacrm_premium: 980, iacrm_liabilitylimits: "100/300",
      iacrm_yearswithpriorcarrier: "5", iacrm_yearscontinuouscoverage: "More than 15", iacrm_source: "EZLynx"
    });
  });

  it("creates the record with its links, or fills the same term's record", async () => {
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    let existing: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
      const json = method === "GET"
        ? (url.includes("$filter=") ? { value: existing } : { iacrm_name: "Prior Auto Policy - Travelers", iacrm_priorcarriername: "Travelers", iacrm_expirationdate: "2019-12-01", iacrm_liabilitylimits: null, iacrm_premium: 980 })
        : { iacrm_priorcoverageid: "PC1" };
      return { ok: true, status: method === "PATCH" ? 204 : 200, json: async () => json, text: async () => "", headers: new Headers() } as unknown as Response;
    }));
    const values = { iacrm_name: "Prior Auto Policy - Travelers", iacrm_priorcarriername: "Travelers", iacrm_expirationdate: "2019-12-01", iacrm_liabilitylimits: "100/300", iacrm_premium: 980 };
    const made = await upsertPriorCoverage(ENV, { accountId: "A1", opportunityId: "O1", lobId: "L1", carrierId: null, values });
    expect(made).toEqual({ outcome: "created", id: "PC1" });
    const post = calls.find(c => c.method === "POST")!;
    expect(post.url).toContain("iacrm_priorcoverages");
    expect(post.body).toMatchObject({ ...values, "iacrm_AccountId@odata.bind": "/accounts(A1)", "iacrm_OpportunityId@odata.bind": "/opportunities(O1)", "iacrm_LineOfBusinessId@odata.bind": "/iacrm_lineofbusinesses(L1)" });
    expect(decodeURIComponent(calls[0]!.url)).toContain("iacrm_priorcarriername eq 'Travelers' and iacrm_expirationdate eq 2019-12-01");

    // the same line, carrier and expiration: filled where empty, never duplicated
    calls.length = 0;
    existing = [{ iacrm_priorcoverageid: "PC1", _iacrm_opportunityid_value: "O1", _iacrm_lineofbusinessid_value: "L1", _iacrm_carrierid_value: null }];
    const again = await upsertPriorCoverage(ENV, { accountId: "A1", opportunityId: "O1", lobId: "L1", carrierId: null, values });
    expect(again.outcome).toBe("filled");
    expect(calls.some(c => c.method === "POST")).toBe(false);
    expect(calls.find(c => c.method === "PATCH")?.body).toEqual({ iacrm_liabilitylimits: "100/300" });
  });
});
