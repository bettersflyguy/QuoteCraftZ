/** A prior policy's dates are never the dates of the policy being written:
 * not by auto-match on a page, not by the normalizer, not by the policy
 * draft's label fallback. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { normalize } from "@/boldpenguin/normalize";
import { policyFromCapture } from "@/crm/appCommit";
import type { CapturedApplication, CapturedAppField } from "@/boldpenguin/types";

const require = createRequire(import.meta.url);
const { buildCandidates, matchField } = require(path.resolve(__dirname, "../public/portal/portal-mapper.js")) as {
  buildCandidates: (payload: unknown) => unknown[];
  matchField: (fieldName: string, candidates: unknown[]) => { path: string } | null;
};

describe("prior policy dates", () => {
  it("a page's Prior Policy Expiration Date is never auto-matched to the policy's expiration", () => {
    const candidates = buildCandidates({ normalized: { coverage: { expirationDate: "06/01/2027", effectiveDate: "12/01/2026" } }, fields: [] });
    expect(matchField("Prior Policy Expiration Date", candidates)?.path).not.toBe("coverage.expirationDate");
    expect(matchField("Policy Expiration Date", candidates)?.path).toBe("coverage.expirationDate");
    expect(matchField("Effective Date (New Policy)", candidates)?.path).toBe("coverage.effectiveDate");
  });

  it("the normalizer and the policy draft skip prior-policy values", () => {
    const fields: CapturedAppField[] = [
      { label: "Prior Policy Expiration Date", value: "12/01/2019", section: "Prior Auto Policy", group: "", source: "control" },
      { label: "Policy Number", value: "989815765", section: "Policy", group: "", source: "control" }
    ];
    const n = normalize(fields);
    expect((n["coverage"] as Record<string, string> | undefined)?.["expirationDate"]).toBeUndefined();
    const app = { fields, normalized: n, capturedAt: 0, source: { system: "x", url: "", title: "" } } as unknown as CapturedApplication;
    expect(policyFromCapture(app).expirationDate).toBe("");
  });
});
