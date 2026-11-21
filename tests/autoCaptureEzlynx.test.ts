/** Auto-capture runs the real Ingest: on EZLynx its data service (Insured /
 * Contacts / Addresses tables), never the raw page; on other sites only
 * the values the agent mapped and the page has filled in. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backing, reset } from "./helpers/chromeStub";
import { handleAutoCaptured, routeMessage, realDeps } from "@/workerRouter";
import type { CapturedAppField } from "@/boldpenguin/types";

const query = vi.fn(async (_q: unknown) => [] as { id?: number }[]);
const harvest: { title: string; url: string; fields: CapturedAppField[]; secure: never[] } = {
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
  it("manual lead ingest without CRM-column mappings does not request a CRM sign-in", async () => {
    (g.chrome.tabs as { get: unknown }).get = vi.fn(async () => ({ url: harvest.url }));
    const catalog = vi.fn(async () => { throw new Error("CRM sign-in should not open"); });
    const result = await routeMessage({type:"panel/portalIngest",tabId:7}, {
      ...realDeps, ingestPortalTab:vi.fn(async()=>harvest), getFieldCatalog:catalog,
      getCapturedApplication:vi.fn(async()=>null), setCapturedApplication:vi.fn(async()=>{})
    });
    expect(result.ok).toBe(true);
    expect(catalog).not.toHaveBeenCalled();
  });
  it("One Lead reads only its selected iframe with the scope guard enabled", async () => {
    backing["s:portal/lead/7"] = { frameId:12, label:"Lead A", key:"A" };
    await handleAutoCaptured({ url: harvest.url }, 7);
    const read = executeScript.mock.calls.map(c=>c[0]).find(o=>o.func) as unknown as { target: unknown; args: unknown[] };
    expect(read.target).toEqual({ tabId:7, frameIds:[12] });
    expect(read.args[2]).toBe(true);
  });

  it("One Lead pending/reloaded selection pauses without a whole-page capture", async () => {
    backing["s:portal/lead/7"] = { frameId:-1, label:"Select lead", key:"" };
    await handleAutoCaptured({ url: harvest.url }, 7);
    expect(executeScript).not.toHaveBeenCalled();
    expect(held()).toBeUndefined();
    expect((g.chrome.runtime as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type:"portal/leadPaused",tabId:7 }));
  });
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

  it("turning it on reads the page now, and says why when it can't", async () => {
    (g.chrome.tabs as { get: unknown }).get = vi.fn(async () => ({ url: "https://app.ezlynx.com/web/account/123/details" }));
    const r = await routeMessage({ type: "panel/autoCapture", tabId: 7, enable: true }, { ...realDeps, setAutoCapture: vi.fn(async () => {}) }) as { ok: boolean; data: { error?: string } | null };
    expect(query).toHaveBeenCalledWith({ url: "https://app.ezlynx.com/*" });
    expect(r.ok).toBe(true);
    expect(r.data?.error).toMatch(/EZLynx/);
  });
});
