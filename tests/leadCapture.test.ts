// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mergeLeadCapture } from "@/portal/leadCapture";
import type { CapturedAppField } from "@/boldpenguin/types";

const g = globalThis as unknown as {
  __bettersLead: { pick(ms: number): Promise<unknown>; get(): { el: Element }; clear(): void };
  __bettersOneLead: boolean;
  __bettersPortalIngest(t?: unknown, c?: unknown, one?: boolean): { fields: CapturedAppField[]; leadKey?: string; secure: unknown[] };
};
beforeAll(() => {
  (globalThis as { CSS?: { escape(s: string): string } }).CSS ??= { escape: s => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
  for (const script of ["portal-lead.js", "portal-ingest.js"]) new Function(readFileSync(path.resolve(__dirname, "../public/portal", script), "utf8"))();
});
afterEach(() => { g.__bettersLead.clear(); g.__bettersOneLead = false; document.body.innerHTML = ""; });
function page() {
  document.body.innerHTML = ["FIRST1", "SECOND2"].map((id, i) => `<section id="lead${i}"><div>Receipt code: ${id}</div><dl><dt>First Name</dt><dd>${i ? "Alex" : "Jordan"}</dd><dt>Last Name</dt><dd>${i ? "Rivera" : "Miller"}</dd><dt>Phone</dt><dd>${i ? "7085550193" : "2175550148"}</dd></dl><table><tr><td>Current Carrier</td><td>${i ? "Safeco" : "Progressive"}</td></tr></table></section>`).join("");
}
async function select(id: string) {
  const promise = g.__bettersLead.pick(5000);
  const el = document.querySelector(id)!;
  el.dispatchEvent(new MouseEvent("pointermove", { bubbles:true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true }));
  await promise;
}
describe("One Lead capture boundary", () => {
  it("reads only the second expanded lead, including read-only values", async () => {
    page(); await select("#lead1 dd");
    const result = g.__bettersPortalIngest(undefined, undefined, true);
    expect(result.leadKey).toContain("SECOND2");
    expect(result.fields.some(f => f.value === "Alex")).toBe(true);
    expect(result.fields.some(f => f.value === "Safeco")).toBe(true);
    expect(result.fields.some(f => /Jordan|Miller|Progressive|2175550148/.test(f.value))).toBe(false);
  });
  it("does not harvest taught/secured values outside the selected root", async () => {
    page(); await select("#lead1 dd");
    const result = g.__bettersPortalIngest([{ selector:"#lead0 dd", label:"Secret", path:"secure:contacts1.iacrm_ssn" }], undefined, true);
    expect(result.secure).toEqual([]);
  });
  it("pauses on collapse, replacement and identity change, never broadening the read", async () => {
    page(); await select("#lead1 dd");
    const el = document.querySelector("#lead1")! as HTMLElement;
    el.hidden = true;
    expect(() => g.__bettersPortalIngest(undefined, undefined, true)).toThrow(/paused/);
    el.hidden = false;
    el.querySelector("div")!.textContent = "Receipt code: NEWLEAD3";
    expect(() => g.__bettersPortalIngest(undefined, undefined, true)).toThrow(/paused/);
    el.replaceWith(el.cloneNode(true));
    expect(() => g.__bettersPortalIngest(undefined, undefined, true)).toThrow(/paused/);
  });
  it("keeps normal page-wide ingest after leaving One Lead mode", async () => {
    page(); await select("#lead1 dd");g.__bettersLead.clear();g.__bettersOneLead = false;
    const values = g.__bettersPortalIngest().fields.map(f => f.value);
    expect(values).toContain("Jordan");expect(values).toContain("Alex");
  });
  it("starts fresh for a different lead even when capturing only policy data", () => {
    const field = (value:string): CapturedAppField => ({ label:"Current Carrier", value, source:"table", section:"Policy", group:"" });
    const site = { system:"Datalot", url:"https://example.test", title:"Leads" };
    const first = mergeLeadCapture(null, [field("Progressive")], {...site,leadKey:"one"});
    const second = mergeLeadCapture(first.app, [field("Safeco")], {...site,leadKey:"two"});
    expect(second.replaced).toBe(true);expect(second.app.source.leadKey).toBe("two");
    expect(second.app.fields.map(f=>f.value)).toEqual(["Safeco"]);
    const repeat = mergeLeadCapture(second.app, [field("Safeco")], {...site,leadKey:"two"});
    expect(repeat.replaced).toBe(false);expect(repeat.app.fields).toHaveLength(1);
  });
});
