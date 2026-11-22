import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFieldMapImport } from "@/portal/fieldMaps";
import { parseSettingsFile } from "@/options/settingsBundle";

const text = readFileSync(path.resolve(__dirname, "../public/mappings/quotecraftz-ezlynx-core-1.3.0.380.json"), "utf8");
const evidence = JSON.parse(readFileSync(path.resolve(__dirname, "../docs/audits/core-upgrade-schema-refresh-2026-11-21.json"), "utf8"));

describe("core 1.3.0.380 mapping reconciliation", () => {
  it("imports all saved page and data-service targets without dropping native array bindings", () => {
    const parsed = parseFieldMapImport(text);
    expect(parsed.dropped).toBe(0);
    expect(parsed.fields).toBe(261);
    expect(Object.keys(parsed.dataServices.ezlynx!)).toHaveLength(61);
    for (const change of evidence.changes) {
      const scope = change.scope === "page" ? parsed.maps["https://app.ezlynx.com"]! : parsed.dataServices.ezlynx!;
      expect(scope[change.source], change.source).toBe(change.after);
    }
  });

  it("changes only EZLynx mappings and retains custom address details in notes while related-contact routing is incomplete", () => {
    const parsed = parseSettingsFile(text);
    expect(Object.keys(parsed.fields.maps)).toEqual(["https://app.ezlynx.com"]);
    expect(parsed.extras.environments).toEqual([]);
    const address = parsed.fields.dataServices.ezlynx!;
    expect(address["address.postalCodeSuffix"]).toBe('targets:["crm:addresses[].iacrm_zip4suffix","note"]');
    expect(address["address.yearsAtAddress"]).toBe('targets:["crm:addresses[].iacrm_yearsataddress","note"]');
    expect(address["address.monthsAtAddress"]).toBe('targets:["crm:addresses[].iacrm_monthsataddress","note"]');
    expect(text).not.toContain('"secure:');
  });
});
