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
      executeBatch: vi.fn(async () => []),
      query: vi.fn(async () => ({ value: [] })) as never
    };
    const r = await writeQuestionKnowledge(ENV, run, "ACC", api);
    expect(r.skipped).toBe("no-tables");
    expect(api.executeBatch).not.toHaveBeenCalled();
  });

  it("upserts via read-then-write on iacrm_questionid - never amsexternalid", async () => {
    const batch = vi.fn(async (_e: unknown, ops: { key: string; method: string; url: string; body?: Record<string, unknown> }[]) =>
      ops.map((o, i) => ({ key: o.key, status: 204, error: null, entityId: o.method === "POST" ? `guid-${i}` : null }))
    );
    const query = vi.fn(async (_e: unknown, path: string) => {
      // q1 already exists in the dictionary; q2 does not; no answers yet
      if (path.startsWith("iacrm_carrierquestions")) {
        return { value: [{ iacrm_carrierquestionid: "q1-guid", iacrm_questionid: "ezlynx:q1" }] };
      }
      return { value: [] };
    });
    const api = {
      getKnowledgeNavProps: vi.fn(async () => ({ accountNav: "iacrm_AccountId", questionNav: "iacrm_CarrierQuestionId" })),
      executeBatch: batch,
      query
    } as unknown as KnowledgeApi;
    const r = await writeQuestionKnowledge(ENV, run, "ACC", api);
    expect(r).toEqual({ questionsUpserted: 2, answersUpserted: 1, skipped: null });

    const qOps = batch.mock.calls[0]![1] as { key: string; method: string; url: string; body: Record<string, unknown> }[];
    // existing question -> PATCH by GUID; new question -> POST carrying iacrm_questionid
    expect(qOps.find(o => o.key === "q:ezlynx:q1")).toMatchObject({ method: "PATCH", url: "iacrm_carrierquestions(q1-guid)" });
    expect(qOps.find(o => o.key === "q:ezlynx:q2")).toMatchObject({ method: "POST", url: "iacrm_carrierquestions" });
    expect(qOps.find(o => o.key === "q:ezlynx:q2")!.body["iacrm_questionid"]).toBe("ezlynx:q2");
    for (const o of qOps) expect(o.body["iacrm_amsexternalid"]).toBeUndefined();

    const aOps = batch.mock.calls[1]![1] as { method: string; body: Record<string, unknown> }[];
    expect(aOps).toHaveLength(1); // only the answered pair
    expect(aOps[0]!.method).toBe("POST");
    expect(aOps[0]!.body["iacrm_AccountId@odata.bind"]).toBe("/accounts(ACC)");
    expect(aOps[0]!.body["iacrm_CarrierQuestionId@odata.bind"]).toBe("/iacrm_carrierquestions(q1-guid)");
    expect(aOps[0]!.body["iacrm_amsexternalid"]).toBeUndefined();
  });

  it("updates an existing answer for the same application instead of duplicating", async () => {
    const batch = vi.fn(async (_e: unknown, ops: { key: string; method: string; url: string }[]) =>
      ops.map(o => ({ key: o.key, status: 204, error: null, entityId: null }))
    );
    const query = vi.fn(async (_e: unknown, path: string) => {
      if (path.startsWith("iacrm_carrierquestions")) {
        return { value: [
          { iacrm_carrierquestionid: "q1-guid", iacrm_questionid: "ezlynx:q1" },
          { iacrm_carrierquestionid: "q2-guid", iacrm_questionid: "ezlynx:q2" }
        ] };
      }
      return { value: [{ iacrm_riskanswerid: "a1-guid", iacrm_sourceapplicationid: "999", "_iacrm_carrierquestionid_value": "q1-guid" }] };
    });
    const api = {
      getKnowledgeNavProps: vi.fn(async () => ({ accountNav: "iacrm_AccountId", questionNav: "iacrm_CarrierQuestionId" })),
      executeBatch: batch,
      query
    } as unknown as KnowledgeApi;
    await writeQuestionKnowledge(ENV, run, "ACC", api);
    const aOps = batch.mock.calls[1]![1] as { method: string; url: string }[];
    expect(aOps).toHaveLength(1);
    expect(aOps[0]!).toMatchObject({ method: "PATCH", url: "iacrm_riskanswers(a1-guid)" });
  });
});
