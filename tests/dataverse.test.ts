import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { createQuote, executeBatch, findExistingQuotes, quoteWrite, searchAccounts, CrmAccessError,
  phoneFilterVariants, personNameVariants, findInsuredMatches } from "@/crm/dataverse";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };

beforeEach(() => vi.restoreAllMocks());

describe("quoteWrite", () => {
  const body = { iacrm_quote_name: "Q", iacrm_amsexternalid: "never" };
  it("updates a quote already in CRM by its id, and never writes iacrm_amsexternalid", () => {
    const op = quoteWrite("ezlynx:1:req", { byKey: new Map([["ezlynx:1:req", { id: "Q-1", premiumStatus: null }]]), keyColumn: true }, body);
    expect(op).toEqual({ method: "PATCH", url: "iacrm_quotes(Q-1)", body: { iacrm_quote_name: "Q", iacrm_sourcequotekey: "ezlynx:1:req" } });
  });
  it("creates a new quote; no source key until the column exists", () => {
    const op = quoteWrite("ezlynx:2:req", { byKey: new Map(), keyColumn: false }, body);
    expect(op).toEqual({ method: "POST", url: "iacrm_quotes", body: { iacrm_quote_name: "Q" } });
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
      { key: "k1", method: "PATCH", url: "iacrm_quotes(Q-1)", body: { a: 1 } },
      { key: "k2", method: "PATCH", url: "iacrm_quotes(Q-2)", body: { a: 2 } }
    ]);
    expect(results).toEqual([
      { key: "k1", status: 204, error: null, entityId: null },
      { key: "k2", status: 400, error: expect.stringContaining("lookup invalid"), entityId: null }
    ]);
  });

  it("retries once on 429 honoring Retry-After", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, headers: new Headers({ "Retry-After": "0" }), text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => "--b--\r\n", headers: new Headers() } as unknown as Response;
    }));
    // empty op lists short-circuit without a request; use one op to exercise retry
    await executeBatch(ENV, [{ key: "k", method: "PATCH", url: "iacrm_quotes(x)", body: {} }]);
    expect(calls).toBe(2);
  });
});

describe("CrmAccessError", () => {
  it("raises on 403 with the org attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), headers: new Headers() } as unknown as Response)));
    await expect(searchAccounts(ENV, "Sample", null)).rejects.toThrow(CrmAccessError);
  });
});

describe("createOpportunity", () => {
  it("binds LOB via the SCHEMA-cased nav property", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body["iacrm_LineOfBusinessId@odata.bind"]).toBe("/iacrm_lineofbusinesses(LOB-1)");
      expect(body["iacrm_lineofbusinessid@odata.bind"]).toBeUndefined();
      return {
        ok: true, status: 201, headers: new Headers(),
        json: async () => ({ opportunityid: "OPP-1", name: "n", _iacrm_lineofbusinessid_value: "LOB-1" })
      } as unknown as Response;
    }));
    const { createOpportunity } = await import("@/crm/dataverse");
    const opp = await createOpportunity(ENV, "ACC-1", "LOB-1", "n");
    expect(opp.opportunityId).toBe("OPP-1");
  });
});

describe("createOpportunity pipeline binds", () => {
  it("binds pipeline and stage via SCHEMA-cased nav properties when provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body["iacrm_PipelineId@odata.bind"]).toBe("/iacrm_pipelines(PIPE-1)");
      expect(body["iacrm_PipelineStageId@odata.bind"]).toBe("/iacrm_pipelinestages(STAGE-1)");
      return {
        ok: true, status: 201, headers: new Headers(),
        json: async () => ({ opportunityid: "OPP-1", name: "n", _iacrm_lineofbusinessid_value: "LOB-1" })
      } as unknown as Response;
    }));
    const { createOpportunity } = await import("@/crm/dataverse");
    await createOpportunity(ENV, "ACC-1", "LOB-1", "n", "PIPE-1", "STAGE-1");
  });

  it("resolves and binds the lead source when given (Tivly account-path attribution)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("iacrm_leadsources")) {
        expect(decodeURIComponent(url)).toContain("iacrm_leadsource_name eq 'Tivly'");
        return {
          ok: true, status: 200, headers: new Headers(),
          json: async () => ({ value: [{ iacrm_leadsourceid: "SRC-1" }] })
        } as unknown as Response;
      }
      const body = JSON.parse(init.body as string);
      expect(body["iacrm_LeadSourceId@odata.bind"]).toBe("/iacrm_leadsources(SRC-1)");
      return {
        ok: true, status: 201, headers: new Headers(),
        json: async () => ({ opportunityid: "OPP-1", name: "n", _iacrm_lineofbusinessid_value: "LOB-1" })
      } as unknown as Response;
    }));
    const { createOpportunity } = await import("@/crm/dataverse");
    await createOpportunity(ENV, "ACC-1", "LOB-1", "n", null, null, "Tivly");
  });
});

