import { describe, it, expect } from "vitest";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import type { CapturedAppField, CapturedApplication } from "@/boldpenguin/types";

const site = { system: "portal.examplecarrier.com", url: "https://portal.examplecarrier.com/quote", title: "Example Carrier" };

function field(label: string, value: string, section = "Quote details"): CapturedAppField {
  return { label, value, section, group: "", source: "control" };
}

describe("portal ingest merge", () => {
  it("starts a fresh capture from an ingested page, normalized and deduped", () => {
    const { app, added, total } = mergeIngestedFields(null, [
      field("Legal Business Name *", "Northwind Bakery LLC"),
      field("Legal Business Name", "Northwind Bakery LLC"), // dup after label cleanup
      field("Email Address", "alex@example.com"),
      field("Notes", "  ") // blank after cleanup — dropped
    ], site);

    expect(added).toBe(2);
    expect(total).toBe(2);
    expect(app.source.system).toBe("portal.examplecarrier.com");
    expect(app.normalized["business"]?.["legalName"]).toBe("Northwind Bakery LLC");
    expect(app.normalized["contact"]?.["email"]).toBe("alex@example.com");
    expect(app.completion.likelyCompleted).toBe(true);
  });

  it("appends only new fields to an existing capture and keeps its identity", () => {
    const first = mergeIngestedFields(null, [field("Legal Business Name", "Northwind Bakery LLC")], site).app;
    const { app, added, total } = mergeIngestedFields(first, [
      field("Legal Business Name", "Northwind Bakery LLC"), // already held
      field("FEIN", "12-3456789", "Business")
    ], { system: "other.carrier.com", url: "https://other.carrier.com/", title: "Other" });

    expect(added).toBe(1);
    expect(total).toBe(2);
    // the capture's original source identity survives later ingests
    expect(app.source.system).toBe("portal.examplecarrier.com");
    expect(app.normalized["business"]?.["fein"]).toBe("12-3456789");
  });

  it("never lets a later page replace an already-normalized value", () => {
    const existing = mergeIngestedFields(null, [field("Legal Business Name", "Northwind Bakery LLC")], site).app;
    const { app } = mergeIngestedFields(existing, [field("Company Name", "Wrong Name Inc")], site);
    expect(app.normalized["business"]?.["legalName"]).toBe("Northwind Bakery LLC");
    // the raw field is still retained for portal filling by its own label
    expect(app.fields.some(f => f.value === "Wrong Name Inc")).toBe(true);
  });

  it("works against a Bold Penguin capture as the base", () => {
    const bp: CapturedApplication = {
      schemaVersion: "1.1",
      capturedAt: "2026-09-25T00:00:00.000Z",
      source: { system: "Bold Penguin", url: "https://app.boldpenguin.com/x", title: "BP" },
      completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: true },
      scannedSections: ["General information"],
      normalized: { business: { legalName: "Northwind Bakery LLC" } },
      fields: [field("Legal Business Name", "Northwind Bakery LLC", "General information")]
    };
    const { app, added } = mergeIngestedFields(bp, [field("Phone Number", "555-0100")], site);
    expect(added).toBe(1);
    expect(app.source.system).toBe("Bold Penguin");
    expect(app.normalized["contact"]?.["phone"]).toBe("555-0100");
    expect(app.scannedSections).toContain("Quote details");
  });
});
