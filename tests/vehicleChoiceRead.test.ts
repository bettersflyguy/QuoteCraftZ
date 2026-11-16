// @vitest-environment jsdom
/** ADO 3710: "read all choices from page" for the vehicle choice fields
 * (Use, Performance, Anti-theft) when the saved control key no longer matches
 * the page: generated ids that change per render, a styled dropdown that is a
 * host element rather than an input, or a card suffix that changed. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Choices = { current: string; options: string[]; refused?: boolean } | null;
type Hint = { label?: string; section?: string };
const g = globalThis as unknown as {
  __bettersPortalChoices: (k: string, l: string[], h?: Hint) => Promise<Choices>;
  __bettersPortalScan: (p: unknown, o: unknown) => { key: string; fieldLabel: string }[];
};
const read = (key: string, hint?: Hint) => g.__bettersPortalChoices(key, [], hint);

/** an Angular-Material-like dropdown: options exist only while it is open */
function styledDropdown(id: string, label: string, current: string, options: string[]) {
  return `<label id="${id}-l">${label}</label>
    <div id="${id}" role="combobox" aria-labelledby="${id}-l"><span>${current}</span></div>`;
}
function wireOverlay(hostId: string, options: string[]) {
  const host = document.getElementById(hostId)!;
  const overlay = document.querySelector(".cdk-overlay-container")!;
  host.addEventListener("click", () => {
    overlay.innerHTML = `<div role="listbox">${options.map(o => `<mat-option role="option">${o}</mat-option>`).join("")}</div>`;
  });
  host.addEventListener("keydown", e => { if ((e as KeyboardEvent).key === "Escape") overlay.innerHTML = ""; });
}

