import { describe, it, expect } from "vitest";
import { buildFieldMapExport, parseFieldMapImport, MAP_PATHS } from "@/portal/fieldMaps";

describe("field-map share files", () => {
  it("round-trips an export through import", () => {
    const maps = {
      "https://express.nationwide.com": { "text:firstName": "contact.firstName", "text:acct": "skip" },
      "https://quote.root.com": { "select:state": "address.state" }
    };
    const parsed = parseFieldMapImport(JSON.stringify(buildFieldMapExport(maps)));
    expect(parsed.maps).toEqual(maps);
    expect(parsed.sites).toBe(2);
    expect(parsed.fields).toBe(3);
    expect(parsed.dropped).toBe(0);
  });

  it("drops unknown paths, malformed origins and oversized keys instead of storing them", () => {
    const doc = {
      type: "iacrm-quote-connector-fieldmaps",
      version: 1,
      exportedAt: "2026-11-07T00:00:00.000Z",
      maps: {
        "https://ok.example.com": {
          "text:good": "contact.email",
          "text:evil": "window.location",
          ["text:" + "x".repeat(300)]: "contact.phone"
        },
        "javascript:alert(1)": { "text:a": "contact.email" },
        "https://empty.example.com": { "text:bad": "not.a.path" }
      }
    };
    const parsed = parseFieldMapImport(JSON.stringify(doc));
    expect(parsed.maps).toEqual({ "https://ok.example.com": { "text:good": "contact.email" } });
    expect(parsed.dropped).toBe(4);
  });

  it("rejects files that are not ours", () => {
    expect(() => parseFieldMapImport("not json")).toThrow(/valid JSON/);
    expect(() => parseFieldMapImport(JSON.stringify({ type: "other", maps: {} }))).toThrow(/not a Quote Connector/);
    expect(() => parseFieldMapImport(JSON.stringify({ type: "iacrm-quote-connector-fieldmaps", maps: { "https://a.com": { k: "bogus" } } }))).toThrow(/no usable mappings/);
  });

  it("every mappable path has a label", () => {
    for (const p of MAP_PATHS) expect(p.label.length).toBeGreaterThan(0);
  });
});
