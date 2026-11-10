/** Re-reading a page replaces a field's old value instead of piling up. */
import { describe, it, expect } from "vitest";
import { mergeIngestedFields } from "@/boldpenguin/ingest";

const site = { system: "EZLynx", url: "https://app.ezlynx.com/x", title: "Tracy Dittrich" };
const f = (label: string, value: string) => ({ label, value, section: "Prior Auto Policy", group: "", source: "taught" as const, mapped: "note" });

describe("re-read", () => {
  it("the page's current value wins; other fields stay", () => {
    const first = mergeIngestedFields(null, [f("Prior Carrier", "Travelers"), f("Prior Liability Limits", "100/300")], site).app;
    const again = mergeIngestedFields(first, [f("Prior Carrier", "Geico")], site);
    expect(again.app.fields.map(x => `${x.label}=${x.value}`)).toEqual(["Prior Liability Limits=100/300", "Prior Carrier=Geico"]);
    expect(again.added).toBe(1);
  });
});
