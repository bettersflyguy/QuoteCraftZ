/** OUTPUT direction: every value the held capture can put into a form,
 * keyed by the exact target a page mapping names ("address.city",
 * "contact3.dateOfBirth", "crm:account.address1_county", "crm:policy2.x").
 * The page filler resolves a control's saved mapping against this map, so
 * any target the editor offers can fill. Secured values never appear here:
 * they travel on their own pass-through channel (see secureFill.ts). */
import type { CapturedApplication } from "@/boldpenguin/types";
import { CRM_BRIDGE } from "@/boldpenguin/normalize";

/** CRM date text ("2026-03-11", "2026-03-11T05:00:00Z") -> "3/11/2026"; the
 * filler turns M/D/YYYY into whatever a date input wants. */
export function displayDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/.exec(v.trim());
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : v;
}

export function buildFillValues(app: CapturedApplication | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!app) return out;
  for (const [group, values] of Object.entries(app.normalized ?? {})) {
    if (group.startsWith("secure:")) continue;
    for (const [key, raw] of Object.entries(values ?? {})) {
      const v = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "").trim();
      if (v) out[`${group}.${key}`] = displayDate(v);
    }
  }
  // a CRM column mapping fills from the semantic value that feeds it when the
  // capture came from a page (or the CRM) under the semantic name
  for (const [crm, semantic] of Object.entries(CRM_BRIDGE)) {
    if (!out[crm] && out[semantic]) out[crm] = out[semantic]!;
    if (!out[semantic] && out[crm]) out[semantic] = out[crm]!;
  }
  // related-contact rows: identity columns bridge both ways too
  const CONTACT: Record<string, string> = {
    firstname: "firstName", lastname: "lastName", emailaddress1: "email",
    mobilephone: "phone", birthdate: "dateOfBirth"
  };
  for (const key of Object.keys(out)) {
    const m = /^(crm:)?contact(\d+)\.([A-Za-z0-9_]+)$/.exec(key);
    if (!m || Number(m[2]) < 2) continue;
    if (m[1]) {
      const sem = CONTACT[m[3]!];
      if (sem && !out[`contact${m[2]}.${sem}`]) out[`contact${m[2]}.${sem}`] = out[key]!;
    } else {
      const col = Object.entries(CONTACT).find(([, s]) => s === m[3])?.[0];
      if (col && !out[`crm:contact${m[2]}.${col}`]) out[`crm:contact${m[2]}.${col}`] = out[key]!;
    }
  }
  return out;
}
