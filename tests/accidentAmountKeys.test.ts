// @vitest-environment jsdom
/** ADO 3712: an EZLynx accident card has four amount boxes (BI, Collision, MP,
 * PD) that share ONE name and id (one amount component). They used to get one
 * control key, so one mapping covered all four and the panel counted them as
 * "4 rows". Boxes that share a key but carry different labels now each get
 * their own key, while every key saved before the change keeps resolving
 * exactly as it did. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Row = { key: string; label: string; repeats?: number; mapped: string | null };
type Field = { label: string; value: string; mapped?: string; group?: string };
const g = globalThis as unknown as {
  __bettersControlKey: (el: Element) => string;
  __bettersPortalScan: (p: unknown, o: unknown) => Row[];
  __bettersPortalIngest: (taught: unknown, controls: unknown) => { fields: Field[] };
  __bettersPortalFill: (p: unknown, o: boolean, a: boolean, ov: unknown) => Promise<Record<string, unknown>>;
  __bettersPortalChoices: (k: string, l: string[], h?: unknown) => Promise<{ current: string } | null>;
};

beforeAll(() => {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 40, width: 80, height: 16, right: 90, bottom: 56, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    return (this.isConnected ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  };
  for (const f of ["portal-mapper.js", "portal-fill.js", "portal-ingest.js"]) {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
  }
});

const AMOUNTS = ["BI Amount", "Collision Amount", "MP Amount", "PD Amount"];
type Shape = "name-and-id" | "name-only" | "id-only";

/** one accident card; the four boxes share a name and/or an id. A shared id
 * makes every label[for] point at the first box, as a duplicated id does. */
