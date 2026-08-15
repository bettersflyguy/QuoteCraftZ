import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { altKeyUrl, executeBatch, getExistingQuoteStatuses, searchAccounts, CrmAccessError } from "@/crm/dataverse";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };

beforeEach(() => vi.restoreAllMocks());

describe("altKeyUrl", () => {
  it("addresses the alternate key and escapes single quotes", () => {
    expect(altKeyUrl("ezlynx:1:req")).toBe("iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='ezlynx:1:req')");
    expect(altKeyUrl("o'brien")).toContain("o''brien");
  });
});

describe("executeBatch", () => {
  it("builds multipart batch with continue-on-error and maps per-part statuses by order", async () => {
    const bodyText = [
      "--batchresponse_x", "Content-Type: application/http", "",
      "HTTP/1.1 204 No Content", "", "",
      "--batchresponse_x", "Content-Type: application/http", "",
      "HTTP/1.1 400 Bad Request", "Content-Type: application/json", "",
      JSON.stringify({ error: { message: "lookup invalid" } }),
      "--batchresponse_x--"
    ].join("\r\n");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://org.crm.dynamics.com/api/data/v9.2/$batch");
      expect((init.headers as Record<string, string>)["Prefer"]).toContain("odata.continue-on-error");
      expect(init.body as string).toContain("PATCH https://org.crm.dynamics.com/api/data/v9.2/iacrm_quotes(");
      return { ok: true, status: 200, text: async () => bodyText, headers: new Headers() } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await executeBatch(ENV, [
      { key: "k1", method: "PATCH", url: altKeyUrl("k1"), body: { a: 1 } },
      { key: "k2", method: "PATCH", url: altKeyUrl("k2"), body: { a: 2 } }
    ]);
    expect(results).toEqual([
      { key: "k1", status: 204, error: null },
      { key: "k2", status: 400, error: expect.stringContaining("lookup invalid") }
    ]);
  });

  it("retries once on 429 honoring Retry-After", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, headers: new Headers({ "Retry-After": "0" }), text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => "--b--\r\n", headers: new Headers() } as unknown as Response;
    }));
    await executeBatch(ENV, []);
    expect(calls).toBe(2);
  });
});

describe("CrmAccessError", () => {
  it("raises on 403 with the org attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), headers: new Headers() } as unknown as Response)));
    await expect(searchAccounts(ENV, "Sample", null)).rejects.toThrow(CrmAccessError);
  });
});

describe("getExistingQuoteStatuses", () => {
  it("or-chains keys and maps status by amsexternalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(decodeURIComponent(url)).toContain("iacrm_amsexternalid eq 'ezlynx:1:req' or iacrm_amsexternalid eq 'ezlynx:2:req'");
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ value: [{ iacrm_amsexternalid: "ezlynx:1:req", iacrm_premium_status: 738590002 }] })
      } as unknown as Response;
    }));
    const m = await getExistingQuoteStatuses(ENV, ["ezlynx:1:req", "ezlynx:2:req"]);
    expect(m.get("ezlynx:1:req")).toBe(738590002);
    expect(m.has("ezlynx:2:req")).toBe(false);
  });
});
