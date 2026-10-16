import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { altKeyUrl, executeBatch, getExistingQuoteStatuses, searchAccounts, CrmAccessError,
  phoneFilterVariants, personNameVariants, findInsuredMatches } from "@/crm/dataverse";

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
