/** Merges fields harvested from an arbitrary carrier page into the held
 * captured application (or starts one). Ingest is the inverse of portal fill:
 * any eligible carrier site can contribute insured data, which then fills the
 * next portal. Existing data always wins — ingest only adds. */
import { canonical, clean, normalize } from "./normalize";
import type { CapturedApplication, CapturedAppField, NormalizedApplication } from "./types";

export interface IngestSite {
  system: string;
  url: string;
  title: string;
}

export interface IngestOutcome {
  app: CapturedApplication;
  added: number;
  total: number;
}

function fieldKey(field: CapturedAppField): string {
  return [field.section, field.group, canonical(field.label), field.value].join("|");
}

function sanitize(fields: CapturedAppField[]): CapturedAppField[] {
  const seen = new Set<string>();
  return fields.filter(field => {
    field.label = clean(field.label).replace(/[:*]+$/, "").trim();
    field.value = clean(field.value);
    field.section = clean(field.section);
    field.group = clean(field.group);
    const key = fieldKey(field);
    if (!field.label || !field.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Recompute the normalized projection from all fields, but let values the
 * existing capture already normalized win — agent-reviewed data never gets
 * silently replaced by a later page's guess. */
function mergeNormalized(existing: NormalizedApplication, allFields: CapturedAppField[]): NormalizedApplication {
  const fresh = normalize(allFields);
  const merged: NormalizedApplication = {};
  for (const group of new Set([...Object.keys(fresh), ...Object.keys(existing)])) {
    merged[group] = { ...fresh[group], ...existing[group] };
  }
  return merged;
}

export function mergeIngestedFields(
  existing: CapturedApplication | null,
  harvested: CapturedAppField[],
  site: IngestSite
): IngestOutcome {
  const incoming = sanitize(harvested);

  if (!existing) {
    const app: CapturedApplication = {
      schemaVersion: "1.1",
      capturedAt: new Date().toISOString(),
      source: { system: site.system, url: site.url, title: site.title },
      // an ingested page is a snapshot, not an application workflow — no
      // completion heuristics apply
      completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: false },
      scannedSections: Array.from(new Set(incoming.map(f => f.section))),
      normalized: normalize(incoming),
      fields: incoming
    };
    return { app, added: incoming.length, total: incoming.length };
  }

  const known = new Set(existing.fields.map(fieldKey));
  const added = incoming.filter(field => !known.has(fieldKey(field)));
  const fields = [...existing.fields, ...added];
  const app: CapturedApplication = {
    ...existing,
    capturedAt: new Date().toISOString(),
    scannedSections: Array.from(new Set([...existing.scannedSections, ...added.map(f => f.section)])),
    normalized: mergeNormalized(existing.normalized, fields),
    fields
  };
  return { app, added: added.length, total: fields.length };
}
