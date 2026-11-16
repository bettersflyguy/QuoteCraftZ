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
/** what the Mappings panel's Save writes: the draft is seeded from the scan rows
 * (MappingsManager.scan), `edits` are the owner's changes, empty entries are dropped
 * (MappingsManager.saveScan) and the result REPLACES the site's whole map. */
function save(saved: Record<string, string>, edits: Record<string, string> = {}) {
  const d: Record<string, string> = {};
  for (const r of g.__bettersPortalScan(null, saved) as (Row & { payment?: boolean; autoPath?: string | null })[]) {
    d[r.key] = r.mapped ?? (r.payment ? "" : r.autoPath ?? "");
  }
  Object.assign(d, edits);
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (v) map[k] = v;
  return map;
}
const canonicalCalls = () => {
  const m = (globalThis as unknown as { BettersPortalMapper: { canonical: (s: string) => string } }).BettersPortalMapper;
  const real = m.canonical;
  let calls = 0;
  m.canonical = (x: string) => { calls += 1; return real(x); };
  return { count: () => calls, restore: () => { m.canonical = real; } };
};

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
    // the panel lists the old key as a row of its own, carrying the mapping
    const rows = g.__bettersPortalScan(null, ov);
    expect(rows.filter(r => r.key === LEGACY).map(r => r.mapped)).toEqual(["crm:incident.amountpaid"]);
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

  it("is not read by the choice reader as 'the first of four boxes' (a key that matches several is refused)", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    expect(await g.__bettersPortalChoices(LEGACY, [])).toBeNull();
    // each box is still read by its own key
    const keys = inputs().map(i => g.__bettersControlKey(i));
    expect((await g.__bettersPortalChoices(keys[2]!, []))?.current).toBe("1000");
  });

  it("survives a Save in the Mappings panel untouched: not dropped, not copied onto four boxes", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const saved = { [LEGACY]: "note:contacts[]" };
    expect(save(saved)).toEqual(saved);
    // and the capture still groups the four boxes as Row 1 to 4 after that Save
    const rows = ingest(save(saved)).filter(f => f.mapped?.startsWith("note:"));
    expect(rows.map(f => f.group).sort()).toEqual(["Row 1", "Row 2", "Row 3", "Row 4"]);
  });

  it("keeps every one of 78 saved mappings, with the same values, through a Save", () => {
    const plain = Array.from({ length: 77 }, (_, i) => `<label for="f${i}">Field ${i}</label><input id="f${i}" name="f${i}">`).join("");
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${plain}${accident("Accident 1", ["5000", "2000", "1000", "700"])}</main>`;
    const saved: Record<string, string> = { [LEGACY]: "crm:incident.amountpaid" };
    for (let i = 0; i < 77; i++) saved[`text:f${i}`] = i % 2 ? "crm:account.address1_county" : "skip";
    expect(Object.keys(saved)).toHaveLength(78);
    expect(save(saved)).toEqual(saved);
  });

  it("a Save after mapping ONE box adds that box's key and still keeps the old key", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const bi = g.__bettersControlKey(inputs()[0]!);
    expect(save({ [LEGACY]: "crm:incident.amountpaid" }, { [bi]: "crm:incident.biamount" }))
      .toEqual({ [LEGACY]: "crm:incident.amountpaid", [bi]: "crm:incident.biamount" });
  });

  it("is overridden box by box once the owner maps that box on its own", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const [bi] = inputs().map(i => g.__bettersControlKey(i));
    const ov = { [LEGACY]: "crm:incident.amountpaid", [bi!]: "crm:incident.biamount" };
    expect(g.__bettersPortalScan(null, ov).map(r => r.mapped)).toEqual(
      ["crm:incident.biamount", "", "", "", "crm:incident.amountpaid"]);
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

describe("computing the keys stays linear (counted, not timed)", () => {
  const N = 60;
  const grid = () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${Array.from({ length: N }, (_, i) =>
      `<mat-form-field class="mat-mdc-form-field"><label>Amount ${i}</label><input name="amount" id="amount" value="${i}"></mat-form-field>`).join("")}</main>`;
  };
  // the old per-call label lookup cost about N * N = 3,600 canonical calls here
  const LIMIT = 10 * N;

  it("a scan", () => {
    grid();
    const c = canonicalCalls();
    try {
      const rows = g.__bettersPortalScan(null, {});
      expect(rows).toHaveLength(N);
      expect(c.count()).toBeLessThanOrEqual(LIMIT);
    } finally { c.restore(); }
  });

  it("a capture", () => {
    grid();
    const c = canonicalCalls();
    try {
      ingest({ "text:amount": "crm:incident.amountpaid" });
      expect(c.count()).toBeLessThanOrEqual(LIMIT);
    } finally { c.restore(); }
  });

  it("a fill pass", async () => {
    grid();
    const c = canonicalCalls();
    try {
      await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.amountpaid": "1" } }, true, false, { "text:amount": "crm:incident.amountpaid" });
      expect(c.count()).toBeLessThanOrEqual(LIMIT);
    } finally { c.restore(); }
  }, 60000);
});
