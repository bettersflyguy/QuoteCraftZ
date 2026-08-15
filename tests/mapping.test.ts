import { describe, it, expect } from "vitest";
import { buildQuoteOps, type CommitPayload } from "@/crm/mapping";
import type { CapturedRun } from "@/types";

const run: CapturedRun = {
  applicant: {
    ezlynxApplicantId: 219851561, firstName: "Alex", lastName: "Sample", dateOfBirth: "1949-11-18",
    address: null, phones: [], emails: [], coApplicants: [], isCommercial: false
  },
  openApplicationId: 199071915,
  capturedAt: "2026-08-15T12:00:00Z",
  blocks: [
    {
      lob: "Auto", applicantQuoteId: 513228997,
      quotes: [
        { key: "ezlynx:1:req", kind: "requested", carrierEzlynxId: 13, carrierName: "Travelers",
          quoteNumber: "Q1", premium: 2273, termMonths: 12, coverageSummary: "BI: 500 CSL", raw: { x: 1 } },
        { key: "ezlynx:1:alt0", kind: "alternate", carrierEzlynxId: 13, carrierName: "Travelers",
          quoteNumber: "Q1", premium: 1798, termMonths: 12, coverageSummary: "BI: 500 CSL", raw: { x: 2 } },
        { key: "ezlynx:2:req", kind: "requested", carrierEzlynxId: 999, carrierName: "Unknown Mutual",
          quoteNumber: null, premium: 1500, termMonths: 6, coverageSummary: "", raw: {} }
      ],
      errors: []
    },
    {
      lob: "Home", applicantQuoteId: 513228998,
      quotes: [
        { key: "ezlynx:3:req", kind: "requested", carrierEzlynxId: 35, carrierName: "Liberty",
          quoteNumber: null, premium: 4744.64, termMonths: 12, coverageSummary: "Cov A: $606,900: $4,751.00", raw: {} }
      ],
      errors: []
    }
  ]
};

const payload: CommitPayload = {
  run,
  accountId: "AAA-1",
  quotingMethodId: "QM-1",
  blockSelections: {
    Auto: { opportunityId: "OPP-AUTO", lineOfBusinessId: "LOB-AUTO", desiredEffectiveDate: "2026-09-01" }
    // Home intentionally unpinned → skipped
  },
  carrierMap: { 13: "CAR-TRAV", 999: null },
  selectedKeys: ["ezlynx:1:req", "ezlynx:1:alt0", "ezlynx:2:req", "ezlynx:3:req"]
};

describe("buildQuoteOps", () => {
  const ops = buildQuoteOps(payload, new Map());

  it("emits one op per selected quote in pinned blocks only (Home skipped)", () => {
    expect(ops.map(o => o.key).sort()).toEqual(["ezlynx:1:alt0", "ezlynx:1:req", "ezlynx:2:req"]);
  });

  it("addresses the alternate key and stamps provider/source/status", () => {
    const op = ops.find(o => o.key === "ezlynx:1:req")!;
    expect(op.url).toBe("iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='ezlynx:1:req')");
    expect(op.body).toMatchObject({
      iacrm_provider: "EZLynx",
      iacrm_amsexternalid: "ezlynx:1:req",
      iacrm_sourcetype: 100000002,
      iacrm_status: 738590002,
      iacrm_premium_status: 738590000,
      iacrm_premium: 2273,
      iacrm_term: 738590205,
      iacrm_effectivedate: "2026-09-01",
      iacrm_expirationdate: "2027-09-01",
      "iacrm_accountid@odata.bind": "/accounts(AAA-1)",
      "iacrm_opportunityid@odata.bind": "/opportunities(OPP-AUTO)",
      "iacrm_lineofbusinessid@odata.bind": "/iacrm_lineofbusinesses(LOB-AUTO)",
      "iacrm_carrierid@odata.bind": "/iacrm_carriers(CAR-TRAV)",
      "iacrm_quotingmethodid@odata.bind": "/iacrm_quotingmethods(QM-1)"
    });
    expect(op.body["iacrm_quotelink"]).toBe(
      "https://app.ezlynx.com/web/account/219851561/rating/quote-results/199071915/513228997"
    );
  });

  it("names quotes {Carrier} - {LOB} - {EffectiveDate}, alternates suffixed", () => {
    expect(ops.find(o => o.key === "ezlynx:1:req")!.body["iacrm_quote_name"]).toBe("Travelers – Auto – 2026-09-01");
    expect(ops.find(o => o.key === "ezlynx:1:alt0")!.body["iacrm_quote_name"]).toBe("Travelers – Auto – 2026-09-01 – Alt");
  });

  it("6-month term maps to 738590203; unmatched carrier omits the bind", () => {
    const op = ops.find(o => o.key === "ezlynx:2:req")!;
    expect(op.body["iacrm_term"]).toBe(738590203);
    expect(op.body["iacrm_carrierid@odata.bind"]).toBeUndefined();
    expect(op.body["iacrm_expirationdate"]).toBe("2027-03-01");
  });

  it("never writes submission fields", () => {
    for (const op of ops) {
      expect(Object.keys(op.body).some(k => k.startsWith("iacrm_submission"))).toBe(false);
    }
  });

  it("omits iacrm_premium_status when the existing row is Firm", () => {
    const opsWithFirm = buildQuoteOps(payload, new Map([["ezlynx:1:req", 738590002]]));
    const firm = opsWithFirm.find(o => o.key === "ezlynx:1:req")!;
    expect("iacrm_premium_status" in firm.body).toBe(false);
    const notFirm = opsWithFirm.find(o => o.key === "ezlynx:1:alt0")!;
    expect(notFirm.body["iacrm_premium_status"]).toBe(738590000);
  });

  it("serializes rawpayload as JSON and honors deselection", () => {
    const fewer = buildQuoteOps({ ...payload, selectedKeys: ["ezlynx:1:req"] }, new Map());
    expect(fewer).toHaveLength(1);
    expect(typeof buildQuoteOps(payload, new Map())[0]!.body["iacrm_rawpayload"]).toBe("string");
  });
});
