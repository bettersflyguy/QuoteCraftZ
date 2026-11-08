export interface TargetGroup { group: string; paths: { path: string; label: string }[] }
export interface TargetHit { path: string; label: string; group: string }

export const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Every query word must appear in the option's label OR its entity, so
 * "contact city" finds "Address 1: City" under Related contacts and the
 * primary contact, while "city" alone lists every entity's city column. */
export function filterTargets(groups: TargetGroup[], query: string, limit = 200): TargetHit[] {
  const words = normText(query).split(" ").filter(Boolean);
  const out: TargetHit[] = [];
  for (const g of groups) {
    const groupText = normText(g.group);
    for (const p of g.paths) {
      const hay = `${normText(p.label)} ${groupText}`;
      if (words.every(w => hay.includes(w))) {
        out.push({ path: p.path, label: p.label, group: g.group });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
