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

  it("FAILS CLOSED on a page of differently-labelled boxes: nothing filled, nothing captured, rows flagged, key kept", async () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    const ov = { [LEGACY]: "crm:incident.amountpaid" };
    // the panel lists the old key as a row of its own, still carrying the mapping, flagged for re-teach
    const rows = g.__bettersPortalScan(null, ov) as (Row & { needsReteach?: boolean })[];
    const old = rows.filter(r => r.key === LEGACY);
    expect(old.map(r => r.mapped)).toEqual(["crm:incident.amountpaid"]);
    expect(old.map(r => r.needsReteach)).toEqual([true]);
    // each box row shows no mapping and is flagged too
    const boxes = rows.filter(r => r.key !== LEGACY);
    expect(boxes).toHaveLength(4);
    boxes.forEach(r => { expect(r.mapped).toBe(""); expect(r.needsReteach).toBe(true); expect(r.label).toContain("re-teach"); });
    // capture routes nothing to any CRM column
    expect(ingest(ov).filter(f => f.mapped)).toEqual([]);
    // fill writes nothing
    inputs().forEach(i => { i.value = ""; });
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.amountpaid": "123" } }, true, false, ov);
    expect(inputs().map(i => i.value)).toEqual(["", "", "", ""]);
  }, 20000);

  it("the residual case: BI taught alone, then all four boxes shown, routes nothing from the shared key", async () => {
    // BI is the only same-name box in the page when it is taught: its key is the shared key
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main><mat-form-field class="mat-mdc-form-field"><label>BI Amount</label><input name="amount" id="amount" value="5000"></mat-form-field></main>`;
    expect(inputs()).toHaveLength(1);
    const taught = g.__bettersControlKey(inputs()[0]!);
    expect(taught).toBe(LEGACY);
    const saved = { [taught]: "crm:incident.biamount" };
    // still works on that page, as today
    expect(ingest(saved).filter(f => f.mapped).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.biamount=5000"]);
    await Promise.resolve();
    // all four boxes appear
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    expect(ingest(saved).filter(f => f.mapped)).toEqual([]);
    inputs().forEach(i => { i.value = ""; });
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount": "42" } }, true, false, saved);
    expect(inputs().map(i => i.value)).toEqual(["", "", "", ""]);
    const rows = g.__bettersPortalScan(null, saved) as (Row & { needsReteach?: boolean })[];
    expect(rows.filter(r => r.needsReteach)).toHaveLength(5);
  }, 20000);

  it("a legacy-only mapping on a page with ONE box still fills and captures, as today", async () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main><mat-form-field class="mat-mdc-form-field"><label>BI Amount</label><input name="amount" id="amount" value="5000"></mat-form-field></main>`;
    const ov = { [LEGACY]: "crm:incident.amountpaid" };
    expect(ingest(ov).filter(f => f.mapped).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.amountpaid=5000"]);
    inputs()[0]!.value = "";
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.amountpaid": "9" } }, true, false, ov);
    expect(inputs()[0]!.value).toBe("9");
    const rows = g.__bettersPortalScan(null, ov) as (Row & { needsReteach?: boolean })[];
    expect(rows.map(r => [r.key, r.mapped, r.needsReteach ?? false])).toEqual([[LEGACY, "crm:incident.amountpaid", false]]);
  }, 20000);

  it("a legacy note mapping is refused on the four boxes too, not turned into rows of one table", () => {
    page(accident("Accident 1", ["5000", "2000", "1000", "700"]));
    expect(ingest({ [LEGACY]: "note:contacts[]" }).filter(f => f.mapped?.startsWith("note:"))).toEqual([]);
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
    // and the capture, which refuses it on these four boxes, refuses it the same way after that Save
    expect(ingest(save(saved)).filter(f => f.mapped?.startsWith("note:"))).toEqual([]);
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
    // BI uses its own mapping; the other three get nothing from the shared key
    expect(ingest(ov).filter(f => f.mapped?.startsWith("crm:incident.")).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.biamount=5000"]);
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

describe("a mapping on a box's own-label key follows the box whatever else is on the page", () => {
  const LEGACY = "text:amount";
  const one = (label: string, value: string, extra = "") => `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input name="amount" id="amount" value="${value}" ${extra}></mat-form-field>`;
  const show = (...boxes: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${boxes.join("")}</main>`; };
  const tick = () => Promise.resolve();

  it("A: BI mapped beside Collision, then shown alone: the mapping still applies and survives a Save", async () => {
    show(one("BI Amount", "5000"), one("Collision Amount", "2000"));
    const [bi] = inputs().map(i => g.__bettersControlKey(i));
    const saved = { [bi!]: "crm:incident.biamount" };
    await tick();
    show(one("BI Amount", "5000"));
    expect(g.__bettersControlKey(inputs()[0]!)).toBe(LEGACY);
    expect(ingest(saved).filter(f => f.mapped?.startsWith("crm:incident.")).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.biamount=5000"]);
    expect(g.__bettersPortalScan(null, saved).filter(r => r.key === bi).map(r => r.mapped)).toEqual(["crm:incident.biamount"]);
    expect(save(saved)).toEqual(saved);
    inputs()[0]!.value = "";
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount": "42" } }, true, false, saved);
    expect(inputs()[0]!.value).toBe("42");
  }, 20000);

  it("B: a legacy mapping (BI alone) plus a Collision mapping: Collision shown alone goes to the Collision field", async () => {
    show(one("BI Amount", "5000"), one("Collision Amount", "2000"));
    const [, col] = inputs().map(i => g.__bettersControlKey(i));
    const saved = { [LEGACY]: "crm:incident.biamount", [col!]: "crm:incident.collisionamount" };
    await tick();
    show(one("Collision Amount", "2000"));
    expect(ingest(saved).filter(f => f.mapped?.startsWith("crm:incident.")).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.collisionamount=2000"]);
    // both keys survive a Save
    expect(save(saved)).toEqual(saved);
  });

  it("the choice reader finds a box by its own-label key when it is alone", async () => {
    show(one("BI Amount", "5000"), one("Collision Amount", "2000"));
    const [bi] = inputs().map(i => g.__bettersControlKey(i));
    await tick();
    show(one("BI Amount", "5000"));
    expect((await g.__bettersPortalChoices(bi!, []))?.current).toBe("5000");
  });
});

describe("the boxes that count as sharing a key", () => {
  const one = (label: string, extra = "", type = "text") => `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input type="${type}" name="amount" id="amount" ${extra}></mat-form-field>`;
  const first = (...boxes: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${boxes.join("")}</main>`; return g.__bettersControlKey(inputs()[0]!); };

  it("ignores hidden and image controls, but counts read-only and disabled ones (the capture reads them)", async () => {
    expect(first(one("BI Amount"), one("Collision Amount", 'style="display:none"'))).toBe("text:amount");
    await Promise.resolve();
    expect(first(one("BI Amount"), one("Collision Amount", "", "image"))).toBe("text:amount");
    await Promise.resolve();
    expect(first(one("BI Amount"), one("Collision Amount", "disabled"))).toContain("~");
    await Promise.resolve();
    expect(first(one("BI Amount"), one("Collision Amount", "readonly"))).toContain("~");
    await Promise.resolve();
    expect(first(one("BI Amount"), one("Collision Amount"))).toContain("~");
  });

  it("ignores controls outside the open dialog", async () => {
    await Promise.resolve();
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${one("Collision Amount")}</main><div role="dialog">${one("BI Amount")}</div>`;
    // a dialog only owns the page when it is dialog-sized
    const dialog = document.querySelector("[role='dialog']") as HTMLElement;
    dialog.getBoundingClientRect = () => ({ left: 100, top: 100, width: 800, height: 600, right: 900, bottom: 700, x: 100, y: 100, toJSON() { return {}; } }) as DOMRect;
    expect(g.__bettersControlKey(document.querySelectorAll("input")[1]!)).toBe("text:amount");
  });
});

describe("picking a box in the panel", () => {
  const one = (label: string, value: string) => `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input name="amount" id="amount" value="${value}"></mat-form-field>`;
  const show = (...boxes: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${boxes.join("")}</main>`; };
  const pick = (ov: unknown, el: Element) => {
    const g2 = globalThis as unknown as { __bettersPortalPick: (t: number, o: unknown) => Promise<Row & { key: string }> };
    const pending = g2.__bettersPortalPick(5000, ov);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    return pending;
  };

  it("picking BI alone returns the key its mapping lives under, so the new mapping fills BI and never Collision", async () => {
    show(one("BI Amount", "5000"), one("Collision Amount", "2000"));
    const [bi] = inputs().map(i => g.__bettersControlKey(i));
    const saved = { [bi!]: "crm:incident.biamount" };
    await Promise.resolve();
    show(one("BI Amount", "5000"));
    const row = await pick(saved, inputs()[0]!);
    expect(row.key).toBe(bi);
    // the owner re-maps BI from that row: saved under the key BI fills from
    const remapped = { ...saved, [row.key]: "crm:incident.biamount2" };
    inputs()[0]!.value = "";
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount2": "42" } }, true, false, remapped);
    expect(inputs()[0]!.value).toBe("42");
    // Collision, shown alone later, is not touched by BI's mapping
    await Promise.resolve();
    show(one("Collision Amount", "2000"));
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount2": "42" } }, true, false, remapped);
    expect(inputs()[0]!.value).toBe("2000");
  }, 20000);

  it("a box with no mapping yet is still keyed as before (nothing changes for a first pick)", async () => {
    show(one("BI Amount", "5000"));
    expect((await pick({}, inputs()[0]!)).key).toBe("text:amount");
  });
});

describe("teaching a box while only some of the same-name boxes are on screen", () => {
  const box = (label: string, value: string, hidden = false) =>
    `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input name="amount" id="amount" value="${value}" ${hidden ? 'style="display:none"' : ""}></mat-form-field>`;
  const show = (...boxes: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${boxes.join("")}</main>`; };
  const pickAt = (ov: unknown, el: Element) => {
    const api = globalThis as unknown as { __bettersPortalPick: (t: number, o: unknown) => Promise<{ key: string }> };
    const pending = api.__bettersPortalPick(5000, ov);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    return pending;
  };

  it("BI picked while the other three are collapsed is keyed by its own label, so showing all four later cross-writes nothing", async () => {
    show(box("BI Amount", "5000"), box("Collision Amount", "2000", true), box("MP Amount", "1000", true), box("PD Amount", "700", true));
    const row = await pickAt({}, inputs()[0]!);
    expect(row.key).toBe("text:amount~bi amount");
    const saved = { [row.key]: "crm:incident.biamount" };
    await Promise.resolve();
    show(box("BI Amount", "5000"), box("Collision Amount", "2000"), box("MP Amount", "1000"), box("PD Amount", "700"));
    expect(ingest(saved).filter(f => f.mapped?.startsWith("crm:incident.")).map(f => `${f.mapped}=${f.value}`)).toEqual(["crm:incident.biamount=5000"]);
    inputs().forEach(i => { i.value = ""; });
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount": "42" } }, true, false, saved);
    expect(inputs().map(i => i.value)).toEqual(["42", "", "", ""]);
  }, 20000);

  it("a site whose map already holds an own-label key on that name keys the next box by its own label", async () => {
    show(box("Collision Amount", "2000"));
    const row = await pickAt({ "text:amount~bi amount": "crm:incident.biamount" }, inputs()[0]!);
    expect(row.key).toBe("text:amount~collision amount");
  });

  it("a legacy-only mapping still fills a single box", async () => {
    show(box("BI Amount", "5000"));
    inputs()[0]!.value = "";
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.amountpaid": "9" } }, true, false, { "text:amount": "crm:incident.amountpaid" });
    expect(inputs()[0]!.value).toBe("9");
  });
});

describe("label lookups stay linear on a page of same-id boxes (counted, not timed)", () => {
  const N = 300;
  const grid = () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${Array.from({ length: N }, (_, i) =>
      `<mat-form-field class="mat-mdc-form-field"><label for="amount">Amount ${i}</label><input name="amount" id="amount" value="${i}"></mat-form-field>`).join("")}</main>`;
  };
  const countDocumentQueries = (run: () => void) => {
    const realAll = Document.prototype.querySelectorAll;
    const realOne = Document.prototype.querySelector;
    let calls = 0;
    Document.prototype.querySelectorAll = function (this: Document, sel: string) { calls += 1; return realAll.call(this, sel); } as typeof realAll;
    Document.prototype.querySelector = function (this: Document, sel: string) { calls += 1; return realOne.call(this, sel); } as typeof realOne;
    try { run(); } finally { Document.prototype.querySelectorAll = realAll; Document.prototype.querySelector = realOne; }
    return calls;
  };

  it("a scan", () => {
    grid();
    // a document-wide query per control would be 300 or more
    expect(countDocumentQueries(() => { g.__bettersPortalScan(null, {}); })).toBeLessThanOrEqual(N / 2);
  });

  it("a capture", () => {
    grid();
    expect(countDocumentQueries(() => { ingest({ "text:amount": "crm:incident.amountpaid" }); })).toBeLessThanOrEqual(N / 2);
  });
});

describe("picking a box the scan would not list", () => {
  it("a read-only box that shares its name with one other box counts as one, not two", async () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>
      <mat-form-field class="mat-mdc-form-field"><label>BI Amount</label><input name="amount" id="amount" value="5000" readonly></mat-form-field>
      <mat-form-field class="mat-mdc-form-field"><label>Collision Amount</label><input name="amount" id="amount" value="2000"></mat-form-field></main>`;
    const api = globalThis as unknown as { __bettersPortalPick: (t: number, o: unknown) => Promise<{ key: string; repeats: number }> };
    const pending = api.__bettersPortalPick(5000, {});
    inputs()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    expect((await pending).repeats).toBe(1);
  });
});

describe("a fill that relabels another box mid-pass", () => {
  it("the next box is keyed by its NEW label, not from the cache the pass started with", async () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>
      <mat-form-field class="mat-mdc-form-field"><label>BI Amount</label><input name="amount" id="amount"></mat-form-field>
      <mat-form-field class="mat-mdc-form-field"><label id="second">Collision Amount</label><input name="amount" id="amount"></mat-form-field></main>`;
    const [bi, col] = inputs().map(i => g.__bettersControlKey(i));
    // filling BI makes the page re-render the second box's label as "PD Amount"
    inputs()[0]!.addEventListener("change", () => { document.getElementById("second")!.textContent = "PD Amount"; });
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.bi": "1", "crm:incident.col": "2" } }, true, false,
      { [bi!]: "crm:incident.bi", [col!]: "crm:incident.col" });
    // the second box is now the PD box: the mapping saved for "Collision Amount" must not fill it
    expect(inputs().map(i => i.value)).toEqual(["1", ""]);
  }, 20000);
});

describe("the shared key fails closed when the sibling boxes are read-only or disabled", () => {
  const LEGACY = "text:amount";
  const saved = { [LEGACY]: "crm:incident.biamount" };
  const box = (label: string, value: string, attr = "") =>
    `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input name="amount" id="amount" value="${value}" ${attr}></mat-form-field>`;
  const show = (...boxes: string[]) => { document.title = "Tracy Dittrich - Accidents"; document.body.innerHTML = `<main>${boxes.join("")}</main>`; };
  const routed = () => ingest(saved).filter(f => f.mapped).map(f => `${f.mapped}=${f.value}`);

  it("all four boxes read-only: nothing is captured from the shared key", () => {
    show(box("BI Amount", "5000", "readonly"), box("Collision Amount", "2000", "readonly"), box("MP Amount", "1000", "readonly"), box("PD Amount", "700", "readonly"));
    expect(routed()).toEqual([]);
  });

  it("BI editable, the other three disabled: nothing is captured, and the scan flags BI and the old key", () => {
    show(box("BI Amount", "5000"), box("Collision Amount", "2000", "disabled"), box("MP Amount", "1000", "disabled"), box("PD Amount", "700", "disabled"));
    expect(routed()).toEqual([]);
    const rows = g.__bettersPortalScan(null, saved) as (Row & { needsReteach?: boolean })[];
    expect(rows.filter(r => r.needsReteach).map(r => r.key).sort()).toHaveLength(2);
    expect(rows.find(r => r.key === LEGACY)?.mapped).toBe("crm:incident.biamount");
  });

  it("BI editable, the other three read-only: nothing is captured, and the scan flags BI and the old key", () => {
    show(box("BI Amount", "5000"), box("Collision Amount", "2000", "readonly"), box("MP Amount", "1000", "readonly"), box("PD Amount", "700", "readonly"));
    expect(routed()).toEqual([]);
    const rows = g.__bettersPortalScan(null, saved) as (Row & { needsReteach?: boolean })[];
    expect(rows.filter(r => r.needsReteach)).toHaveLength(2);
  });

  it("siblings inside a display:none container (a hidden tab pane) are still grouped: nothing is captured from the shared key", () => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${box("BI Amount", "5000")}
      <div style="display:none">${box("Collision Amount", "2000")}${box("MP Amount", "1000")}${box("PD Amount", "700")}</div></main>`;
    // real layout gives a box inside a display:none container no size: fill's visible() rejects it
    // while the capture, which looks only at the box's own style, still reads it
    Array.from(document.querySelectorAll<HTMLInputElement>("div[style] input")).forEach((el) => {
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    });
    expect(inputs()).toHaveLength(4);
    expect(routed()).toEqual([]);
  });

  it("a one-box legacy page is unchanged: it captures and fills as today", async () => {
    show(box("BI Amount", "5000"));
    expect(routed()).toEqual(["crm:incident.biamount=5000"]);
    inputs()[0]!.value = "";
    await g.__bettersPortalFill({ normalized: {}, fields: [], values: { "crm:incident.biamount": "9" } }, true, false, saved);
    expect(inputs()[0]!.value).toBe("9");
  }, 20000);
});

describe("long labels that start alike stay separate fields", () => {
  const boxes = (labels: string[]) => {
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${labels.map((l, i) =>
      `<mat-form-field class="mat-mdc-form-field"><label>${l}</label><input name="amount" id="amount" value="${i + 1}"></mat-form-field>`).join("")}</main>`;
    return inputs().map(i => g.__bettersControlKey(i));
  };

  it("three boxes whose labels share their first 30 characters get three keys, and each maps on its own", () => {
    const labels = ["Bodily Injury Liability Amount Paid By Carrier", "Bodily Injury Liability Amount Paid By Insured", "Bodily Injury Liability Amount Paid By Other Party"];
    const keys = boxes(labels);
    expect(new Set(keys).size).toBe(3);
    const fields = ingest({ [keys[0]!]: "crm:incident.a", [keys[1]!]: "crm:incident.b", [keys[2]!]: "crm:incident.c" })
      .filter(f => f.mapped?.startsWith("crm:incident."));
    expect(fields.map(f => `${f.mapped}=${f.value}`).sort()).toEqual(["crm:incident.a=1", "crm:incident.b=2", "crm:incident.c=3"]);
  });

  it("labels that share their first 60 characters stay apart too", () => {
    const stem = "Bodily Injury Liability Amount Paid On Behalf Of The Named Insured Driver";
    expect(stem.length).toBeGreaterThan(60);
    expect(new Set(boxes([`${stem} To The Carrier`, `${stem} To A Third Party`])).size).toBe(2);
  });

  it("a box keeps its key when look-alike boxes are added or removed", async () => {
    const stem = "Bodily Injury Liability Amount Paid On Behalf Of The Named Insured Driver";
    const mine = `${stem} To The Carrier`;
    // each page is read in its own tick, as the extension's separate calls are
    const first = async (labels: string[]) => { const k = boxes(labels)[0]; await Promise.resolve(); return k; };
    const alone = await first([mine, "PD Amount"]);
    expect(await first([mine, `${stem} To A Third Party`, "PD Amount"])).toBe(alone);
    expect(await first([mine, `${stem} To A Third Party`, `${stem} To The Insured`, "PD Amount"])).toBe(alone);
    // a short label is kept as written
    const short = await first(["BI Amount", "PD Amount"]);
    expect(short).toBe("text:amount~bi amount");
    expect(await first(["BI Amount", "PD Amount", "MP Amount"])).toBe(short);
    // a long label is its first 30 characters, "#" and an 8-hex hash of the whole label
    expect(alone).toMatch(/^text:amount~.{30}#[0-9a-f]{8}$/);
  });

  it("every key stays within 200 characters, and the cap is what holds it there", () => {
    // a 250-character name (legacy head 120), a 40-character section title (suffix 41) and
    // 40-character labels (kept as written): 120 + 1 + 40 + 41 = 202 without the cap
    const name = "x".repeat(250);
    const title = "Prior Accident Claim Information Section";
    const labelA = "Bodily Injury Liability Amount Paid Ca";
    const labelB = "Bodily Injury Liability Amount Paid In";
    expect([title.length, labelA.length, labelB.length]).toEqual([40, 38, 38]);
    const label40a = `${labelA}rr`;
    const label40b = `${labelB}sd`;
    expect([label40a.length, label40b.length]).toEqual([40, 40]);
    const panel = (t: string, inner: string) =>
      `<mat-expansion-panel><mat-expansion-panel-header><span><mat-panel-title>${t}</mat-panel-title></span></mat-expansion-panel-header><div>${inner}</div></mat-expansion-panel>`;
    const field = (label: string, value: string) =>
      `<mat-form-field class="mat-mdc-form-field"><label>${label}</label><input name="${name}" value="${value}"></mat-form-field>`;
    document.title = "Tracy Dittrich - Accidents";
    document.body.innerHTML = `<main>${panel("Applicant Info", panel(title, field(label40a, "1") + field(label40b, "2") + field("Short", "3")))}</main>`;
    const keys = inputs().map(i => g.__bettersControlKey(i));
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(k => k.includes("~"))).toBe(true);
    keys.forEach(k => expect(k.length).toBeLessThanOrEqual(200));
    // the two 40-character labels reach the cap exactly; with no cap they would be 202
    expect(keys[0]!.length).toBe(200);
    expect(keys[1]!.length).toBe(200);
    expect(keys[0]).toMatch(/#[0-9a-f]{8}@/);
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
