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

  it("classifies the active tab so only rater sites open the rater wizard", async () => {
    const kindOf = async (url: string) => {
      const deps = {
        getActiveTab: vi.fn(async () => ({ id: 7, url })),
        getCapturedApplication: vi.fn(async () => null),
        isAutoCapturing: vi.fn(async () => false)
      };
      const res = await routeMessage({ type: "panel/getPageContext" }, deps as never);
      return (res as { data: { kind: string } }).data.kind;
    };
    expect(await kindOf("https://app.ezlynx.com/web/applicant/1")).toBe("ezlynx");
    expect(await kindOf("https://app.boldpenguin.com/x")).toBe("boldpenguin");
    expect(await kindOf("https://bettersinsurance.crm.dynamics.com/main.aspx")).toBe("crm");
    expect(await kindOf("https://www8.nowcerts.com/AMSINS/Insureds")).toBe("other");
    // the extension's own Settings page and browser pages have nothing to work on
    expect(await kindOf("chrome-extension://abc/src/options/index.html")).toBe("none");
    expect(await kindOf("extension://abc/src/options/index.html")).toBe("none");
    expect(await kindOf("edge://extensions")).toBe("none");
  });
});
