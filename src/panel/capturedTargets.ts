/** Captured values a form control can fill from ("label:<canonical>"),
 * plain and, for a page step's values, by policy type and step. */
import type { CapturedTarget } from "./MapEditor";

export function capturedTargets(fields: { label: string; section?: string }[] | undefined): CapturedTarget[] {
  const seen = new Map<string, string>();
  const canonOf = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  for (const f of fields ?? []) {
    const canon = canonOf(String(f.label));
    if (canon && canon.length <= 100 && !seen.has(canon)) seen.set(canon, f.label);
    // a page step's value by its policy type and step ("Auto: Policy Info >
    // Prior Carrier"), so a form takes Auto's, never Home's
    if (f.section && f.section.includes(":")) {
      const scoped = canonOf(`${f.section} ${f.label}`);
      if (scoped.length <= 100 && !seen.has(scoped)) seen.set(scoped, `${f.section} > ${f.label}`);
    }
  }
  return [...seen.entries()].map(([canon, label]) => ({ value: `label:${canon}`, label }));
}
