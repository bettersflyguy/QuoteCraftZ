import { describe, it, expect } from "vitest";
import { normalizeQuoteResult, normalizeApplicant, normalizeRunList, NormalizeError } from "@/ezlynx/normalize";
import quoteResult from "./fixtures/quote-result.sample.json";
import applicant from "./fixtures/applicant.sample.json";
import recentQuotes from "./fixtures/recent-quotes.sample.json";

const IDS = { Auto: 513228997, Home: 513228998 };

describe("normalizeQuoteResult", () => {
  const { blocks } = normalizeQuoteResult(quoteResult, IDS);

  it("produces one block per LOB with the right applicantQuoteId", () => {
    expect(blocks.map(b => b.lob)).toEqual(["Auto", "Home"]);
    expect(blocks[0]!.applicantQuoteId).toBe(513228997);
  });

  it("keys requested and alternate quotes on execId with suffixes", () => {
    const auto = blocks[0]!;
    const travelers = auto.quotes.filter(q => q.carrierEzlynxId === 13);
    expect(travelers.map(q => q.key).sort()).toEqual(["ezlynx:1892138218:alt0", "ezlynx:1892138218:req"]);
    expect(travelers.find(q => q.kind === "alternate")!.premium).toBe(1798.0);
  });

  it("handles null quoteNumber (Liberty) and duplicate quoteNumber across LOBs (Travelers)", () => {
    const liberty = blocks[0]!.quotes.find(q => q.carrierEzlynxId === 35)!;
    expect(liberty.quoteNumber).toBeNull();
    const travHome = blocks[1]!.quotes.find(q => q.carrierEzlynxId === 13)!;
    expect(travHome.quoteNumber).toBe("0007684600833"); // same number, different key
    expect(travHome.key).toBe("ezlynx:1892138220:req");
  });

  it("maps terms: Hartford 6mo, others 12mo", () => {
    const hartford = blocks[0]!.quotes.find(q => q.carrierEzlynxId === 692)!;
    expect(hartford.termMonths).toBe(6);
  });

  it("collects errored carriers into errors[], writes no quotes for them", () => {
    expect(blocks[0]!.errors).toEqual([
      { carrierName: "Stillwater Property & Casualty", message: expect.stringContaining("FNI0233") }
    ]);
    expect(blocks[1]!.errors.some(e => e.carrierName === "Nationwide Insurance")).toBe(true);
    expect(blocks[0]!.quotes.some(q => q.carrierEzlynxId === 404)).toBe(false);
  });

  it("renders Home coverage from homeCoveragePremiums + endorsements", () => {
    const liberty = blocks[1]!.quotes.find(q => q.carrierEzlynxId === 35)!;
    expect(liberty.coverageSummary).toContain("Cov A: $606,900: $4,751.00");
    expect(liberty.coverageSummary).toContain("IdentityTheft: INCLUDED: $45");
  });

  it("preserves per-quote raw context", () => {
    const q = blocks[0]!.quotes[0]!;
    expect(q.raw).toMatchObject({ lob: "Auto", execId: expect.any(Number) });
  });

  it("throws NormalizeError with payload snippet on shape violation", () => {
    expect(() => normalizeQuoteResult({ not: "an array" }, IDS)).toThrow(NormalizeError);
    try { normalizeQuoteResult({ not: "an array" }, IDS); } catch (e) {
      expect((e as NormalizeError).payloadSnippet).toContain("not");
    }
  });
});

describe("normalizeApplicant", () => {
  it("extracts identity, address, phones, co-applicants", () => {
    const a = normalizeApplicant(applicant);
    expect(a).toEqual({
      ezlynxApplicantId: 219851561,
      firstName: "Alex", lastName: "Sample",
      dateOfBirth: "1949-11-18",
      address: { street: "100 EXAMPLE RD", city: "MOUNDS VIEW", state: "MN", postalCode: "55112" },
      phones: ["6125550100"], emails: [],
      coApplicants: [{ firstName: "Blake", lastName: "Sample", relationship: "Spouse" }],
      isCommercial: false
    });
  });
});

describe("normalizeRunList", () => {
  it("produces one item per run with per-LOB quote ids", () => {
    const items = normalizeRunList(recentQuotes);
    expect(items[0]!.quoteIdsByLob).toEqual([
      { lob: "Auto", applicantQuoteId: 513228997 },
      { lob: "Home", applicantQuoteId: 513228998 }
    ]);
    expect(items[1]!.quoteIdsByLob).toEqual([{ lob: "Auto", applicantQuoteId: 488436332 }]);
  });
});
