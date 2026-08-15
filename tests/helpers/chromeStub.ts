import { vi } from "vitest";

/** Shared chrome.storage stub for Node tests. Import for side effect; call reset() in beforeEach. */
export const backing: Record<string, unknown> = {};

export function reset(): void {
  for (const k of Object.keys(backing)) delete backing[k];
}

function area(prefix: string) {
  return {
    get: vi.fn(async (k: string) => ({ [k]: backing[prefix + k] })),
    set: vi.fn(async (o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) backing[prefix + k] = v;
    }),
    remove: vi.fn(async (k: string) => { delete backing[prefix + k]; })
  };
}

vi.stubGlobal("chrome", {
  storage: {
    local: area(""),
    session: area("s:")
  }
});
