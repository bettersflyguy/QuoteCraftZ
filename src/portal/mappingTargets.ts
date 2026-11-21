/** Existing one-target strings remain unchanged. Ordered fan-out bindings
 * keep their preferred fill source first and capture into every target. */
export const MAX_MAPPING_TARGETS = 8;
const PREFIX = "targets:";
export function mappingTargets(value: string | undefined): string[] {
  if (!value) return [];
  if (!value.startsWith(PREFIX)) return [value];
  try {
    const parsed: unknown = JSON.parse(value.slice(PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > MAX_MAPPING_TARGETS ||
        parsed.some(p => typeof p !== "string" || !p || p.length > 200 || p.startsWith(PREFIX) || p === "skip" || p.startsWith("secure:"))) return [];
    return [...new Set(parsed as string[])];
  } catch { return []; }
}
export function packMappingTargets(targets: string[]): string {
  const unique = [...new Set(targets.filter(Boolean))];
  if (unique.length > MAX_MAPPING_TARGETS) throw new Error(`A field can have at most ${MAX_MAPPING_TARGETS} targets.`);
  if (unique.length > 1 && unique.some(t => t === "skip" || t.startsWith("secure:") || t.startsWith(PREFIX))) throw new Error("Secured and Never fill mappings must have a single target.");
  return unique.length > 1 ? PREFIX + JSON.stringify(unique) : unique[0] || "";
}
export const preferredTarget = (value: string | undefined): string => mappingTargets(value)[0] || "";
export function preferredFieldMap(map: Record<string,string>): Record<string,string> {
  return Object.fromEntries(Object.entries(map).map(([k,v])=>[k,preferredTarget(v) || (v ? "skip" : "")]));
}
export function expandedFieldMap(map: Record<string,string>): [string,string][] {
  return Object.entries(map).flatMap(([k,v])=>mappingTargets(v).map(t=>[k,t] as [string,string]));
}
