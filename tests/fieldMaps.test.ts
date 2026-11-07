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

  it("accepts captured-label targets (multi-record mappings) and rejects malformed ones", () => {
    const doc = buildFieldMapExport({
      "https://ok.example.com": {
        "text:vin2": "label:vin 2",
        "text:drv": "label:driver 2 first name",
        "text:bad": "label:<script>"
      }
    });
    const parsed = parseFieldMapImport(JSON.stringify(doc));
    expect(parsed.maps["https://ok.example.com"]).toEqual({
      "text:vin2": "label:vin 2",
      "text:drv": "label:driver 2 first name"
    });
    expect(parsed.dropped).toBe(1);
    // surfaced for user review before an import applies
    expect(parsed.labelTargets).toEqual(["driver 2 first name", "vin 2"]);
    expect(parsed.perOrigin).toEqual([
      { origin: "https://ok.example.com", fields: 2, labels: ["driver 2 first name", "vin 2"] }
    ]);
  });

  it("sheds identifier-class label targets at import (SSN/TIN/EIN/passport) while quoting labels survive", () => {
    const doc = buildFieldMapExport({
      "https://ok.example.com": {
        "text:a": "label:ssn",
        "text:b": "label:social security number",
        "text:c": "label:fein",
        "text:c2": "label:taxid number",
        "text:c3": "label:socsec",
        "text:d": "label:driver 2 date of birth",
        "text:e": "label:driver 2 license number",
        "text:f": "label:business name"
      }
    });
    const parsed = parseFieldMapImport(JSON.stringify(doc));
    // FEIN/EIN/tax-id are standard commercial-quoting data — fillable by request
    expect(Object.values(parsed.maps["https://ok.example.com"]!).sort()).toEqual([
      "label:business name", "label:driver 2 date of birth", "label:driver 2 license number",
      "label:fein", "label:taxid number"
    ]);
    expect(parsed.dropped).toBe(3);
  });

  it("reports no label targets for rule-path-only files (import applies without review)", () => {
    const parsed = parseFieldMapImport(JSON.stringify(buildFieldMapExport({
      "https://a.example.com": { "text:fn": "contact.firstName" }
    })));
    expect(parsed.labelTargets).toEqual([]);
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