describe("getStagesForLob pipeline selection", () => {
  const pipelines = [
    { iacrm_pipelineid: "P-COM", iacrm_pipeline_name: "Commercial New Business" },
    { iacrm_pipelineid: "P-PER", iacrm_pipeline_name: "Standard Personal Lines" }
  ];
  function stubPipelineFetch() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("_iacrm_defaultforlob_value")) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: [] }) } as unknown as Response;
      }
      if (url.includes("iacrm_pipelines")) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: pipelines }) } as unknown as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: [] }) } as unknown as Response;
    }));
  }

  it("prefers the Commercial pipeline for a commercial LOB (no DefaultForLob set)", async () => {
    stubPipelineFetch();
    const { getStagesForLob } = await import("@/crm/dataverse");
    const r = await getStagesForLob(ENV, "LOB-1", { insuredType: null, lobName: "Commercial Property" });
    expect(r?.pipelineId).toBe("P-COM");
  });

  it("prefers the Personal pipeline for a personal insured when the LOB name is neutral", async () => {
    stubPipelineFetch();
    const { getStagesForLob } = await import("@/crm/dataverse");
    const r = await getStagesForLob(ENV, "LOB-1", { insuredType: 1, lobName: "Homeowners" });
    expect(r?.pipelineId).toBe("P-PER");
  });

  it("falls back to the first active pipeline without any hint", async () => {
    stubPipelineFetch();
    const { getStagesForLob } = await import("@/crm/dataverse");
    const r = await getStagesForLob(ENV, "LOB-1");
    expect(r?.pipelineId).toBe("P-COM");
  });
});

describe("findExistingQuotes", () => {
  const items = [
    { key: "ezlynx:1:req", opportunityId: "OPP-1", name: "Progressive - Auto - 2026-09-01" },
    { key: "ezlynx:2:req", opportunityId: "OPP-1", name: "Safeco - Auto - 2026-09-01" },
    { key: "ezlynx:3:req", opportunityId: "OPP-1", name: "Travelers - Auto - 2026-09-01" }
  ];
  const rows = [
    { iacrm_quoteid: "Q-1", iacrm_sourcequotekey: "ezlynx:1:req", iacrm_premium_status: 738590002 },
    { iacrm_quoteid: "Q-2", iacrm_amsexternalid: "ezlynx:2:req", iacrm_premium_status: null },
    { iacrm_quoteid: "Q-3", _iacrm_opportunityid_value: "opp-1", iacrm_quote_name: "Travelers - Auto - 2026-09-01" }
  ];

  it("matches by source key, then the legacy key, then name on the opportunity (reads only)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      urls.push(decodeURIComponent(url));
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: rows }) } as unknown as Response;
    }));
    const m = await findExistingQuotes(ENV, "EZLynx", items);
    expect(m.keyColumn).toBe(true);
    expect([...m.byKey].map(([k, v]) => [k, v.id, v.premiumStatus])).toEqual([
      ["ezlynx:1:req", "Q-1", 738590002], ["ezlynx:2:req", "Q-2", null], ["ezlynx:3:req", "Q-3", null]
    ]);
    expect(urls[0]).toContain("iacrm_provider eq 'EZLynx'");
    expect(urls[0]).toContain("iacrm_sourcequotekey eq 'ezlynx:1:req'");
  });

  it("works before the CRM deploys the source key column", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(decodeURIComponent(url));
      if (decodeURIComponent(url).includes("iacrm_sourcequotekey")) {
        return { ok: false, status: 400, headers: new Headers(), text: async () => "Could not find a property named 'iacrm_sourcequotekey'" } as unknown as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: rows.slice(1) }) } as unknown as Response;
    }));
    const m = await findExistingQuotes(ENV, "EZLynx", items);
    expect(m.keyColumn).toBe(false);
    expect([...m.byKey.keys()]).toEqual(["ezlynx:2:req", "ezlynx:3:req"]);
    expect(urls).toHaveLength(2);
  });
});

