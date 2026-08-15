import { describe, it, expect } from "vitest";
import { renderCoverageSummary } from "@/ezlynx/renderCoverage";

describe("renderCoverageSummary", () => {
  it("renders Home from homeCoveragePremiums then endorsementPremiums, three segments", () => {
    const out = renderCoverageSummary({
      homeCoveragePremiums: [
        { code: "A", name: "Dwelling", limits: "$606,900", amountText: "$4,751.00" },
        { code: "B", name: "OtherStructures", limits: "$60,690", amountText: "INCLUDED" }
      ],
      endorsementPremiums: [
        { name: "IdentityTheft", limits: "INCLUDED", amountText: "$45" }
      ]
    }, "Home");
    expect(out).toBe("Cov A: $606,900: $4,751.00\nCov B: $60,690: INCLUDED\nIdentityTheft: INCLUDED: $45");
  });

  it("renders Auto from coverages[], two segments", () => {
    const out = renderCoverageSummary({
      coverages: [ { name: "BI", value: "500 CSL" }, { name: "PD", value: "No Coverage" } ]
    }, "Auto");
    expect(out).toBe("BI: 500 CSL\nPD: No Coverage");
  });

  it("passes values through verbatim - no currency normalization", () => {
    for (const v of ["$606,900", "$606900", "606900", "1%", "BASIC+10K MED EXP"]) {
      const out = renderCoverageSummary({ coverages: [{ name: "X", value: v }] }, "Auto");
      expect(out).toBe(`X: ${v}`);
    }
  });

  it("falls back to coverages[] for Home when homeCoveragePremiums is empty", () => {
    const out = renderCoverageSummary({
      homeCoveragePremiums: [],
      coverages: [ { name: "Dwelling", value: "$606,900" } ]
    }, "Home");
    expect(out).toBe("Dwelling: $606,900");
  });

  it("truncates on a line boundary with trailing ellipsis near the 5000 cap", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ name: `Coverage${i}`, value: "x".repeat(20) }));
    const out = renderCoverageSummary({ coverages: many }, "Auto");
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("\n") || !out.includes("\u0000")).toBe(true);
  });
});
