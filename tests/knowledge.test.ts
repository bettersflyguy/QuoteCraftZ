import { describe, it, expect, vi } from "vitest";
import { writeQuestionKnowledge, type KnowledgeApi } from "@/crm/knowledge";
import type { CapturedRun } from "@/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

const run: CapturedRun = {
  applicant: {
    ezlynxApplicantId: 1, firstName: "A", lastName: "B", dateOfBirth: null,
    dlNumber: null, dlState: null, address: null, phones: [], emails: [], coApplicants: [], isCommercial: false
  },
  openApplicationId: 999,
  capturedAt: "2026-08-16T12:00:00Z",
  ratedAt: null,
  blocks: [
    {
      lob: "Auto", applicantQuoteId: 1, quotes: [], errors: [],
      icq: {
        state: "MN",
        pairs: [
          { questionId: "q1", carrier: "MULTI", label: "Paperless", answer: "Yes" },
          { questionId: "q2", carrier: "Travelers", label: "Book transfer", answer: null }
        ],
        answeredCount: 1, totalQuestions: 2,
        catalog: [
          { questionId: "q1", carrier: "MULTI", label: "Paperless", helpText: null, answerType: "singleSelect", options: [{ value: "Yes", displayText: "Yes" }] },
          { questionId: "q2", carrier: "Travelers", label: "Book transfer", helpText: "h", answerType: null, options: [] }
        ]
      }
    }
  ]
};

describe("writeQuestionKnowledge", () => {
  it("no-ops with skipped:'no-tables' before the schema deploys", async () => {
    const api: KnowledgeApi = {
      getKnowledgeNavProps: vi.fn(async () => null),
      executeBatch: vi.fn(async () => [])
    };
    const r = await writeQuestionKnowledge(ENV, run, "ACC", api);
    expect(r.skipped).toBe("no-tables");
    expect(api.executeBatch).not.toHaveBeenCalled();
  });

  it("upserts every catalog question but only answered answers, with probed binds", async () => {
    const batch = vi.fn(async (_e: unknown, ops: { key: string; url: string; body?: Record<string, unknown> }[]) =>
      ops.map(o => ({ key: o.key, status: 204, error: null, entityId: null }))
    );
    const api = {
      getKnowledgeNavProps: vi.fn(async () => ({ accountNav: "iacrm_AccountId", questionNav: "iacrm_CarrierQuestionId" })),
      executeBatch: batch
    } as unknown as KnowledgeApi;
    const r = await writeQuestionKnowledge(ENV, run, "ACC", api);
    expect(r).toEqual({ questionsUpserted: 2, answersUpserted: 1, skipped: null });
    const ops = batch.mock.calls[0]![1] as { key: string; url: string; body: Record<string, unknown> }[];
    const q1 = ops.find(o => o.key === "q:ezlynx:q1")!;
    expect(q1.url).toBe("iacrm_carrierquestions(iacrm_amsexternalid='ezlynx:q1')");
    expect(q1.body["iacrm_optionsjson"]).toContain("Yes");
    const a1 = ops.find(o => o.key === "a:ezlynx:999:q1")!;
    expect(a1.body["iacrm_AccountId@odata.bind"]).toBe("/accounts(ACC)");
    expect(a1.body["iacrm_CarrierQuestionId@odata.bind"]).toBe("/iacrm_carrierquestions(iacrm_amsexternalid='ezlynx:q1')");
    expect(ops.some(o => o.key === "a:ezlynx:999:q2")).toBe(false); // unanswered: no answer row
  });
});
