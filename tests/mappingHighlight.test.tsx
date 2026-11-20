// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataServiceMapEditor } from "@/panel/DataServiceMapEditor";
import { MapEditor } from "@/panel/MapEditor";
import type { PeekItem } from "@/boldpenguin/types";

vi.mock("@fluentui/react-components", () => ({
  makeStyles: () => () => ({}), tokens: {},
  Button: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled} aria-label={props["aria-label"]}>{children}</button>,
  Spinner: () => <span />,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock("@/panel/api", () => ({ send: vi.fn(async (m: { type: string }) =>
  m.type === "panel/crmFieldCatalog" ? { entities: [] } : null) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: { storage: {
      local: { get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    } }
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("mapping row selection", () => {
  it("selects a data service mapping by clicking its label and removes the troubleshooting controls", async () => {
    const onHighlight = vi.fn();
    await act(async () => root.render(<DataServiceMapEditor page={{
      onPick: vi.fn(), onPickCancel: vi.fn(), onRead: vi.fn(), onHighlight
    }} />));
    const zip = host.querySelector<HTMLButtonElement>('button[aria-label="Highlight ZIP code on page"]')!;
    expect(zip).not.toBeNull();
    await act(async () => zip.click());
    expect(onHighlight).toHaveBeenCalledWith(expect.stringMatching(/^service:/));
    expect(host.textContent).not.toMatch(/CRM field list read OK|Retry|Copy details/);
  });

  it("sends the selected page mapping to the page highlighter", async () => {
    const onPeek = vi.fn(async (_items: PeekItem[] | null) => ({ shown: 1, missing: 0 }));
    function Editor() {
      const [highlightKey, onHighlight] = useState<string | null>(null);
      return <MapEditor
        scan={{ origin: "https://app.ezlynx.com", rows: [{ key: "text:zip", label: "ZIP code", type: "text", payment: false, mapped: "address.postalCode", autoPath: null }] }}
        draft={{ "text:zip": "address.postalCode" }} setDraft={() => {}} captured={[]} busy={false}
        onSave={() => {}} onCancel={() => {}} onPeek={onPeek} highlightKey={highlightKey} onHighlight={onHighlight}
      />;
    }
    await act(async () => root.render(<Editor />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Highlight ZIP code on page"]')!.click());
    expect(onPeek).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ key: "text:zip", focused: true })]));
  });
});
