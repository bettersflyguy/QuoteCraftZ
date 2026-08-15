import { describe, it, expect, vi } from "vitest";
import { fetchCapturedRun, EzlynxSessionError } from "@/ezlynx/client";
import quoteResult from "./fixtures/quote-result.sample.json";
import applicant from "./fixtures/applicant.sample.json";
import type { RunListItem } from "@/types";

const run: RunListItem = {
  applicationId: 199071915, applicantId: 219851561, created: "2026-08-03T16:07:54.13",
  lobs: "Auto, Home", description: "",
  quoteIdsByLob: [
    { lob: "Auto", applicantQuoteId: 513228997 },
    { lob: "Home", applicantQuoteId: 513228998 }
  ]
};

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("fetchCapturedRun", () => {
  it("calls applicant + one quote-result per distinct id, merges blocks", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/applicant/")) return okJson(applicant);
      if (url.includes("/quote-result/513228997")) return okJson(quoteResult);
      if (url.includes("/quote-result/513228998")) return okJson(quoteResult);
      throw new Error("unexpected url " + url);
    });
    const captured = await fetchCapturedRun(219851561, run, fetcher as never);
    expect(captured.applicant.lastName).toBe("Sample");
    expect(captured.blocks.map(b => b.lob).sort()).toEqual(["Auto", "Home"]);
    expect(captured.openApplicationId).toBe(199071915);
    // one payload carried both LOB blocks -> dedup keeps each LOB once
    expect(fetcher.mock.calls.filter(c => (c[0] as string).includes("quote-result")).length).toBeLessThanOrEqual(2);
  });

  it("throws EzlynxSessionError on 401", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as Response));
    await expect(fetchCapturedRun(219851561, run, fetcher as never)).rejects.toThrow(EzlynxSessionError);
  });
});
