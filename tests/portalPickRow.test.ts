// @vitest-environment jsdom
/** Picker vs grid rows: clicking a text cell in a row that carries its own
 * controls (action menu, "Primary" checkbox - the NowCerts contacts list)
 * must resolve the CELL TEXT as a capture teaching, never the row's stray
 * checkbox as a "composite widget". The picker ships as a plain injected
 * script - test it as shipped, against a real DOM. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Row = { key: string; label: string; type: string } | "timeout" | null;
let pick: (timeoutMs?: number) => Promise<Row>;

beforeAll(() => {
  new Function(readFileSync(path.resolve(__dirname, "../public/portal/portal-mapper.js"), "utf8"))();
  new Function(readFileSync(path.resolve(__dirname, "../public/portal/portal-ingest.js"), "utf8"))();
  const src = readFileSync(path.resolve(__dirname, "../public/portal/portal-fill.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(src)();
  pick = (globalThis as unknown as { __bettersPortalPick: typeof pick }).__bettersPortalPick;
});

const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));

describe("picking inside grid rows", () => {
  it("picks a lead's Name value instead of its neighboring disabled notes textarea", async () => {
    document.body.innerHTML = `<table><tr><td colspan="6"><div class="lead"><div><ul><div><li>Name</li><li id="leadName">Alex Rivera</li></div></ul></div><div><textarea disabled placeholder="Select disposition to edit notes"></textarea></div></div></td></tr></table>`;
    const notes = document.querySelector("textarea")!;
    notes.getBoundingClientRect = () => ({x:500,y:100,left:500,top:100,right:700,bottom:200,width:200,height:100,toJSON:()=>({})});
    const name = document.querySelector("#leadName")!;
    name.getBoundingClientRect = () => ({x:100,y:100,left:100,top:100,right:300,bottom:124,width:200,height:24,toJSON:()=>({})});
    const scan = (globalThis as unknown as { __bettersPortalScan(app:unknown,map:unknown): Exclude<Row,"timeout"|null>[] }).__bettersPortalScan(null, {});
    const pending = pick(5000);
    click(document.querySelector("#leadName")!);
    const row = await pending as Exclude<Row,"timeout"|null>;
    expect(row.type).toBe("text");
    expect(row.key).toBe("pick:#leadName");
    expect(row.label).toBe("Name");
    expect(scan.find(r => r.key === row.key)?.label).toBe(row.label);
    expect(row.label).not.toContain("disposition");
  });
  it("resolves the clicked name cell as a text teaching, not the row's checkbox", async () => {
    document.body.innerHTML = `
      <table id="contacts"><tbody>
        <tr>
          <td><button>Actions</button></td>
          <td><span>Tracey</span></td>
          <td>Dittrich</td>
          <td><input type="checkbox" checked disabled></td>
        </tr>
        <tr>
          <td><button>Actions</button></td>
          <td><span>Alaxander</span></td>
          <td>Dittrich</td>
          <td><input type="checkbox"></td>
        </tr>
      </tbody></table>`;
    const pending = pick(5000);
    click(document.querySelector("#contacts td:nth-of-type(2) > span")!);
    const row = await pending;
    expect(row).not.toBeNull();
    expect(row).not.toBe("timeout");
    const r = row as Exclude<Row, "timeout" | null>;
    expect(r.type).toBe("text");
    expect(r.key.startsWith("pick:")).toBe(true);
    expect(r.label).toContain("Tracey");
  });

  it("still resolves a real control when the control itself is clicked", async () => {
    document.body.innerHTML = `
      <table id="form"><tbody>
        <tr><td>Primary</td><td><input type="checkbox" name="isPrimary"></td></tr>
        <tr><td>Other</td><td><input type="checkbox" name="other"></td></tr>
      </tbody></table>`;
    const pending = pick(5000);
    click(document.querySelector("input[name='isPrimary']")!);
    const row = await pending;
    const r = row as Exclude<Row, "timeout" | null>;
    expect(r.type).not.toBe("text");
    expect(r.key.startsWith("pick:")).toBe(false);
  });
});
