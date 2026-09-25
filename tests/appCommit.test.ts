import { describe, it, expect } from "vitest";
import { applicantFromCapture, accountNameFromCapture, toIsoDate, writeApplicationKnowledge } from "@/crm/appCommit";
import type { CapturedApplication } from "@/boldpenguin/types";
import type { CrmEnvironment } from "@/crm/environments";

const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;

function capture(partial: Partial<CapturedApplication> = {}): CapturedApplication {
  return {
    schemaVersion: "1.1",
    capturedAt: "2026-09-25T12:00:00.000Z",
    source: { system: "sales.geico.com", url: "https://sales.geico.com/quote", title: "GEICO" },
    completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: false },
    scannedSections: ["Quote"],
    normalized: {
      contact: { fullName: "Dearris Thomas", email: "dt@example.com", phone: "555-0100", dateOfBirth: "11/18/1949" },
      address: { street1: "100 Main St", city: "Duluth", state: "MN", postalCode: "55802" }
    },
    fields: [
      { label: "Bodily Injury Liability (BI)", value: "$25,000/$50,000", section: "Quote", group: "", source: "control" },
      { label: "Email Address", value: "dt@example.com", section: "Quote", group: "", source: "control" },
      { label: "Bodily Injury Liability (BI)", value: "$25,000/$50,000", section: "Other", group: "", source: "table" }
    ],
    ...partial
  };
}

describe("applicantFromCapture", () => {
  it("splits fullName, converts DOB, maps address/phone/email", () => {
    const a = applicantFromCapture(capture());
    expect(a.firstName).toBe("Dearris");
    expect(a.lastName).toBe("Thomas");
    expect(a.dateOfBirth).toBe("1949-11-18");
    expect(a.address).toEqual({ street: "100 Main St", city: "Duluth", state: "MN", postalCode: "55802" });
    expect(a.phones).toEqual([{ type: null, number: "555-0100" }]);
    expect(a.emails).toEqual(["dt@example.com"]);
    expect(a.isCommercial).toBe(false);
  });

  it("is commercial when a business legal name exists, and names the account after it", () => {
    const app = capture({ normalized: { business: { legalName: "Northwind Bakery LLC" } } });
    expect(applicantFromCapture(app).isCommercial).toBe(true);
    expect(accountNameFromCapture(app)).toBe("Northwind Bakery LLC");
  });

  it("never writes an unparseable birthdate", () => {
    expect(toIsoDate("Nov 18 1949")).toBeNull();
    expect(toIsoDate("2026-10-01")).toBe("2026-10-01");
  });
});

describe("writeApplicationKnowledge", () => {
  it("skips with a notice when the tables are absent", async () => {
    const res = await writeApplicationKnowledge(env, capture(), "acc-1", {
      getKnowledgeNavProps: async () => null,
      executeBatch: async () => { throw new Error("must not be called"); }
    });
    expect(res.skipped).toBe("no-tables");
  });

  it("upserts one question + one answer per canonical label, deduped, bound to the account", async () => {
    let captured: { key: string; method: string; url: string; body?: unknown }[] = [];
    const res = await writeApplicationKnowledge(env, capture(), "acc-1", {
      getKnowledgeNavProps: async () => ({ accountNav: "iacrm_accountid", questionNav: "iacrm_questionid" }),
      executeBatch: async (_env, ops) => { captured = ops; return ops.map(o => ({ key: o.key, status: 204, error: null, entityId: null })); }
    });
    // 3 fields, 2 unique labels -> 2 questions + 2 answers
    expect(res).toEqual({ questionsUpserted: 2, answersUpserted: 2, skipped: null });
    expect(captured).toHaveLength(4);
    const answer = captured.find(o => o.url.startsWith("iacrm_riskanswers") && String(o.url).includes("bodily"))!;
    expect(answer.url).toContain("capture:acc-1:bodily injury liability bi");
    const body = answer.body as Record<string, unknown>;
    expect(body["iacrm_value"]).toBe("$25,000/$50,000");
    expect(body["iacrm_source"]).toBe("sales.geico.com");
    expect(body["iacrm_accountid@odata.bind"]).toBe("/accounts(acc-1)");
    expect(body["iacrm_questionid@odata.bind"]).toContain("capture:bodily injury liability bi");
  });
});
