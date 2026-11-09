/** Notes are history: unchanged data writes nothing, a same-day re-load
 * corrects that day's note, a later load with changed data adds a NEW
 * dated note and leaves the earlier one as it was. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { noteContent, upsertRecordNote } from "@/crm/dataverse";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };
const SUBJECT = "QuoteCraftZ: Non Mapped Timeline Entries (EZLynx)";
const body = (when: string, value: string) =>
  `<h2>Non Mapped Timeline Entries</h2><p><b>Captured ${when} from EZLynx</b></p><table><tr><td>Phone</td><td>${value}</td></tr></table>`;

type Call = { method: string; url: string; body?: Record<string, unknown> };
function crm(existing: { notetext: string; createdon: string } | null) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
    const json = method === "GET"
      ? { value: existing ? [{ annotationid: "N1", ...existing }] : [] }
      : { annotationid: "N2" };
    return { ok: true, status: method === "PATCH" ? 204 : 200, json: async () => json, text: async () => "", headers: new Headers() } as unknown as Response;
  }));
  return calls;
}

beforeEach(() => vi.restoreAllMocks());

describe("note history", () => {
  const today = new Date(2026, 10, 8, 15, 0);

  it("ignores the capture time when comparing", () => {
    expect(noteContent(body("11/8/2026, 9:00 AM", "612"))).toBe(noteContent(body("11/9/2027, 4:00 PM", "612")));
  });

  it("writes nothing when the data hasn't changed", async () => {
    const calls = crm({ notetext: body("1/2/2025", "612"), createdon: "2025-01-02T15:00:00Z" });
    expect(await upsertRecordNote(ENV, "account", "A1", SUBJECT, body("11/8/2026", "612"), undefined, today)).toBe("unchanged");
    expect(calls.map(c => c.method)).toEqual(["GET"]);
  });

  it("a later load with changed data adds a new dated note, the old one untouched", async () => {
    const calls = crm({ notetext: body("1/2/2025", "612"), createdon: "2025-01-02T15:00:00Z" });
    expect(await upsertRecordNote(ENV, "account", "A1", SUBJECT, body("11/8/2026", "763"), undefined, today)).toBe("created");
    expect(calls.map(c => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1]!.body!["subject"]).toBe(`${SUBJECT} 11-08-2026`);
    expect(calls[1]!.body!["objectid_account@odata.bind"]).toBe("/accounts(A1)");
    // the lookup finds earlier dated and undated notes, newest first
    expect(decodeURIComponent(calls[0]!.url)).toContain(`startswith(subject,'${SUBJECT}')`);
    expect(decodeURIComponent(calls[0]!.url)).toContain("$orderby=createdon desc");
  });

  it("a same-day re-load corrects that day's note", async () => {
    const calls = crm({ notetext: body("11/8/2026", "612"), createdon: new Date(2026, 10, 8, 9, 0).toISOString() });
    expect(await upsertRecordNote(ENV, "account", "A1", SUBJECT, body("11/8/2026", "763"), undefined, today)).toBe("updated");
    expect(calls.map(c => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1]!.url).toContain("annotations(N1)");
  });

  it("the first load creates the first note", async () => {
    const calls = crm(null);
    expect(await upsertRecordNote(ENV, "contact", "C1", SUBJECT, body("11/8/2026", "612"), undefined, today)).toBe("created");
    expect(calls[1]!.body!["objectid_contact@odata.bind"]).toBe("/contacts(C1)");
  });
});