function accident(title: string, values: string[], shape: Shape = "name-and-id") {
  const attrs = shape === "name-only" ? `name="amount"` : shape === "id-only" ? `id="amount"` : `name="amount" id="amount"`;
  const boxes = AMOUNTS.map((label, i) => {
    const forAttr = shape === "name-only" ? "" : ` for="amount"`;
    return `<mat-form-field class="mat-mdc-form-field"><label${forAttr}>${label}</label><input ${attrs} value="${values[i]}"></mat-form-field>`;
  }).join("");
  return `<div class="card"><span>${title}</span>${boxes}</div>`;
}
const page = (...cards: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${cards.join("")}</main>`; };
const inputs = () => Array.from(document.querySelectorAll("input"));
const ingest = (map: unknown) => g.__bettersPortalIngest([], map).fields;

describe("the four amount boxes of one accident", () => {
  for (const shape of ["name-and-id", "name-only", "id-only"] as Shape[]) {
    it(`get four separate keys and four separate rows when they share ${shape}`, () => {
      page(accident("Accident 1", ["5000", "2000", "1000", "700"], shape));
      const keys = inputs().map(i => g.__bettersControlKey(i));
      expect(new Set(keys).size).toBe(4);
      keys.forEach(k => expect(k).toContain("~"));
      const rows = g.__bettersPortalScan(null, {});
      expect(rows.map(r => r.label)).toEqual(AMOUNTS);
      rows.forEach(r => expect(r.repeats).toBe(1));
    });
  }

  it("map to four different CRM fields, each keeping its own value", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const [bi, col, mp, pd] = inputs().map(i => g.__bettersControlKey(i));
    const fields = ingest({
      [bi!]: "crm:incident.biamount", [col!]: "crm:incident.collisionamount",
      [mp!]: "crm:incident.mpamount", [pd!]: "crm:incident.pdamount"
    }).filter(f => f.mapped?.startsWith("crm:incident."));
    expect(fields.map(f => `${f.mapped}=${f.value}`).sort()).toEqual([
      "crm:incident.biamount=5000", "crm:incident.collisionamount=2000",
      "crm:incident.mpamount=1000", "crm:incident.pdamount=700"
    ]);
    expect(fields.map(f => f.label).sort()).toEqual([...AMOUNTS].sort());
  });

  it("with two accidents each amount stays its own field and never takes another amount's value", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]), accident("Accident 2", ["9000", "3000", "1500", "400"]));
    const keys = inputs().map(i => g.__bettersControlKey(i));
    // the same box on both cards is the same field: one key per amount, not eight
    expect(new Set(keys).size).toBe(4);
    expect(keys.slice(0, 4)).toEqual(keys.slice(4));
    const map = { [keys[0]!]: "crm:incident.biamount", [keys[1]!]: "crm:incident.collisionamount", [keys[2]!]: "crm:incident.mpamount", [keys[3]!]: "crm:incident.pdamount" };
    const mapped = ingest(map).filter(f => f.mapped?.startsWith("crm:incident."));
    const by = (p: string) => mapped.filter(f => f.mapped === p).map(f => f.value);
    expect(by("crm:incident.biamount")).toEqual(["5000", "9000"]);
    expect(by("crm:incident.collisionamount")).toEqual(["2000", "3000"]);
    expect(by("crm:incident.mpamount")).toEqual(["1000", "1500"]);
    expect(by("crm:incident.pdamount")).toEqual(["700", "400"]);
  });

  it("a lone amount box, or boxes with the SAME label, keep the legacy key", () => {
    document.body.innerHTML = `<main><mat-form-field class="mat-mdc-form-field"><label>Amount</label><input name="amount" id="amount"></mat-form-field></main>`;
    expect(g.__bettersControlKey(inputs()[0]!)).toBe("text:amount");
    // the same field on two cards: one shared key, as the driver cards rely on
    document.body.innerHTML = `<main>${["A", "B"].map(t => `<div><span>${t}</span><mat-form-field class="mat-mdc-form-field"><label>First Name</label><input name="firstName"></mat-form-field></div>`).join("")}</main>`;
    expect(inputs().map(i => g.__bettersControlKey(i))).toEqual(["text:firstName", "text:firstName"]);
  });
});

describe("a mapping saved under the key the boxes shared before", () => {
  const LEGACY = "text:amount";

  it("still resolves on every box, in the panel, the capture and the fill", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const ov = { [LEGACY]: "crm:incident.amountpaid" };
    expect(g.__bettersPortalScan(null, ov).map(r => r.mapped)).toEqual(Array(4).fill("crm:incident.amountpaid"));
    const fields = ingest(ov).filter(f => f.mapped === "crm:incident.amountpaid");
    expect(fields.map(f => f.value)).toEqual(["5000", "2000", "1000", "700"]);
    inputs().forEach(i => { i.value = ""; });
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.amountpaid": "123" } }, true, false, ov);
    expect(inputs().map(i => i.value)).toEqual(["123", "123", "123", "123"]);
  }, 20000);

  it("a legacy note mapping still turns the four boxes into rows of one table, as it did", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const rows = ingest({ [LEGACY]: "note:contacts[]" }).filter(f => f.mapped?.startsWith("note:"));
    expect(rows.map(f => f.group).sort()).toEqual(["Row 1", "Row 2", "Row 3", "Row 4"]);
  });

  it("is read by the choice reader on the first box, as before", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    expect((await g.__bettersPortalChoices(LEGACY, []))?.current).toBe("5000");
  });

  it("is overridden box by box once the owner maps that box on its own", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const [bi] = inputs().map(i => g.__bettersControlKey(i));
    const ov = { [LEGACY]: "crm:incident.amountpaid", [bi!]: "crm:incident.biamount" };
    expect(g.__bettersPortalScan(null, ov).map(r => r.mapped)).toEqual(
      ["crm:incident.biamount", "crm:incident.amountpaid", "crm:incident.amountpaid", "crm:incident.amountpaid"]);
    expect(ingest(ov).filter(f => f.mapped?.startsWith("crm:incident.")).map(f => `${f.mapped}=${f.value}`)).toEqual([
      "crm:incident.biamount=5000", "crm:incident.amountpaid=2000", "crm:incident.amountpaid=1000", "crm:incident.amountpaid=700"]);
  });

  it("never changes the key of a control that has no shared key (every other saved mapping)", () => {
    document.body.innerHTML = `<main>
      <label for="county">County</label><input id="county" name="county" type="text">
      <label>Notes<input type="text"></label>
      <fieldset><legend>Smoker</legend><label><input type="radio" name="smoker" value="y">Yes</label><label><input type="radio" name="smoker" value="n">No</label></fieldset>
      <select name="use"><option>a</option></select></main>`;
    expect(Array.from(document.querySelectorAll("input, select")).map(i => g.__bettersControlKey(i)))
      .toEqual(["text:county", "text:notes", "radio:smoker", "radio:smoker", "select:use"]);
  });
});
