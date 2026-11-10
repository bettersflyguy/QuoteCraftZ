/** Auto-capture on EZLynx reads its data service (Insured / Contacts /
 * Addresses tables), never the raw page: a page scrape must not replace the
 * structured capture. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backing, reset } from "./helpers/chromeStub";
import { handleAutoCaptured } from "@/workerRouter";

const query = vi.fn(async (_q: unknown) => [] as { id?: number }[]);
const g = globalThis as unknown as { chrome: Record<string, unknown> };
g.chrome.tabs = { query, sendMessage: vi.fn(async () => undefined) };
g.chrome.runtime = { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ content_scripts: [] }) };

const pageFields = [
  { label: "account_circle", value: "Account Overview", section: "Account Overview", group: "", source: "review-row" as const },
  { label: "Type", value: "Prospect/Lead", section: "Account Overview", group: "", source: "review-row" as const }
];
const held = () => Object.entries(backing).find(([k]) => k.startsWith("s:") && k !== "s:autocap/tabs")?.[1] as { fields: unknown[] } | undefined;

beforeEach(() => { reset(); query.mockClear(); backing["s:autocap/tabs"] = [7]; });

describe("auto-capture on EZLynx", () => {
  it("asks the EZLynx data service, never merges the page scrape", async () => {
    await handleAutoCaptured({ fields: pageFields, title: "Tracy Dittrich", url: "https://app.ezlynx.com/web/account/123/details" }, 7);
    expect(query).toHaveBeenCalledWith({ url: "https://app.ezlynx.com/*" });
    expect(held()).toBeUndefined();
  });

  it("other sites still merge what the page shows", async () => {
    await handleAutoCaptured({ fields: pageFields, title: "Portal", url: "https://portal.example.com/x" }, 7);
    expect(query).not.toHaveBeenCalled();
    expect(held()?.fields.length).toBe(2);
  });
});
