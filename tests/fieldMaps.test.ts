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
      { origin: "https://ok.example.com", fields: 2, labels: ["driver 2 first name", "vin 2"], picks: 0 }
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
    // FEIN/EIN/tax-id are standard commercial-quoting data - fillable by request
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

  it("accepts pick-key (read-only text) teachings with CRM-field targets only", () => {
    const longSel = "pick:" + "div:nth-of-type(2) > ".repeat(20) + "span:nth-of-type(1)"; // ~450 chars
    const tooLong = "pick:" + "div:nth-of-type(2) > ".repeat(25) + "span:nth-of-type(1)"; // >500
    const doc = buildFieldMapExport({
      "https://ams.example.com": {
        [longSel]: "contact.email",            // deep selector within the pick cap - kept
        "pick:#summary > span": "business.fein", // kept
        "pick:#x > em": "skip",                  // kept (suppression)
        "pick:#y > i": "label:email",            // capture keys can't take fill-direction targets - dropped
        [tooLong]: "contact.phone",              // over the 500-char pick cap - dropped
        "pick:input[value]": "contact.email",    // outside the cssPath grammar - dropped
        "pick:div:has(a)": "contact.phone",      // outside the cssPath grammar - dropped
        "pick:#x,div": "contact.email",          // selector LIST smuggled through the id branch - dropped
        "pick:#a[onclick]": "contact.phone",     // attribute selector in the id branch - dropped
        "pick:#esc\\.aped > span": "contact.email" // escaped metachar, as CSS.escape emits - kept
      }
    });
    const parsed = parseFieldMapImport(JSON.stringify(doc));
    const kept = parsed.maps["https://ams.example.com"]!;
    expect(kept[longSel]).toBe("contact.email");
    expect(kept["pick:#summary > span"]).toBe("business.fein");
    expect(kept["pick:#x > em"]).toBe("skip");
    expect(kept["pick:#esc\\.aped > span"]).toBe("contact.email");
    expect(Object.keys(kept)).toHaveLength(4);
    expect(parsed.dropped).toBe(6);
    // taught captures surface in the per-origin review (skip entries excluded)
    expect(parsed.perOrigin[0]!.picks).toBe(3);
  });

  it("accepts CRM-column capture targets on pick keys only, never the AMS-reserved or identifier-class columns", () => {
    const parsed = parseFieldMapImport(JSON.stringify(buildFieldMapExport({
      "https://ams.example.com": {
        "pick:#a > span": "crm:account.address1_city",           // kept
        "pick:#b > span": "crm:contacts[].address1_city",        // kept (array)
        "pick:#c > span": "crm:policies[].iacrm_policynumber",   // kept (array)
        "pick:#d > span": "crm:account.iacrm_fein",              // kept (FEIN allowed)
        "pick:#e > span": "crm:account.iacrm_amsexternalid",     // AMS-reserved - dropped
        "pick:#f > span": "crm:primarycontact.iacrm_ssn",        // identifier-class - dropped
        "pick:#g > span": "crm:systemuser.fullname",             // not a capture entity - dropped
        "pick:#h > span": "crm:account.Address1_City",           // not a logical name - dropped
        "pick:#i > span": "crm:policies[].iacrm_synctoams",      // AMS-owned sync flag - dropped
        "text:city": "crm:account.address1_city"                 // fill keys can't take CRM columns - dropped
      }
    })));
    expect(Object.keys(parsed.maps["https://ams.example.com"]!).sort()).toEqual(["pick:#a > span", "pick:#b > span", "pick:#c > span", "pick:#d > span"]);
    expect(parsed.dropped).toBe(6);
    expect(parsed.perOrigin[0]!.picks).toBe(4);
  });

  it("accepts the timeline-note target on taught text only", () => {
    const parsed = parseFieldMapImport(JSON.stringify(buildFieldMapExport({
      "https://ams.example.com": { "pick:#a > td": "note", "text:remarks": "note", "text:fn": "contact.firstName" }
    })));
    expect(parsed.maps["https://ams.example.com"]).toEqual({ "pick:#a > td": "note", "text:fn": "contact.firstName" });
    expect(parsed.dropped).toBe(1);
  });

  it("rejects files that are not ours", () => {
    expect(() => parseFieldMapImport("not json")).toThrow(/valid JSON/);
    expect(() => parseFieldMapImport(JSON.stringify({ type: "other", maps: {} }))).toThrow(/not a QuoteCraftZ/);
    expect(() => parseFieldMapImport(JSON.stringify({ type: "iacrm-quote-connector-fieldmaps", maps: { "https://a.com": { k: "bogus" } } }))).toThrow(/no usable mappings/);
  });

  it("every mappable path has a label and an entity group; labels are unique", () => {
    const labels = new Set<string>();
    for (const p of MAP_PATHS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
      expect(labels.has(p.label)).toBe(false);
      labels.add(p.label);
    }
  });

  it("accepts array-relationship targets (related contacts, vehicles) in imports", () => {
    const parsed = parseFieldMapImport(JSON.stringify(buildFieldMapExport({
      "https://ams.example.com": {
        "pick:#x > span": "contacts[].email",
        "text:vin": "vehicles[].vin"
      }
    })));
    expect(parsed.maps["https://ams.example.com"]).toEqual({
      "pick:#x > span": "contacts[].email",
      "text:vin": "vehicles[].vin"
    });
    expect(parsed.dropped).toBe(0);
  });
});