describe("reading a vehicle choice field when the saved key is stale", () => {
  beforeAll(() => {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
    };
    Element.prototype.getClientRects = function (this: Element) {
      return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
    };
    for (const f of ["portal-mapper.js", "portal-fill.js"]) {
      // eslint-disable-next-line no-new-func
      new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
    }
  });

  it("finds a native select whose generated id changed after a re-render", async () => {
    document.body.innerHTML = `<label for="mat-select-12">Use</label>
      <select id="mat-select-12"><option value="">Select</option><option>Pleasure</option><option selected>Commute</option><option>Business</option></select>`;
    const saved = g.__bettersPortalScan(null, {}).find(r => r.fieldLabel === "Use")!;
    expect(saved.key).toBe("select:mat-select-12");
    document.body.innerHTML = `<label for="mat-select-48">Use</label>
      <select id="mat-select-48"><option value="">Select</option><option>Pleasure</option><option selected>Commute</option><option>Business</option></select>`;
    expect(await read(saved.key)).toEqual({ current: "Commute", options: ["Pleasure", "Commute", "Business"] });
  });

  it("finds a styled dropdown host that is not an input, by its exact key", async () => {
    document.body.innerHTML = styledDropdown("vehicle-use", "Use", "Commute", []) + `<div class="cdk-overlay-container"></div>`;
    wireOverlay("vehicle-use", ["Pleasure", "Commute", "Business"]);
    const r = await read("text:vehicle-use");
    expect(r).toEqual({ current: "Commute", options: ["Pleasure", "Commute", "Business"] });
    expect(document.querySelector(".cdk-overlay-container")!.innerHTML).toBe("");
  });

  it("finds a styled dropdown whose generated id changed", async () => {
    document.body.innerHTML = styledDropdown("mat-select-77", "Performance", "Standard", []) + `<div class="cdk-overlay-container"></div>`;
    wireOverlay("mat-select-77", ["Standard", "High Performance", "Sports"]);
    const r = await read("text:mat-select-5");
    expect(r?.options).toEqual(["Standard", "High Performance", "Sports"]);
  });

  it("falls back to the label the editor saw when the id is not recognisable", async () => {
    document.body.innerHTML = styledDropdown("veh-anti-theft-x9f", "Anti-theft", "Alarm", []) + `<div class="cdk-overlay-container"></div>`;
    wireOverlay("veh-anti-theft-x9f", ["None", "Alarm", "Tracking"]);
    // the key held an id that no longer exists; the label comes from the scan row
    const r = await read("text:veh-anti-theft-old", { label: "Anti-theft" });
    expect(r).toEqual({ current: "Alarm", options: ["None", "Alarm", "Tracking"] });
  });

  it("reads all three vehicle choice fields on one card", async () => {
    document.body.innerHTML = [
      styledDropdown("mat-select-101", "Use", "Commute", []),
      styledDropdown("mat-select-102", "Performance", "Standard", []),
      styledDropdown("mat-select-103", "Anti-theft", "Alarm", []),
      `<div class="cdk-overlay-container"></div>`
    ].join("");
    wireOverlay("mat-select-101", ["Pleasure", "Commute"]);
    wireOverlay("mat-select-102", ["Standard", "Sports"]);
    wireOverlay("mat-select-103", ["None", "Alarm"]);
    expect((await read("text:mat-select-1", { label: "Use" }))?.options).toEqual(["Pleasure", "Commute"]);
    expect((await read("text:mat-select-2", { label: "Performance" }))?.options).toEqual(["Standard", "Sports"]);
    expect((await read("text:mat-select-3", { label: "Anti-theft" }))?.options).toEqual(["None", "Alarm"]);
  });

  it("a changed card suffix reads nothing, the unchanged one reads its control", async () => {
    document.body.innerHTML = `
      <mat-expansion-panel><mat-expansion-panel-header><mat-panel-title>Vehicle Details</mat-panel-title></mat-expansion-panel-header>
        <label for="u1">Use</label><select id="u1"><option>Pleasure</option><option>Business</option></select></mat-expansion-panel>`;
    const r = await read("select:u-gone@vehicle details old card", { label: "Use", section: "vehicle details old card" });
    expect(r).toBeNull(); // the saved section is not on the page: not another one's field
    expect((await read("select:u-gone@vehicle details", { label: "Use", section: "vehicle details" }))?.options).toEqual(["Pleasure", "Business"]);
  });

  it("returns null when nothing on the page matches, and still refuses identifier fields", async () => {
    document.body.innerHTML = `<label for="a">Color</label><select id="a"><option>Red</option></select>
      <label for="ssn">SSN type</label><select id="ssn"><option>Full</option></select>`;
    expect(await read("select:mat-select-9", { label: "Use" })).toBeNull();
    expect(await read("select:mat-select-9")).toBeNull();
    expect((await read("select:gone", { label: "SSN type" }))?.refused).toBe(true);
  });

  it("never guesses between fields that share one generated-id shape when there is no label", async () => {
    document.body.innerHTML = styledDropdown("mat-select-101", "Use", "Commute", []) + styledDropdown("mat-select-102", "Performance", "Standard", []);
    expect(await read("text:mat-select-9")).toBeNull();
    expect(await read("text:mat-select-9", { label: "Color" })).toBeNull();
  });

  it("an exact key match still wins over a label match", async () => {
    document.body.innerHTML = `<label for="x">Use</label><select id="x"><option>One</option></select>
      <label for="y">Use</label><select id="y"><option>Two</option></select>`;
    expect((await read("select:y", { label: "Use" }))?.options).toEqual(["Two"]);
  });

  it("two vehicle cards with regenerated ids and the same label: no guess (never reads card 1 for card 2)", async () => {
    document.body.innerHTML = `
      <mat-expansion-panel><mat-expansion-panel-header><mat-panel-title>Vehicle 1</mat-panel-title></mat-expansion-panel-header>
        <label for="mat-select-21">Use</label><select id="mat-select-21"><option selected>Pleasure</option></select></mat-expansion-panel>
      <mat-expansion-panel><mat-expansion-panel-header><mat-panel-title>Vehicle 2</mat-panel-title></mat-expansion-panel-header>
        <label for="mat-select-22">Use</label><select id="mat-select-22"><option selected>Business</option></select></mat-expansion-panel>`;
    expect(await read("select:mat-select-9", { label: "Use", section: "" })).toBeNull();
    expect(await read("select:gone-id", { label: "Use" })).toBeNull();
  });

  it("a known section must match: a Vehicle Type is never read from the Driver Type", async () => {
    document.body.innerHTML = `
      <mat-expansion-panel><mat-expansion-panel-header><mat-panel-title>Driver Info</mat-panel-title></mat-expansion-panel-header>
        <label for="dt">Type</label><select id="dt"><option selected>Primary</option></select></mat-expansion-panel>
      <mat-expansion-panel><mat-expansion-panel-header><mat-panel-title>Other Section</mat-panel-title></mat-expansion-panel-header>
        <label for="ot">Type</label><select id="ot"><option selected>Other</option></select></mat-expansion-panel>`;
    // saved under "vehicle details", which is not on this page: no other section stands in
    expect(await read("select:vtype-old@vehicle details", { label: "Type", section: "vehicle details" })).toBeNull();
    expect(await read("select:mat-select-5@vehicle details", { label: "Type", section: "vehicle details" })).toBeNull();
    // the section that does match is read
    expect((await read("select:vtype-old@driver info", { label: "Type", section: "driver info" }))?.current).toBe("Primary");
  });

  it("never reads a password or hidden input, even when its stale key and label match", async () => {
    document.body.innerHTML = `<label for="mat-input-7">Use</label><input type="password" id="mat-input-7" value="hunter2">
      <label for="mat-input-8">Use</label><input type="hidden" id="mat-input-8" value="secret">`;
    expect(await read("text:mat-input-3", { label: "Use" })).toBeNull();
    expect(await read("password:mat-input-7", { label: "Use" })).toBeNull();
    expect(await read("text:mat-input-7")).toBeNull();
  });

  it("respects the key's tag: a stale select key does not read a text input", async () => {
    document.body.innerHTML = `<label for="mat-input-7">Use</label><input type="text" id="mat-input-7" value="Commute">`;
    expect(await read("select:mat-input-3", { label: "Use" })).toBeNull();
    expect((await read("text:mat-input-3", { label: "Use" }))?.current).toBe("Commute");
  });

  it("stays fast on a page with 1,500 controls (the label lookup is not quadratic)", async () => {
    let h = "";
    for (let i = 0; i < 1500; i++) h += `<div><label for="mat-select-${i}">Field ${i}</label><select id="mat-select-${i}"><option>a</option></select></div>`;
    h += `<label for="mat-select-use">Use</label><select id="mat-select-use"><option selected>Business</option></select>`;
    document.body.innerHTML = h;
    const t0 = Date.now();
    const found = await read("select:mat-select-gone", { label: "Use" });
    const missing = await read("select:other-gone", { label: "Nothing here" });
    const noLabel = await read("select:mat-select-9999");
    expect(found?.current).toBe("Business");
    expect(missing).toBeNull();
    expect(noLabel).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000); // 47-100 s before the single-pass label index
  }, 30000);
});
