import { mergeIngestedFields } from "@/boldpenguin/ingest";
import type { CapturedApplication, CapturedAppField } from "@/boldpenguin/types";

/** Even a partial capture of a newly selected lead starts a separate record.
 * Name/phone heuristics alone cannot protect policy-only captures. */
export function mergeLeadCapture(existing: CapturedApplication | null, fields: CapturedAppField[], site: {
  system: string; url: string; title: string; leadKey?: string;
}) {
  const changed = Boolean(existing && site.leadKey && existing.source.leadKey !== site.leadKey);
  const result = mergeIngestedFields(changed ? null : existing, fields, site);
  if (changed) result.replaced = true;
  if (site.leadKey) result.app.source = { ...result.app.source, leadKey: site.leadKey };
  return result;
}
