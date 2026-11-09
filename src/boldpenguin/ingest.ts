/** Merges fields harvested from an arbitrary carrier page into the held
 * captured application (or starts one). Ingest is the inverse of portal fill:
 * any eligible carrier site can contribute insured data, which then fills the
 * next portal. Existing data always wins - ingest only adds. */
import { canonical, clean, normalize } from "./normalize";
import { alignPeople } from "./people";
import { isIdentifierColumn } from "@/portal/fieldMaps";
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
  /** The page belonged to a DIFFERENT person than the held capture, so a
   * fresh capture replaced it instead of merging (cross-lead contamination). */
  replaced: boolean;
  /** Incoming person slot -> the held person's slot it was matched to. */
  slotMap?: Map<number, number>;
  /** Identifier values (license numbers...) taken OUT of the capture: they go
   * to the secured pass-through channel only. */
  secured?: { path: string; value: string }[];
}

/** Takes identifier-class values (a license number mapped to a CRM column)
 * out of the fields: they travel only as secured pass-through values. */
function withoutIdentifiers(fields: CapturedAppField[], secured: { path: string; value: string }[]): CapturedAppField[] {
  return fields.filter(f => {
    const m = /^crm:(account|primarycontact|contact\d+)\.([a-z0-9_]+)$/.exec(f.mapped ?? "");
    if (!m || !isIdentifierColumn(m[2]!)) return true;
    if (clean(f.value)) secured.push({ path: `secure:${m[1]}.${m[2]}`, value: clean(f.value) });
    return false;
  });
}

interface IdentitySignals { email: string; phone: string; lastName: string; business: string }

function signalsOf(n: NormalizedApplication): IdentitySignals {
  const contact = n["contact"] ?? {};
  const email = typeof contact["email"] === "string" ? contact["email"].toLowerCase().trim() : "";
  const phoneRaw = typeof contact["phone"] === "string" ? contact["phone"].replace(/\D/g, "") : "";
  let lastName = typeof contact["lastName"] === "string" ? contact["lastName"] : "";
  if (!lastName && typeof contact["fullName"] === "string") {
    lastName = contact["fullName"].trim().split(" ").slice(-1)[0] ?? "";
  }
  const businessRaw = n["business"]?.["legalName"];
  return {
    email,
    phone: phoneRaw.length >= 7 ? phoneRaw.slice(-10) : "",
    lastName: canonical(lastName),
    business: typeof businessRaw === "string" ? canonical(businessRaw) : ""
  };
}

/** True when the page belongs to a DIFFERENT person/lead - merging would
 * cross-wire customers. An agreeing strong signal (same email or phone)
 * confirms the same person regardless of name variants; otherwise any signal
 * present on both sides that disagrees is a different person. A page with no
 * identity signals (e.g. a coverage screen) never conflicts. */
export function identityConflict(existing: NormalizedApplication, incoming: NormalizedApplication): boolean {
  const a = signalsOf(existing);
  const b = signalsOf(incoming);
  const same = (x: string, y: string) => Boolean(x && y && x === y);
  if (same(a.email, b.email) || same(a.phone, b.phone)) return false;
  const differs = (x: string, y: string) => Boolean(x && y && x !== y);
  return differs(a.email, b.email) || differs(a.phone, b.phone) ||
    differs(a.business, b.business) || differs(a.lastName, b.lastName);
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
 * existing capture already normalized win - agent-reviewed data never gets
 * silently replaced by a later page's guess. */
function mergeNormalized(existing: NormalizedApplication, allFields: CapturedAppField[]): NormalizedApplication {
  const fresh = normalize(allFields);
  const merged: NormalizedApplication = {};
  for (const group of new Set([...Object.keys(fresh), ...Object.keys(existing)])) {
    merged[group] = { ...fresh[group], ...existing[group] };
    // identifier values never stay in the capture (secured channel only)
    if (group.startsWith("crm:")) for (const col of Object.keys(merged[group]!)) if (isIdentifierColumn(col)) delete merged[group]![col];
  }
  return merged;
}

export function mergeIngestedFields(
  existing: CapturedApplication | null,
  harvested: CapturedAppField[],
  site: IngestSite
): IngestOutcome {
  const secured: { path: string; value: string }[] = [];
  // people are matched by who they are, not by the row they sat in
  const aligned = alignPeople(existing?.normalized ?? null, sanitize(harvested));
  const incoming = withoutIdentifiers(aligned.fields, secured);
  const incomingNormalized = normalize(incoming);

  const fresh = (replaced: boolean): IngestOutcome => ({
    app: {
      schemaVersion: "1.1",
      capturedAt: new Date().toISOString(),
      source: { system: site.system, url: site.url, title: site.title },
      // an ingested page is a snapshot, not an application workflow - no
      // completion heuristics apply
      completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: false },
      scannedSections: Array.from(new Set(incoming.map(f => f.section))),
      normalized: incomingNormalized,
      fields: incoming
    },
    added: incoming.length,
    total: incoming.length,
    replaced,
    slotMap: aligned.slotMap,
    secured
  });

  if (!existing) return fresh(false);
  // a different person's page must never merge into the held capture
  if (identityConflict(existing.normalized, incomingNormalized)) return fresh(true);

  // a capture held from before identifiers were refused gives them up too
  const kept = withoutIdentifiers(existing.fields, secured);
  const known = new Set(kept.map(fieldKey));
  const added = incoming.filter(field => !known.has(fieldKey(field)));
  const fields = [...kept, ...added];
  const app: CapturedApplication = {
    ...existing,
    capturedAt: new Date().toISOString(),
    scannedSections: Array.from(new Set([...existing.scannedSections, ...added.map(f => f.section)])),
    normalized: mergeNormalized(existing.normalized, fields),
    fields
  };
  return { app, added: added.length, total: fields.length, replaced: false, slotMap: aligned.slotMap, secured };
}
