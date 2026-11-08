// @vitest-environment jsdom
/** Mapping-editor peek: outlines exactly what the draft covers, keyed the
 * same way the fill and capture resolve elements, and restores the page. The
 * scripts ship as plain injected files - tested as shipped, on a real DOM. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Item = { key: string; label: string; kind: "mapped" | "auto" | "skip"; array?: boolean };
let peek: (items: Item[] | null) => { shown: number; missing: number };

beforeAll(() => {
  // jsdom has no layout: give elements a box like a browser would - zero
  // inside a display:none ancestor (a hidden table row's cells), real otherwise
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const hidden = Boolean(this.closest("[style*='display:none'], [style*='display: none']"));
    const w = hidden ? 0 : 80;
    const h = hidden ? 0 : 16;
    return { left: 10, top: 40, width: w, height: h, right: 10 + w, bottom: 40 + h, x: 10, y: 40, toJSON() { return {}; } } as DOMRect;
  };
  for (const f of ["portal-ingest.js", "portal-fill.js"]) {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(path.resolve(__dirname, "../public/portal", f), "utf8"))();
  }
  peek = (globalThis as unknown as { __bettersPortalPeek: typeof peek }).__bettersPortalPeek;
});

describe("peek", () => {
  it("outlines mapped controls, taught text and every array row, then restores the page", () => {
    document.body.innerHTML = `
      <input type="text" name="zip" style="outline: 1px dotted red">
      <input type="checkbox" name="archived">
      <h3 id="insured">Dittrich, Tracey</h3>
      <table id="pl"><tbody>
        <tr><td>989815765</td></tr>
        <tr><td>502346899300</td></tr>
        <tr style="display:none"><td>hidden</td></tr>
        <tr><td>6056748576331</td></tr>
      </tbody></table>`;
    const r = peek([
      { key: "text:zip", label: "ZIP code", kind: "mapped" },
      { key: "checkbox:archived", label: "Never fill", kind: "skip" },
      { key: "pick:#insured", label: "Insured (account): Account Name", kind: "mapped" },
      { key: "pick:#pl > tbody > tr:nth-of-type(1) > td:nth-of-type(1)", label: "Policies: Policy Number", kind: "mapped", array: true },
      { key: "text:not-on-page", label: "Email", kind: "auto" }
    ]);
    expect(r).toEqual({ shown: 4, missing: 1 });

    const zip = document.querySelector<HTMLInputElement>("input[name=zip]")!;
    expect(zip.style.outline).toContain("solid");
    expect(document.querySelector<HTMLInputElement>("input[name=archived]")!.style.outline).toContain("dashed");
    expect(document.getElementById("insured")!.style.outline).toContain("solid");
    const cells = Array.from(document.querySelectorAll<HTMLElement>("#pl td"));
    expect(cells.map(c => Boolean(c.style.outline))).toEqual([true, true, false, true]);

    const badges = Array.from(document.querySelectorAll("[data-betters-peek]")).map(b => b.textContent);
    // one badge per mapping; the array badge counts the visible rows
    expect(badges).toEqual(["ZIP code", "Never fill", "Insured (account): Account Name", "Policies: Policy Number (3 rows)"]);

    peek(null);
    expect(document.querySelectorAll("[data-betters-peek]").length).toBe(0);
    expect(zip.style.outline).toBe("1px dotted red");
    expect(cells.every(c => !c.style.outline)).toBe(true);
  });

  it("re-peeking replaces the previous highlights instead of stacking them", () => {
    document.body.innerHTML = `<input type="text" name="a"><input type="text" name="b">`;
    peek([{ key: "text:a", label: "A", kind: "mapped" }]);
    peek([{ key: "text:b", label: "B", kind: "mapped" }]);
    expect(Array.from(document.querySelectorAll("[data-betters-peek]")).map(b => b.textContent)).toEqual(["B"]);
    expect(document.querySelector<HTMLInputElement>("input[name=a]")!.style.outline).toBe("");
    peek(null);
  });
});

describe("peek unmapped", () => {
  it("outlines in red only what no saved mapping covers, then restores the page", () => {
    (globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "\$&") };
    document.body.innerHTML = `
      <main>
        <label for="fn">First Name</label><input id="fn" name="fn" value="Tracey">
        <label for="ln">Last Name</label><input id="ln" name="ln" value="Dittrich">
        <label for="nl">Newsletter</label><input id="nl" name="nl" type="checkbox">
        <table id="veh">
          <thead><tr><th>VIN</th><th>Make</th><th>Year</th></tr></thead>
          <tbody>
            <tr><td>JTMBF4DV4A5030644</td><td>TOYOTA</td><td>2010</td></tr>
            <tr><td>5TDDKRFH9FS121015</td><td>TOYOTA</td><td>2015</td></tr>
          </tbody>
        </table>
      </main>`;
    const unmapped = (globalThis as unknown as { __bettersPortalPeekUnmapped: (m: unknown) => { shown: number } }).__bettersPortalPeekUnmapped;
    const r = unmapped({
      "text:fn": "contact.firstName",                                            // mapped control
      "checkbox:nl": "skip",                                                     // deliberate "never fill"
      "pick:#veh > tbody > tr:nth-of-type(1) > td:nth-of-type(1)": "note"       // VIN column, every row
    });
    const red = (el: Element | null) => /solid/.test((el as HTMLElement).style.outline) && /(209, 52, 56)|#d13438/i.test((el as HTMLElement).style.outline);
    expect(red(document.getElementById("fn"))).toBe(false);
    expect(red(document.getElementById("nl"))).toBe(false);
    expect(red(document.getElementById("ln"))).toBe(true);
    const cells = Array.from(document.querySelectorAll("#veh tbody td"));
    // VIN column covered on both rows; Make/Year unmapped
    expect(cells.map(red)).toEqual([false, true, true, false, true, true]);
    expect(r.shown).toBe(5);
    unmapped(null);
    expect(red(document.getElementById("ln"))).toBe(false);
  });
});
