import { describe, it, expect, vi } from "vitest";
import { parseLimitValue, buildCoverageRowBodies, writeCoverageLines, type CoverageApi } from "@/crm/coverage";
import { buildCoverageLines } from "@/ezlynx/renderCoverage";
import type { CapturedQuote } from "@/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

const quote: CapturedQuote = {
  key: "ezlynx:1:req", kind: "requested", carrierEzlynxId: 13, carrierName: "Travelers",
  quoteNumber: null, premium: 100, termMonths: 12, coverageSummary: "x",
  coverageLines: [
    { code: "A", label: "Cov A", limitText: "$606,900" },
    { code: "BI", label: "BI", limitText: "500 CSL" }
  ],
  raw: {}
};

describe("parseLimitValue", () => {
  it("normalizes the three observed currency formats to one number", () => {
    for (const v of ["$606,900", "$606900", "606900"]) expect(parseLimitValue(v)).toBe(606900);
  });
  it("returns null for meaningful non-numerics, preserving them as text only", () => {
    for (const v of ["No Coverage", "INCLUDED", "1%", "500 CSL", "BASIC+10K MED EXP", "One Family"]) {
      expect(parseLimitValue(v)).toBeNull();
    }
  });
});

describe("buildCoverageLines", () => {
  it("Home uses homeCoveragePremiums + endorsements; Auto uses coverages", () => {
    const home = buildCoverageLines({
      homeCoveragePremiums: [{ code: "A", name: "Dwelling", limits: "$1", amountText: "x" }],
      endorsementPremiums: [{ name: "WaterBackup", limits: "INCLUDED", amountText: "$52.09" }]
    }, "Home");
    expect(home).toEqual([
      { code: "A", label: "Cov A", limitText: "$1" },
      { code: "WaterBackup", label: "WaterBackup", limitText: "INCLUDED" }
    ]);
    const auto = buildCoverageLines({ coverages: [{ name: "BI", value: "500 CSL" }] }, "Auto");
    expect(auto).toEqual([{ code: "BI", label: "BI", limitText: "500 CSL" }]);
  });
});

describe("buildCoverageRowBodies", () => {
  it("keys rows off the quote key, binds via the probed nav prop, parses limits", () => {
    const rows = buildCoverageRowBodies(quote, "Q-1", "iacrm_QuoteId");
    expect(rows[0]).toMatchObject({
      iacrm_quotecoverage_name: "Cov A",
      iacrm_coveragecode: "A",
      iacrm_limittext: "$606,900",
      iacrm_limitvalue: 606900,
      iacrm_displayorder: 0,
      iacrm_amsexternalid: "ezlynx:1:req:cov:0",
      "iacrm_QuoteId@odata.bind": "/iacrm_quotes(Q-1)"
    });
    expect(rows[1]!["iacrm_limitvalue"]).toBeUndefined(); // "500 CSL" stays text-only
  });
});

describe("writeCoverageLines", () => {
  it("no-ops with skipped:'no-columns' before the CRM schema is deployed", async () => {
    const api: CoverageApi = {
      getCoverageQuoteNavProp: vi.fn(async () => null),
      getCoverageRowIds: vi.fn(async () => []),
      executeBatch: vi.fn(async () => [])
    };
    const r = await writeCoverageLines(ENV, [{ quote, quoteId: "Q-1" }], api);
    expect(r.skipped).toBe("no-columns");
    expect(api.executeBatch).not.toHaveBeenCalled();
  });

  it("deletes existing rows then creates fresh ones", async () => {
    const batch = vi.fn(async (_e: unknown, ops: { key: string; method: string; url: string }[]) =>
      ops.map(o => ({ key: o.key, status: o.method === "DELETE" ? 204 : 201, error: null, entityId: null }))
    );
    const api = {
      getCoverageQuoteNavProp: vi.fn(async () => "iacrm_QuoteId"),
      getCoverageRowIds: vi.fn(async () => ["OLD-1", "OLD-2"]),
      executeBatch: batch
    } as unknown as CoverageApi;
    const r = await writeCoverageLines(ENV, [{ quote, quoteId: "Q-1" }], api);
    expect(r).toEqual({ quotesCovered: 1, linesWritten: 2, skipped: null });
    const ops = batch.mock.calls[0]![1] as { method: string; url: string }[];
    expect(ops.filter(o => o.method === "DELETE")).toHaveLength(2);
    expect(ops.filter(o => o.method === "POST")).toHaveLength(2);
  });
});
