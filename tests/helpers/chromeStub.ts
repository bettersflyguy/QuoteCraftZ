import { vi } from "vitest";

/** Shared chrome.storage stub for Node tests. Import for side effect; call reset() in beforeEach. */
export const backing: Record<string, unknown> = {};

export function reset(): void {
  for (const k of Object.keys(backing)) delete backing[k];
}

function area(prefix: string) {
  return {
    get: vi.fn(async (k: string | null) => {
      if (k === null) {   // get(null): everything in this area
        return Object.fromEntries(Object.entries(backing).filter(([b]) => b.startsWith(prefix) && (prefix !== "" ? true : !b.startsWith("s:"))).map(([b, v]) => [b.slice(prefix.length), v]));
      }
      return { [k]: backing[prefix + k] };
    }),
    set: vi.fn(async (o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) backing[prefix + k] = v;
    }),
    remove: vi.fn(async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) delete backing[prefix + key]; })
  };
}

vi.stubGlobal("chrome", {
  storage: {
    local: area(""),
    session: area("s:")
  }
});
