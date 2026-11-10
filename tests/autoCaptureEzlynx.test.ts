/** Auto-capture runs the real Ingest: on EZLynx its data service (Insured /
 * Contacts / Addresses tables), never the raw page; on other sites only
 * the values the agent mapped and the page has filled in. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backing, reset } from "./helpers/chromeStub";
import { handleAutoCaptured } from "@/workerRouter";

const query = vi.fn(async (_q: unknown) => [] as { id?: number }[]);
const harvest = {
  title: "Portal", url: "https://portal.example.com/x",
  fields: [
    { label: "First Name", value: "Tracy", section: "", group: "", source: "control", mapped: "contact.firstName" },
    { label: "VIN", value: "1HGCM82633A004352", section: "", group: "", source: "taught", mapped: "note:opportunity" },
    { label: "Last Name", value: "", section: "", group: "", source: "control", mapped: "contact.lastName" },
    { label: "account_circle", value: "Account Overview", section: "Account Overview", group: "", source: "review-row" }
  ],
  secure: []
};
const executeScript = vi.fn(async (o: { func?: unknown }) => (o.func ? [{ result: harvest }] : []));
const g = globalThis as unknown as { chrome: Record<string, unknown> };
g.chrome.tabs = { query, sendMessage: vi.fn(async () => undefined), get: vi.fn(async () => ({ url: harvest.url })) };
g.chrome.scripting = { executeScript };
g.chrome.runtime = { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ content_scripts: [] }) };

const held = () => backing["s:bp/captured"] as { fields: { label: string }[] } | undefined
  ?? Object.entries(backing).find(([k, v]) => k.startsWith("s:") && v && typeof v === "object" && "fields" in (v as object))?.[1] as { fields: { label: string }[] } | undefined;

beforeEach(() => { reset(); query.mockClear(); executeScript.mockClear(); backing["s:autocap/tabs"] = [7]; });

describe("auto-capture", () => {
  it("EZLynx: asks the data service, never scrapes the page", async () => {
    await handleAutoCaptured({ url: "https://app.ezlynx.com/web/account/123/details" }, 7);
    expect(query).toHaveBeenCalledWith({ url: "https://app.ezlynx.com/*" });
    expect(held()).toBeUndefined();
  });

  it("other sites: only mapped, filled-in values", async () => {
    await handleAutoCaptured({ url: harvest.url }, 7);
    expect(query).not.toHaveBeenCalled();
    expect(held()?.fields.map(f => f.label).sort()).toEqual(["First Name", "VIN"]);
  });

  it("a tab without auto-capture is ignored", async () => {
    await handleAutoCaptured({ url: harvest.url }, 9);
    expect(executeScript).not.toHaveBeenCalled();
  });
});
