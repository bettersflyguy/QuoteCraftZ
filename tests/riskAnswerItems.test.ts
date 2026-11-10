/** Risk answers captured from a vehicle / property row point at that
 * asset's insured item (iacrm_riskanswer.iacrm_insureditemid). */
import { describe, it, expect, vi } from "vitest";
import { linkAnswersToInsuredItem, type KnowledgeApi } from "@/crm/knowledge";
import { assetRowQuestionKeys, knowledgeKeyOf } from "@/crm/appCommit";
import type { CapturedApplication, CapturedAppField } from "@/boldpenguin/types";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const };

const f = (label: string, value: string, section: string, group: string, mapped?: string): CapturedAppField =>
  ({ label, value, section, group, source: "table", ...(mapped ? { mapped } : {}) });

const app = {
  schemaVersion: "1.1", capturedAt: "2026-11-10T12:00:00Z",
  source: { system: "EZLynx", url: "https://app.ezlynx.com/x", title: "Tracy Dittrich" },
  fields: [
    f("VIN", "2FMDK38C09BA65577", "Vehicles", "Row 1", "crm:vehicle1.iacrm_vin"),
    f("Annual Mileage", "12000", "Vehicles", "Row 1"),
    f("VIN", "2FMDA52207BA05536", "Vehicles", "Row 2", "crm:vehicle2.iacrm_vin"),
    f("Annual Mileage", "8000", "Vehicles", "Row 2"),
    f("Prior carrier", "Progressive", "Policy Info", "")
  ]
} as unknown as CapturedApplication;

describe("assetRowQuestionKeys", () => {
  it("takes the row's mapped values and the rest of the same table row, nothing else", () => {
    const keys = assetRowQuestionKeys(app, "crm:vehicle2");
    expect(keys).toEqual([knowledgeKeyOf(app.fields[2]!).key, knowledgeKeyOf(app.fields[3]!).key]);
    expect(keys.every(k => k.includes("row 2"))).toBe(true);
  });

  it("an asset with no captured values has no answers to link", () => {
    expect(assetRowQuestionKeys(app, "crm:property1")).toEqual([]);
  });
});

describe("linkAnswersToInsuredItem", () => {
  const navs = { accountNav: "iacrm_AccountId", questionNav: "iacrm_CarrierQuestionId", insuredItemNav: "iacrm_InsuredItemId" };
  const fakeApi = (answers: Record<string, string | null>[]) => {
    const batch = vi.fn(async (_e: unknown, ops: { key: string }[]) => ops.map(o => ({ key: o.key, status: 204, error: null, entityId: null })));
    const query = vi.fn(async (_e: unknown, path: string) =>
      path.startsWith("iacrm_carrierquestions")
        ? { value: [{ iacrm_carrierquestionid: "Q-1" }, { iacrm_carrierquestionid: "Q-2" }] }
        : { value: answers });
    return { getKnowledgeNavProps: vi.fn(async () => navs), executeBatch: batch, query } as unknown as KnowledgeApi & { executeBatch: typeof batch; query: typeof query };
  };

  it("points the account's answers at the insured item, skipping ones already there", async () => {
    const api = fakeApi([
      { iacrm_riskanswerid: "A-1", _iacrm_insureditemid_value: null },
      { iacrm_riskanswerid: "A-2", _iacrm_insureditemid_value: "ITEM-1" }
    ]);
    const r = await linkAnswersToInsuredItem(ENV, "ACC", ["capture:a", "capture:b"], "item-1", api);
    expect(r).toEqual({ linked: 1, skipped: null });
    const answersPath = api.query.mock.calls.map(c => c[1] as string).find(p => p.startsWith("iacrm_riskanswers"))!;
    expect(answersPath).toContain("_iacrm_accountid_value eq ACC");
    expect(answersPath).toContain("_iacrm_carrierquestionid_value eq Q-1");
    expect(api.executeBatch.mock.calls[0]![1]).toEqual([
      { key: "link:0", method: "PATCH", url: "iacrm_riskanswers(A-1)", body: { "iacrm_InsuredItemId@odata.bind": "/iacrm_insureditems(item-1)" } }
    ]);
  });

  it("changes nothing when CRM has no insured item link on risk answers", async () => {
    const api = fakeApi([]);
    (api.getKnowledgeNavProps as ReturnType<typeof vi.fn>).mockResolvedValue({ accountNav: "a", questionNav: "q" });
    expect(await linkAnswersToInsuredItem(ENV, "ACC", ["capture:a"], "item-1", api)).toEqual({ linked: 0, skipped: "no-column" });
    expect(api.executeBatch).not.toHaveBeenCalled();
  });
});
