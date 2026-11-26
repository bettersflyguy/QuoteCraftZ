import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { CapturedApplication } from "@/boldpenguin/types";
import { buildVehicleNote, buildTimelineNote } from "@/crm/appCommit";
import { writeVehicleNotes } from "@/crm/propertyNotes";
import { isNoteTarget, noteLabelOf, parseFieldMapImport, rowTargetOf, toRowTarget } from "@/portal/fieldMaps";

const app = {
  capturedAt: "2026-11-24T00:00:00Z", source: { system: "PL Rater" },
  fields: [
    { label: "License Plate", value: "ONE", mapped: "note:vehicle1", section: "Auto" },
    { label: "Four Wheel Drive", value: "No", mapped: "note:vehicle2", section: "Auto" }
  ]
} as CapturedApplication;

it("keeps vehicle fallback values on their own vehicle timeline", async () => {
  expect(buildVehicleNote(app, 1)!.html).toContain("ONE");
  expect(buildVehicleNote(app, 1)!.html).not.toContain("Four Wheel Drive");
  expect(buildTimelineNote(app, "account")).toBeNull();
  const write = vi.fn(async (_id: string, _subject: string, _html: string) => "created" as const);
  const results = await writeVehicleNotes(app, [
    { asset: "properties", row: "crm:property1", id: "WRONG" },
    { asset: "vehicles", row: "crm:vehicle2", id: "TWO" }
  ], write);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]![0]).toBe("TWO");
  expect(results[0]!.status).toBe(0);
  expect(results[1]!.status).toBe(204);
});

it("imports every reviewed PL Rater binding without dropping rows", () => {
  const text = readFileSync("public/mappings/quotecraftz-pl-rater.json", "utf8");
  const result = parseFieldMapImport(text);
  expect(result.dropped).toBe(0);
  expect(result.fields).toBe(Object.keys(JSON.parse(text).maps["https://rating.vertafore.com"]).length);
  expect(result.fields).toBeGreaterThan(450);
  const map = result.maps["https://rating.vertafore.com"]!;
  expect(map["text:DriverCtlHeader_*$txtFirstName"]).toBe("crm:contacts[].firstname");
  expect(map["text:DriverCtlHeader_2$txtFirstName"]).toBeUndefined();
  expect(map["text:AutoCtlBody_*$txtLicensePlate"]).toBe('targets:["crm:vehicles[].iacrm_licenseplatenumber","note:vehicles[]"]');
  expect(map["field:distance to recognized water source"]).toBe('targets:["crm:properties[].iacrm_firehydrantdistancerange","note:properties[]"]');
  expect(map["field:distance to fire department"]).toBe("note:properties[]");
  expect(map["field:alternate water supply"]).toBe("note:properties[]");
});

it("preserves vehicle-note row bindings in shared mappings", () => {
  expect(toRowTarget("note:vehicles[]", 3)).toBe("note:vehicle3");
  expect(rowTargetOf("note:vehicle3")).toEqual({ arrayPath: "note:vehicles[]", row: 3 });
  expect(isNoteTarget("note:vehicle0")).toBe(false);
  expect(noteLabelOf("note:vehicle3")).toBe("Notes: Vehicle 3");
  const json = JSON.stringify({ type: "iacrm-quote-connector-fieldmaps", version: 1,
    maps: { "https://rating.vertafore.com": { "text:plate": "note:vehicle3" } } });
  expect(parseFieldMapImport(json).maps["https://rating.vertafore.com"]!["text:plate"]).toBe("note:vehicle3");
});