describe("createQuote (carrier portal quotes)", () => {
  it("updates the site's quote already on the opportunity, keeps its Firm, and never writes iacrm_amsexternalid", async () => {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: decodeURIComponent(url), method, ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
      if (method === "GET") {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ value: [
          { iacrm_quoteid: "Q-9", iacrm_amsexternalid: "www.progressive.com:OPP-1", iacrm_premium_status: 738590002 }
        ] }) } as unknown as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ iacrm_quoteid: "Q-9" }) } as unknown as Response;
    }));
    const r = await createQuote(ENV, {
      accountId: "ACC-1", opportunityId: "OPP-1", carrierId: null, lobId: null, name: "Progressive - Tracy Dittrich",
      premium: 1200, coverageSummary: "", effectiveDate: null, sourceUrl: "https://www.progressive.com/quote/1",
      quotingMethodId: null, premiumStatus: "estimated"
    });
    expect(r.quoteId).toBe("Q-9");
    const write = calls.find(c => c.method !== "GET")!;
    expect(write.method).toBe("PATCH");
    expect(write.url).toContain("iacrm_quotes(Q-9)");
    expect(write.body).not.toHaveProperty("iacrm_amsexternalid");
    expect(write.body).not.toHaveProperty("iacrm_premium_status");
    expect(write.body).toMatchObject({ iacrm_sourcequotekey: "www.progressive.com:OPP-1", iacrm_premium: 1200 });
  });
});

describe("duplicate gate matching", () => {
  it("asks for every shape a phone number is plausibly stored in", () => {
    const v = phoneFilterVariants("813-345-7954");
    // the shape the portal gave us, plus the shapes a human or an AMS would have typed
    expect(v).toContain("813-345-7954");
    expect(v).toContain("8133457954");
    expect(v).toContain("(813) 345-7954");
    expect(v).toContain("+18133457954");
  });

  it("strips a leading country code before building variants", () => {
    expect(phoneFilterVariants("+1 813 345 7954")).toContain("(813) 345-7954");
  });

  it("ignores a number too short to identify anybody", () => {
    expect(phoneFilterVariants("911")).toEqual(["911"]);
    expect(phoneFilterVariants(null)).toEqual([]);
  });

  it("looks for the account name in both word orders", () => {
    expect(personNameVariants("Mathew", "Downing")).toEqual(["Mathew Downing", "Downing, Mathew", "Downing Mathew"]);
  });

  it("finds an account whose phone is stored formatted, not as digits", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/accounts")) {
        return new Response(JSON.stringify({ value: [{
          accountid: "acc-1", name: "Downing, Mathew", telephone1: "(813) 345-7954",
          address1_city: "Lakeland", address1_postalcode: "33811"
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await findInsuredMatches(ENV, {
      email: null, phone: "813-345-7954", firstName: "Mathew", lastName: "Downing", businessName: null
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "account", id: "acc-1", matchedBy: "phone" });
  });

  it("still returns matches when the environment has no iacrm_mobilephone column", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/accounts") && u.includes("iacrm_mobilephone")) {
        // what Dataverse says when a custom column is missing from the environment
        return new Response(JSON.stringify({ error: { message: "'Account' entity doesn't contain attribute with Name = 'iacrm_mobilephone'" } }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("/accounts")) {
        return new Response(JSON.stringify({ value: [{ accountid: "acc-2", name: "Mathew Downing", telephone1: "813-345-7954" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await findInsuredMatches(ENV, {
      email: null, phone: "813-345-7954", firstName: "Mathew", lastName: "Downing", businessName: null
    });

    expect(out.map(m => m.id)).toEqual(["acc-2"]);
    expect(seen.some(u => u.includes("iacrm_mobilephone"))).toBe(true);
    expect(seen.some(u => u.includes("/accounts") && !u.includes("iacrm_mobilephone"))).toBe(true);
  });
});
