import { describe, it, expect, vi } from "vitest";
import "./helpers/chromeStub";
import { routeMessage } from "@/workerRouter";

describe("routeMessage", () => {
  it("returns a typed error for unknown message types", async () => {
    const res = await routeMessage({ type: "nope" } as never, {} as never);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("unknown"), kind: "unknown" });
  });

  it("wraps CrmAccessError with the environment name for the panel", async () => {
    const deps = {
      getActiveEnvironment: vi.fn(async () => ({ id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const })),
      searchAccounts: vi.fn(async () => { const e = new Error("x") as Error & { name: string; orgUrl: string }; e.name = "CrmAccessError"; e.orgUrl = "https://o.crm.dynamics.com"; throw e; })
    };
    const res = await routeMessage({ type: "panel/searchAccounts", name: "S", postalCode: null }, deps as never);
    expect(res).toMatchObject({ ok: false, kind: "auth", error: expect.stringContaining("DEV") });
  });
});
