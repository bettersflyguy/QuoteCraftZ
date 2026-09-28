/** CRM load for a captured application (Bold Penguin or portal ingest) —
 * the non-EZLynx twin of the quote commit: insured enrichment from the
 * normalized projection, plus every captured field logged to the
 * question-knowledge tables for the risk-data layer. */
import { canonical, claimedIndices, clean } from "@/boldpenguin/normalize";
import type { CapturedApplication } from "@/boldpenguin/types";
import type { CapturedApplicant } from "@/types";
import type { KnowledgeApi, KnowledgeWriteResult } from "./knowledge";
import type { CrmEnvironment } from "./environments";

const esc = (v: string) => v.replace(/'/g, "''");

function str(app: CapturedApplication, group: string, key: string): string | null {
  const v = app.normalized[group]?.[key];
  return typeof v === "string" && v ? v : null;
}

/** "10/01/2026" or "2026-10-01" -> ISO date; anything else -> null (never
 * write a guess into a birthdate). */
export function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

const digitsOf = (v: string | null) => (v ?? "").replace(/\D/g, "");

/** A usable phone number, with mobile detection. Portals often pair a
 * "Phone Type" select ("Cellular telephone") with the number in a separate
 * control — a value without >=7 digits is a TYPE, never a number. */
export function detectPhone(app: CapturedApplication): { number: string; isMobile: boolean } | null {
  const typeField = app.fields.find(f => /\bphone\s*type\b|\btype\s*of\s*phone\b/i.test(f.label));
  const typeSaysMobile = Boolean(typeField && /cell|mobile|wireless/i.test(typeField.value));

  const normalized = str(app, "contact", "phone");
  if (normalized && digitsOf(normalized).length >= 7) return { number: normalized, isMobile: typeSaysMobile };

  const mobileField = app.fields.find(f =>
    /\b(cell|mobile|cellular)\b/i.test(f.label) && /phone|number|telephone/i.test(f.label + " phone") && digitsOf(f.value).length >= 7);
  if (mobileField) return { number: clean(mobileField.value), isMobile: true };

  const anyField = app.fields.find(f => /\bphone\b|\btelephone\b/i.test(f.label) && !/\btype\b/i.test(f.label) && digitsOf(f.value).length >= 7);
  if (anyField) return { number: clean(anyField.value), isMobile: typeSaysMobile };
  return null;
}

/** The editable identity the panel shows before anything is written —
 * captured data is a starting point the agent reviews, not gospel. */
export interface CaptureIdentity {
  firstName: string;
  lastName: string;
  businessName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  phoneIsMobile: boolean;
  email: string;
  dateOfBirth: string;
}

/** "7631 ANGELINE DR MINNEAPOLIS, MN 55428" -> parts. Carrier confirmation
 * screens print the whole mailing address on one line. */
export function splitUsAddress(line: string): { street: string; city: string; state: string; postalCode: string } | null {
  const m = clean(line).match(/^(.+?)\s+([A-Za-z][A-Za-z .'-]*?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return null;
  // the boundary between street and city is ambiguous without a comma; take the
  // last capitalized word-run before the state as the city
  const before = `${m[1]} ${m[2]}`.trim().replace(/,$/, "");
  const words = before.split(/\s+/);
  const cityWords: string[] = [];
  for (let i = words.length - 1; i >= 0 && cityWords.length < 3; i -= 1) {
    const w = words[i]!;
    if (/^\d/.test(w) || /^(DR|ST|AVE|RD|LN|CT|BLVD|WAY|TRL|PL|CIR|HWY|PKWY|TER|DRIVE|STREET|AVENUE|ROAD|LANE|COURT|BOULEVARD|TRAIL|PLACE|CIRCLE|APT|UNIT|STE|SUITE|#\w*)$/i.test(w)) break;
    cityWords.unshift(w);
  }
  if (!cityWords.length) return null;
  const city = cityWords.join(" ");
  const street = before.slice(0, before.length - city.length).trim().replace(/,$/, "");
  return street ? { street, city, state: m[3]!, postalCode: m[4]! } : null;
}

export function identityFromCapture(app: CapturedApplication): CaptureIdentity {
  const businessName = str(app, "business", "legalName") ?? "";
  const bizCanon = canonical(businessName);
  let firstName = str(app, "contact", "firstName") ?? "";
  let lastName = str(app, "contact", "lastName") ?? "";
  if (!firstName && !lastName) {
    // an exactly-labeled "Name" fact row (GEICO Edge's Personal Information
    // tab) beats rail headings that glue the middle name in ("Edward
    // La-Valle Parkin"); middle tokens are middle names — last word is the
    // surname, editable in review for multi-word surnames. A value equal to
    // the BUSINESS name is never a person ("B H Towing Service" must not
    // become first "B", last "Service").
    const candidates = [
      ...app.fields.filter(f => /^(name|full name|policyholder name|insured name)$/i.test(clean(f.label))).map(f => f.value),
      str(app, "contact", "fullName") ?? ""
    ];
    const person = candidates.map(clean).find(v => v && (!bizCanon || canonical(v) !== bizCanon));
    const parts = (person ?? "").split(" ").filter(Boolean);
    firstName = parts[0] ?? "";
    lastName = parts.length > 1 ? parts[parts.length - 1]! : "";
  }
  const phone = detectPhone(app);
  let street = [str(app, "address", "street1"), str(app, "address", "street2")].filter(Boolean).join(", ");
  let city = str(app, "address", "city") ?? "";
  let state = str(app, "address", "state") ?? "";
  let postalCode = str(app, "address", "postalCode") ?? "";
  if (street && !city) {
    // the whole "street city, ST zip" line landed in one field (the ZIP may
    // already be known separately — rate-by-zip flows capture it first)
    const split = splitUsAddress(street);
    if (split) {
      street = split.street;
      city = split.city;
      state = state || split.state;
      postalCode = postalCode || split.postalCode;
    }
  }
  return {
    firstName,
    lastName,
    businessName,
    street,
    city,
    state,
    postalCode,
    phone: phone?.number ?? "",
    phoneIsMobile: phone?.isMobile ?? false,
    email: str(app, "contact", "email") ?? "",
    dateOfBirth: str(app, "contact", "dateOfBirth") ?? ""
  };
}

/** Builds the enrichment-pipeline applicant from the agent-reviewed identity. */
export function applicantFromIdentity(id: CaptureIdentity, isCommercial: boolean): CapturedApplicant {
  const hasAddress = Boolean(id.street || id.city || id.postalCode);
  return {
    ezlynxApplicantId: 0,
    firstName: clean(id.firstName),
    lastName: clean(id.lastName),
    dateOfBirth: toIsoDate(clean(id.dateOfBirth) || null),
    dlNumber: null,
    dlState: null,
    address: hasAddress ? { street: clean(id.street), city: clean(id.city), state: clean(id.state), postalCode: clean(id.postalCode) } : null,
    phones: clean(id.phone) ? [{ type: id.phoneIsMobile ? "Mobile" : null, number: clean(id.phone) }] : [],
    emails: clean(id.email) ? [clean(id.email)] : [],
    coApplicants: [],
    isCommercial
  };
}

/** Projects the capture's normalized identity into the shape the existing
 * enrichment pipeline (ensureInsuredData) already consumes. */
export function applicantFromCapture(app: CapturedApplication): CapturedApplicant {
  return applicantFromIdentity(identityFromCapture(app), Boolean(str(app, "business", "legalName")));
}

/** "$3,089.50" -> 3089.5; null when no parsable amount. */
export function parseMoney(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

/** What a sale/confirmation screen yields toward a CRM policy record.
 * hasPolicy (a policy number was captured) is the signal that the ingest
 * happened on a sale screen rather than mid-quote. */
export interface PolicyDraft {
  hasPolicy: boolean;
  number: string;
  premiumText: string;
  effectiveDate: string;
  expirationDate: string;
  carrierName: string;
}

function fieldValue(app: CapturedApplication, labelRe: RegExp): string {
  const f = app.fields.find(x => labelRe.test(x.label) && x.value);
  return f ? clean(f.value) : "";
}

function addMonthsUs(usDate: string, months: number): string {
  const m = usDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const d = new Date(Number(m[3]), Number(m[1]) - 1 + months, Number(m[2]));
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function policyFromCapture(app: CapturedApplication): PolicyDraft {
  const number = str(app, "policy", "number") ?? fieldValue(app, /^policy\s*(number|no|#)\b/i);
  const premium = str(app, "policy", "premium") ||
    fieldValue(app, /total\s+premium|premium\s*:?\s*$/i);
  const effectiveDate = str(app, "coverage", "effectiveDate") ?? fieldValue(app, /effective\s*date/i);
  let expirationDate = str(app, "coverage", "expirationDate") ?? fieldValue(app, /expiration\s*date/i);
  if (!expirationDate && effectiveDate) {
    // sale screens rarely print the expiration — derive it from the term
    // ("Policy Term: 6 months" / "6 Month Auto Premium")
    const termText = fieldValue(app, /policy\s*term/i) || app.fields.find(f => /\b(6|12)\s*[- ]?month/i.test(f.label) && /premium/i.test(f.label))?.label || "";
    const term = termText.match(/\b(6|12)\b/);
    if (term) expirationDate = addMonthsUs(effectiveDate, Number(term[1]));
  }
  return {
    hasPolicy: Boolean(number),
    number: number ?? "",
    premiumText: premium,
    effectiveDate,
    expirationDate,
    carrierName: carrierGuess(app)
  };
}

/** Rule paths whose fields are written to real CRM columns by the load —
 * everything else is supplemental and goes into the activity note. */
const STRUCTURED_PATHS = ["contact.", "address.", "business.legalName", "policy.", "coverage.effectiveDate", "coverage.expirationDate"];

export interface SupplementalNote {
  subject: string;
  body: string;
  count: number;
}

/** Fields with no CRM column mapping (employment, payment plan, coverage
 * elections, building details…) grouped by section into one readable note
 * for the account timeline. Stable subject per source, so a re-load updates
 * the same note instead of stacking duplicates. */
export function buildSupplementalNote(app: CapturedApplication): SupplementalNote | null {
  const claimed = claimedIndices(app.fields, STRUCTURED_PATHS);
  const extra = app.fields.filter((_, i) => !claimed.has(i));
  if (!extra.length) return null;
  const bySection = new Map<string, string[]>();
  for (const f of extra) {
    const section = f.section || "Details";
    const line = `  ${f.group ? `${f.group} — ` : ""}${f.label}: ${f.value}`;
    (bySection.get(section) ?? bySection.set(section, []).get(section)!).push(line);
  }
  const body = [
    `Captured ${new Date(app.capturedAt).toLocaleString()} from ${app.source.system}`,
    "",
    ...[...bySection.entries()].flatMap(([section, lines]) => [section, ...lines, ""])
  ].join("\n").slice(0, 90000);
  return {
    subject: `Quote Connector — captured application data (${app.source.system})`,
    body,
    count: extra.length
  };
}

/** Intake source for lead attribution (iacrm_leadsource), from the capture's
 * origin. Lead marketplaces get their proper name; anything else records the
 * host so the source is never lost. */
export function leadSourceGuess(app: CapturedApplication): string {
  const s = `${app.source.system} ${app.source.url}`.toLowerCase();
  if (s.includes("tivly")) return "Tivly";
  if (s.includes("boldpenguin")) return "Bold Penguin";
  return app.source.system;
}

/** Best-guess carrier from the capture source, for opportunity naming. */
export function carrierGuess(app: CapturedApplication): string {
  const s = `${app.source.system} ${app.source.url}`.toLowerCase();
  if (s.includes("geico")) return "GEICO";
  if (s.includes("progressive") || s.includes("foragentsonly")) return "Progressive";
  if (s.includes("safeco")) return "Safeco";
  if (s.includes("travelers")) return "Travelers";
  if (s.includes("libertymutual")) return "Liberty Mutual";
  if (s.includes("boldpenguin")) return "Bold Penguin";
  return app.source.system;
}

/** The account name a new record should get: business name for commercial,
 * the person's name otherwise. */
export function accountNameFromCapture(app: CapturedApplication): string {
  return str(app, "business", "legalName") ?? str(app, "contact", "fullName") ??
    clean(`${str(app, "contact", "firstName") ?? ""} ${str(app, "contact", "lastName") ?? ""}`);
}

/** Upserts every captured field into the knowledge tables: one dictionary row
 * per canonical label (`capture:{label}`), one answer row per account+label
 * (`capture:{accountId}:{label}` — a re-load updates instead of duplicating).
 * Dormant with a notice until the CRM tables deploy, like the EZLynx writer. */
export async function writeApplicationKnowledge(
  env: CrmEnvironment,
  app: CapturedApplication,
  accountId: string,
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const navs = await api.getKnowledgeNavProps(env);
  if (!navs) return { questionsUpserted: 0, answersUpserted: 0, skipped: "no-tables" };

  const now = new Date().toISOString();
  const sourceApp = str(app, "application", "id") ?? app.source.system;
  const ops: { key: string; method: "PATCH"; url: string; body?: unknown }[] = [];
  const seen = new Set<string>();

  for (const field of app.fields) {
    const label = clean(field.label);
    const value = clean(field.value);
    const canon = canonical(label).slice(0, 180);
    if (!canon || !value || seen.has(canon)) continue;
    seen.add(canon);
    const qExtId = `capture:${canon}`;
    ops.push({
      key: `q:${qExtId}`,
      method: "PATCH",
      url: `iacrm_carrierquestions(iacrm_amsexternalid='${esc(qExtId)}')`,
      body: {
        iacrm_carrierquestion_name: label.slice(0, 300),
        iacrm_questionid: canon.slice(0, 100),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_answertype: field.source.slice(0, 50),
        iacrm_amsexternalid: qExtId,
        iacrm_lastseen: now
      }
    });
    const aExtId = `capture:${accountId}:${canon}`;
    ops.push({
      key: `a:${aExtId}`,
      method: "PATCH",
      url: `iacrm_riskanswers(iacrm_amsexternalid='${esc(aExtId)}')`,
      body: {
        iacrm_riskanswer_name: label.slice(0, 300),
        iacrm_value: value.slice(0, 500),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_capturedon: app.capturedAt,
        iacrm_sourceapplicationid: sourceApp.slice(0, 100),
        iacrm_amsexternalid: aExtId,
        [`${navs.accountNav}@odata.bind`]: `/accounts(${accountId})`,
        [`${navs.questionNav}@odata.bind`]: `/iacrm_carrierquestions(iacrm_amsexternalid='${esc(qExtId)}')`
      }
    });
  }

  if (ops.length) {
    const results = await api.executeBatch(env, ops);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} knowledge op(s) failed: ${failed[0]!.error}`);
  }
  return { questionsUpserted: seen.size, answersUpserted: seen.size, skipped: null };
}
