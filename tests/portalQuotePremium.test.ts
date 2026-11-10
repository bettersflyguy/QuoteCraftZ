/** Carrier portal Ingest holds a quote only when a page value is mapped to
 * the QUOTE premium; any other premium on the page (a prior policy's, the
 * current policy's) never makes one. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reset } from "./helpers/chromeStub";
import { routeMessage, realDeps, type Deps } from "@/workerRouter";
import type { CapturedApplication, HeldQuote } from "@/boldpenguin/types";

const url = "https://www.foragentsonly.com/quote/summary";
const g = globalThis as unknown as { chrome: Record<string, unknown> };
g.chrome.tabs = { query: vi.fn(async () => []), get: vi.fn(async () => ({ url })), sendMessage: vi.fn(async () => undefined) };

function run(premiumMapped: string | undefined, existing: CapturedApplication | null = null) {
  let stored: CapturedApplication | null = existing;
  const deps: Deps = {
    ...realDeps,
    ingestPortalTab: vi.fn(async () => ({
      title: "Progressive", url,
      fields: [
        { label: "First Name", value: "Tracy", section: "", group: "", source: "control" as const, mapped: "contact.firstName" },
        { label: "Prior Policy Premium", value: "$1,410.00", section: "Prior Auto Policy", group: "", source: "control" as const, mapped: "crm:iacrm_priorcoverage.iacrm_premium" },
        { label: "Total Premium", value: "$1,236.00", section: "Summary", group: "", source: "money-line" as const, ...(premiumMapped ? { mapped: premiumMapped } : {}) }
      ],
      secure: []
    })) as unknown as Deps["ingestPortalTab"],
    getCapturedApplication: vi.fn(async () => stored),
    setCapturedApplication: vi.fn(async (a: CapturedApplication | null) => { stored = a; }),
    getFieldCatalog: vi.fn(async () => { throw new Error("offline"); }) as unknown as Deps["getFieldCatalog"]
  };
  return routeMessage({ type: "panel/portalIngest", tabId: 7 }, deps).then(r => ({ r, stored }));
}

beforeEach(() => reset());

describe("carrier portal quotes", () => {
  it("a premium mapped to the quote premium holds one quote for the site", async () => {
    const { r, stored } = await run("crm:quote.iacrm_premium");
    expect(r.ok).toBe(true);
    expect(stored?.quotes?.map(q => [q.key, q.premium])).toEqual([["portal:www.foragentsonly.com", 1236]]);
  });

  it("premiums that are not the quote premium hold no quote", async () => {
    const { stored } = await run(undefined);
    expect(stored?.quotes ?? []).toEqual([]);
  });

  it("a quote an earlier version held for the site goes; other sources' quotes stay", async () => {
    const first = await run("crm:quote.iacrm_premium");
    const ezlynx = { ...first.stored!.quotes![0]!, key: "ezlynx:1:req", provider: "EZLynx", source: "EZLynx" } as HeldQuote;
    // the old rule held the site's quote from an UNMAPPED premium
    const prior = {
      ...first.stored!,
      fields: first.stored!.fields.map(f => f.mapped === "crm:quote.iacrm_premium" ? { ...f, mapped: undefined } : f),
      quotes: [...first.stored!.quotes!, ezlynx]
    } as CapturedApplication;
    const { stored } = await run(undefined, prior);
    expect(stored?.quotes?.map(q => q.key)).toEqual(["ezlynx:1:req"]);
  });
});
