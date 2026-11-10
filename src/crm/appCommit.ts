import { usDate } from "@/util/usDate";
/** CRM load for a captured application (Bold Penguin or portal ingest) -
 * the non-EZLynx twin of the quote commit: insured enrichment from the
 * normalized projection, plus every captured field logged to the
 * question-knowledge tables for the risk-data layer. */
import { canonical, claimedIndices, clean, isGridRow } from "@/boldpenguin/normalize";
import { noteRecordOf, noteSlotOf, type NoteRecord } from "@/portal/fieldMaps";
import type { CapturedApplication, CapturedAppField } from "@/boldpenguin/types";

/** Fields that describe the insured themselves; data-grid rows (Drivers,
 * Vehicles, Policies lists) are records and never stand in for them. */
const flatFields = (app: CapturedApplication) => app.fields.filter(f => !isGridRow(f));
import type { CapturedApplicant } from "@/types";
import { upsertKnowledge, type AnswerSpec, type KnowledgeApi, type KnowledgeWriteResult, type QuestionSpec } from "./knowledge";
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
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

const digitsOf = (v: string | null) => (v ?? "").replace(/\D/g, "");

/** A usable phone number, with mobile detection. Portals often pair a
 * "Phone Type" select ("Cellular telephone") with the number in a separate
 * control - a value without >=7 digits is a TYPE, never a number. */
export function detectPhone(app: CapturedApplication): { number: string; isMobile: boolean } | null {
  const typeField = flatFields(app).find(f => /\bphone\s*type\b|\btype\s*of\s*phone\b/i.test(f.label));
  const typeSaysMobile = Boolean(typeField && /cell|mobile|wireless/i.test(typeField.value));

  const normalized = str(app, "contact", "phone");
  if (normalized && digitsOf(normalized).length >= 7) return { number: normalized, isMobile: typeSaysMobile };

  const mobileField = flatFields(app).find(f =>
    /\b(cell|mobile|cellular)\b/i.test(f.label) && /phone|number|telephone/i.test(f.label + " phone") && digitsOf(f.value).length >= 7);
  if (mobileField) return { number: clean(mobileField.value), isMobile: true };

  const anyField = flatFields(app).find(f => /\bphone\b|\btelephone\b/i.test(f.label) && !/\btype\b/i.test(f.label) && digitsOf(f.value).length >= 7);
  if (anyField) return { number: clean(anyField.value), isMobile: typeSaysMobile };
  return null;
}

/** The editable identity the panel shows before anything is written -
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

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};

/** "7631 ANGELINE DR MINNEAPOLIS, MN 55428" or "... San Jose, California
 * 95122" -> parts. Carrier/lead pages print the whole address on one line,
 * with the state as an abbreviation OR a full name. */
export function splitUsAddress(line: string): { street: string; city: string; state: string; postalCode: string } | null {
  const text = clean(line);
  const m = text.match(/^(.+?),?\s+([A-Z]{2}|[A-Za-z]+(?: [A-Za-z]+)?),?\s+(\d{5}(?:-\d{4})?)$/) as (RegExpMatchArray & [string, string, string, string]) | null;
  if (!m) return null;
  let stateToken = m[2]!;
  if (stateToken.length === 2) {
    if (!/^[A-Z]{2}$/.test(stateToken) || !Object.values(STATE_ABBR).includes(stateToken)) return null;
  } else {
    const abbr = STATE_ABBR[stateToken.toLowerCase()];
    if (!abbr) return null;
    stateToken = abbr;
  }
  // the boundary between street and city is ambiguous without a comma; take the
  // last capitalized word-run before the state as the city
  const before = m[1]!.trim().replace(/,$/, "");
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
  return street ? { street, city, state: stateToken, postalCode: m[3]! } : null;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Carrier decorations on person names - GEICO renders the primary named
 * insured as "Richard Lewandowski (PNI)". Parentheticals are never part of a
 * person's name; left in place they poison the duplicate gate's name match
 * AND the created account's name. Business names are never run through this. */
function stripNameDecorations(v: string): string {
  return clean(v.replace(/\s*\([^)]*\)/g, " "));
}

/** The capture's email, only when it LOOKS like an email. Portals pair the
 * "Email" label with preference text ("paperless document delivery"), which
 * must not land in emailaddress1; fall back to any email-labeled field whose
 * value is a real address. */
function emailFromCapture(app: CapturedApplication): string {
  const mapped = clean(str(app, "contact", "email") ?? "");
  if (EMAIL_RX.test(mapped)) return mapped;
  const row = flatFields(app).find(f => /e-?mail/i.test(f.label) && EMAIL_RX.test(clean(f.value)));
  return row ? clean(row.value) : "";
}

export function identityFromCapture(app: CapturedApplication): CaptureIdentity {
  const businessName = str(app, "business", "legalName") ?? "";
  const bizCanon = canonical(businessName);
  let firstName = stripNameDecorations(str(app, "contact", "firstName") ?? "");
  let lastName = stripNameDecorations(str(app, "contact", "lastName") ?? "");
  if (!firstName && !lastName) {
    // an exactly-labeled "Name" fact row (GEICO Edge's Personal Information
    // tab) beats rail headings that glue the middle name in ("Edward
    // La-Valle Parkin"); middle tokens are middle names - last word is the
    // surname, editable in review for multi-word surnames. A value equal to
    // the BUSINESS name is never a person ("B H Towing Service" must not
    // become first "B", last "Service").
    const candidates = [
      ...flatFields(app).filter(f => /^(name|full name|policyholder name|insured name)$/i.test(clean(f.label))).map(f => f.value),
      str(app, "contact", "fullName") ?? ""
    ];
    const person = candidates.map(v => stripNameDecorations(clean(v))).find(v => v && (!bizCanon || canonical(v) !== bizCanon));
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
    // already be known separately - rate-by-zip flows capture it first)
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
    email: emailFromCapture(app),
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
    // agent-reviewed, but never let a non-address reach emailaddress1
    emails: EMAIL_RX.test(clean(id.email)) ? [clean(id.email)] : [],
    coApplicants: [],
    isCommercial
  };
}

/** A table-header cell that slipped into an array capture ("Name", "Email")
 * must never become a person. */
const HEADERISH = /^(name|full ?name|first ?name|last ?name|e-?mails?|phones?|contacts?|related contacts?)$/i;

/** Does a contact row restate the primary insured (by name or email)? */
function primaryMatcher(app: CapturedApplication): (name: string, email: string) => boolean {
  const primary = identityFromCapture(app);
  const primaryName = canonical(`${primary.firstName} ${primary.lastName}`);
  const primaryEmail = primary.email.toLowerCase();
  return (name, email) => name === primaryName || Boolean(primaryEmail && email.toLowerCase() === primaryEmail);
}

/** Contact slots that are the primary insured restated (a page's contacts
 * list includes them): a note for such a row belongs on the primary contact. */
export function primarySlots(app: CapturedApplication): number[] {
  const isPrimaryRow = primaryMatcher(app);
  return Object.keys(app.normalized)
    .map(k => /^contact(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .filter(n => {
      const grp = app.normalized[`contact${n}`] ?? {};
      const get = (k: string) => { const v = grp[k]; return typeof v === "string" ? clean(v) : ""; };
      const name = canonical(stripNameDecorations(`${get("firstName")} ${get("lastName")}`.trim() || get("fullName")));
      return n >= 2 && Boolean(name) && isPrimaryRow(name, get("email"));
    });
}

/** Related people from the capture's contact-array slots (contact2..contactN,
 * mapped or taught per-site; array teachings fan a whole related-contacts
 * table into these). Each becomes a co-applicant, which the enrichment
 * pipeline find-or-creates as a Contact under the account AFTER the account
 * itself (hierarchy: account first, then related contacts). A row restating
 * the PRIMARY insured (NowCerts lists them among related contacts) is
 * skipped - the primary contact is a one-to-one handled separately. */
export function coApplicantsFromCapture(app: CapturedApplication): CapturedApplicant["coApplicants"] {
  const isPrimaryRow = primaryMatcher(app);
  const slots = [...new Set(Object.keys(app.normalized)
    .map(k => /^(?:crm:)?contact(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .filter(n => n >= 2))]
    .sort((a, b) => a - b);
  const out: CapturedApplicant["coApplicants"] = [];
  for (const n of slots) {
    // identity columns of CRM-taught rows are bridged into contactN by the
    // normalizer; every taught column rides along as the record's extras
    const grp = app.normalized[`contact${n}`] ?? {};
    const get = (k: string) => { const v = grp[k]; return typeof v === "string" ? clean(v) : ""; };
    let firstName = stripNameDecorations(get("firstName"));
    let lastName = stripNameDecorations(get("lastName"));
    if (!firstName && !lastName) {
      const parts = stripNameDecorations(get("fullName")).split(" ").filter(Boolean);
      firstName = parts[0] ?? "";
      lastName = parts.length > 1 ? parts[parts.length - 1]! : "";
    }
    if (!firstName && !lastName) continue;
    if (HEADERISH.test(clean(`${firstName} ${lastName}`))) continue;
    const email = get("email");
    if (isPrimaryRow(canonical(`${firstName} ${lastName}`), email)) continue;
    const phone = get("phone");
    out.push({
      firstName,
      lastName,
      relationship: "",
      phone: digitsOf(phone).length >= 7 ? phone : null,
      email: EMAIL_RX.test(email) ? email : null,
      dateOfBirth: toIsoDate(get("dateOfBirth") || null),
      dlNumber: null,
      dlState: null,
      ...(crmGroup(app, `crm:contact${n}`) ? { extra: crmGroup(app, `crm:contact${n}`)! } : {}),
      slot: n
    });
  }
  return out;
}

/** The raw captured column text of one CRM-taught record ("crm:account",
 * "crm:policy2", …), or null when nothing was taught for it. */
export function crmGroup(app: CapturedApplication, name: string): Record<string, string> | null {
  const grp = app.normalized[name];
  if (!grp) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(grp)) if (typeof v === "string" && v) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** The account's address columns: whoever is the primary contact, the
 * account's Address 1 is THEIR address. */
export const ACCOUNT_ADDRESS_COLUMNS = [
  "address1_line1", "address1_line2", "address1_line3", "address1_city",
  "address1_stateorprovince", "address1_postalcode", "address1_county"
] as const;

/** A related contact's own captured address (their Contacts row), for the
 * review when the agent makes them the primary contact; null if none. */
export function contactAddressOf(app: CapturedApplication, slot: number): { street: string; city: string; state: string; postalCode: string } | null {
  const g = crmGroup(app, `crm:contact${slot}`) ?? {};
  const out = { street: g["address1_line1"] ?? "", city: g["address1_city"] ?? "", state: g["address1_stateorprovince"] ?? "", postalCode: g["address1_postalcode"] ?? "" };
  return out.street || out.city || out.postalCode ? out : null;
}

/** One captured address the agent can make the account's address: whose
 * it is and its parts (from the Addresses table). */
export interface AddressChoice {
  key: string; person: string; type: string; street: string; address2: string; unit: string;
  city: string; state: string; county: string; postalCode: string;
}
const ADDRESS_LABEL: Record<string, keyof AddressChoice> = {
  "Person": "person", "Address type": "type", "Street address": "street", "Address line 2": "address2", "Unit": "unit",
  "City": "city", "State": "state", "County": "county", "ZIP code": "postalCode"
};

/** Every captured address (every person's), in table order. */
export function addressChoices(app: CapturedApplication): AddressChoice[] {
  const rows = new Map<string, AddressChoice>();
  for (const f of app.fields) {
    if (f.section !== "Addresses" || !isGridRow(f)) continue;
    const key = ADDRESS_LABEL[f.label];
    if (!key) continue;
    const row = rows.get(f.group!) ?? rows.set(f.group!, { key: f.group!, person: "", type: "", street: "", address2: "", unit: "", city: "", state: "", county: "", postalCode: "" }).get(f.group!)!;
    row[key] = clean(f.value);
  }
  return [...rows.values()].filter(r => r.street || r.city || r.postalCode);
}

/** An address as the account's Address 1 columns. */
export function accountAddressColumns(c: AddressChoice): Record<string, string> {
  return {
    address1_line1: c.street, address1_line2: c.address2, address1_line3: c.unit, address1_city: c.city,
    address1_stateorprovince: c.state, address1_postalcode: c.postalCode, address1_county: c.county
  };
}

/** Address row numbers the capture holds ("crm:address1".."crm:addressN"),
 * ascending: row N is address number N on the insured's account. */
export function addressRows(app: { normalized: Record<string, unknown> }): number[] {
  return Object.keys(app.normalized)
    .map(k => /^crm:address(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .filter(n => n >= 1 && n <= 40)
    .sort((a, b) => a - b);
}

/** One policy draft per CRM-taught policy row (policies are an array: an
 * AMS policies list fans into crm:policy1..N). Empty when no policy row was
 * taught - the caller falls back to the single label-scored draft. */
export function policyDraftsFromCapture(app: CapturedApplication): (PolicyDraft & { extra: Record<string, string> })[] {
  return Object.keys(app.normalized)
    .map(k => /^crm:policy(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .sort((a, b) => a - b)
    .map(n => crmGroup(app, `crm:policy${n}`))
    .filter((g): g is Record<string, string> => g !== null)
    .map(g => ({
      hasPolicy: Boolean(g["iacrm_policynumber"]),
      number: g["iacrm_policynumber"] ?? "",
      premiumText: g["iacrm_premium"] ?? "",
      effectiveDate: g["iacrm_effectivedate"] ?? "",
      expirationDate: g["iacrm_expirationdate"] ?? "",
      carrierName: carrierGuess(app),
      extra: g
    }));
}

/** Projects the capture's normalized identity into the shape the existing
 * enrichment pipeline (ensureInsuredData) already consumes. */
export function applicantFromCapture(app: CapturedApplication): CapturedApplicant {
  return {
    ...applicantFromIdentity(identityFromCapture(app), Boolean(str(app, "business", "legalName"))),
    coApplicants: coApplicantsFromCapture(app)
  };
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

function fieldValue(app: CapturedApplication, labelRe: RegExp, notRe?: RegExp): string {
  const f = flatFields(app).find(x => labelRe.test(x.label) && x.value && !(notRe && notRe.test(`${x.label} ${x.section ?? ""}`)));
  return f ? clean(f.value) : "";
}

/** A prior policy's value (its label or its "Prior Auto Policy" table):
 * never the dates of the policy being written. */
const PRIOR_POLICY = /\bprior\b|\bprevious\b|current carrier|continuous coverage/i;

function addMonthsUs(usDate: string, months: number): string {
  const m = usDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return "";
  const d = new Date(Number(m[3]), Number(m[1]) - 1 + months, Number(m[2]));
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function policyFromCapture(app: CapturedApplication): PolicyDraft {
  const number = str(app, "policy", "number") ?? fieldValue(app, /^policy\s*(number|no|#)\b/i);
  const premium = str(app, "policy", "premium") ||
    fieldValue(app, /total\s+premium|premium\s*:?\s*$/i);
  const effectiveDate = str(app, "coverage", "effectiveDate") ?? fieldValue(app, /effective\s*date/i, PRIOR_POLICY);
  let expirationDate = str(app, "coverage", "expirationDate") ?? fieldValue(app, /expiration\s*date/i, PRIOR_POLICY);
  if (!expirationDate && effectiveDate) {
    // sale screens rarely print the expiration - derive it from the term
    // ("Policy Term: 6 months" / "6 Month Auto Premium")
    const termField = flatFields(app).find(f => /\b(6|12)\s*[- ]?month/i.test(`${f.label} ${f.value}`));
    const termText = fieldValue(app, /policy\s*term/i) || (termField ? `${termField.label} ${termField.value}` : "");
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

/** Rule paths whose fields are written to real CRM columns by the load -
 * everything else is supplemental and goes into the activity note. */
// bare "contact" prefix covers the primary (contact.) AND every related-
// contact array slot (contact2., contact3., …) - all become contact records
// "crm:" = agent-taught CRM columns, written to their records by the load
// "note" = taught into the timeline note, which has its own entry
const STRUCTURED_PATHS = ["contact", "address.", "business.legalName", "policy.", "coverage.effectiveDate", "coverage.expirationDate", "crm:", "note"];

export interface SupplementalNote {
  subject: string;
  /** Matches the subject earlier versions wrote (same words, different
   * separator), so a re-load updates that note instead of adding another. */
  legacyMatch: { prefix: string; suffix: string };
  body: string;
  count: number;
}

/** Fields with no CRM column mapping (employment, payment plan, coverage
 * elections, building details…) grouped by section into one readable note
 * for the account timeline. Stable subject per source, so a re-load updates
 * the same note instead of stacking duplicates. */
export function buildSupplementalNote(app: CapturedApplication): SupplementalNote | null {
  const claimed = claimedIndices(app.fields, STRUCTURED_PATHS);
  // "Related contacts" rows are CRM-sourced display context - never written back
  const extra = app.fields.filter((f, i) => !claimed.has(i) && f.section !== "Related contacts");
  if (!extra.length) return null;
  // ONE rich-text note, laid out like the timeline note: a Field/Value
  // table per section, list rows as a table with their real columns
  const body = noteHtml("Captured Application Data", app, extra.map(f => ({ ...f, section: f.section || "Details" }))).slice(0, 90000);
  return {
    subject: `QuoteCraftZ: captured application data (${app.source.system})`,
    // earlier versions wrote "Quote Connector: ..." and "Quote Connector <dash> ..."
    legacyMatch: { prefix: "Quote Connector", suffix: ` captured application data (${app.source.system})` },
    body,
    count: extra.length
  };
}

const html = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TABLE = '<table border="1" cellpadding="4" style="border-collapse:collapse">';

export interface TimelineNote { subject: string; html: string; count: number }

/** How a load result names a note write (notes are dated history: a new
 * note, today's note corrected, or nothing changed). */
export function noteOutcomeText(outcome: "created" | "updated" | "unchanged"): string {
  return outcome === "created" ? "new timeline note" : outcome === "updated" ? "today's timeline note updated" : "unchanged, no new note";
}

/** Values the agent tagged for a record's timeline ("Notes: Insured",
 * "Notes: Policy", ...), gathered into ONE rich-text "Non Mapped Timeline
 * Entries" note per record and source site, organized like the panel:
 * single values as a Field/Value table, grid columns as a table under the
 * grid's title with its real headers. Stable subject, so a re-load updates
 * the same note. */
/** A captured prior (incumbent) policy: one per "Prior <Line> Policy" table
 * (EZLynx's rating Policy Info step), as text the load turns into a CRM
 * Prior Coverage record. */
export interface PriorCoverageDraft {
  line: string; carrier: string; policyNumber: string; effectiveDate: string; expirationDate: string;
  term: string; premium: string; liabilityLimits: string; yearsWithCarrier: string; yearsContinuous: string;
  /** Prior Coverage columns the agent mapped directly (no draft slot). */
  extra: Record<string, string>;
}

/** Prior Coverage columns that ARE a draft slot (names, carrier match,
 * dates and term keep their handling when mapped directly). */
const PRIOR_SLOT: Record<string, Exclude<keyof PriorCoverageDraft, "line" | "extra">> = {
  iacrm_priorcarriername: "carrier", iacrm_policynumber: "policyNumber", iacrm_effectivedate: "effectiveDate",
  iacrm_expirationdate: "expirationDate", iacrm_policyterm: "term", iacrm_premium: "premium",
  iacrm_liabilitylimits: "liabilityLimits", iacrm_yearswithpriorcarrier: "yearsWithCarrier",
  iacrm_yearscontinuouscoverage: "yearsContinuous"
};

export function priorCoveragesFromCapture(app: CapturedApplication): PriorCoverageDraft[] {
  const byLine = new Map<string, PriorCoverageDraft>();
  const draft = (line: string) => byLine.get(line) ?? byLine.set(line, {
    line, carrier: "", policyNumber: "", effectiveDate: "", expirationDate: "", term: "", premium: "",
    liabilityLimits: "", yearsWithCarrier: "", yearsContinuous: "", extra: {}
  }).get(line)!;
  // values mapped straight to a Prior Coverage column on a page without a line
  const unlined: { column: string; value: string }[] = [];
  for (const f of app.fields) {
    const m = /^prior (.{1,30}) policy$/i.exec(f.section ?? "");
    const value = clean(f.value);
    if (!value) continue;
    const col = /^crm:priorcoverage\.([a-z0-9_]+)$/.exec(f.mapped ?? "")?.[1];
    if (col) {
      if (m) putColumn(draft(m[1]!), col, value);
      else unlined.push({ column: col, value });
      continue;
    }
    if (!m) continue;
    const d = draft(m[1]!);
    const l = f.label.toLowerCase();
    const set = (k: Exclude<keyof PriorCoverageDraft, "line" | "extra">) => { if (!d[k]) d[k] = value; };
    if (/continuous coverage/.test(l)) set("yearsContinuous");
    else if (/years with (prior |current )?(carrier|insurer)/.test(l)) set("yearsWithCarrier");
    else if (/carrier|insurer|company/.test(l)) set("carrier");
    else if (/policy\s*(number|no\b|#)/.test(l)) set("policyNumber");
    else if (/expiration|expires/.test(l)) set("expirationDate");
    else if (/effective/.test(l)) set("effectiveDate");
    else if (/term/.test(l)) set("term");
    else if (/premium/.test(l)) set("premium");
    else if (/limit/.test(l)) set("liabilityLimits");
  }
  // no line on the page: the one prior policy held, else its own record
  if (unlined.length) {
    const target = byLine.size === 1 ? [...byLine.values()][0]! : draft("");
    for (const u of unlined) putColumn(target, u.column, u.value);
  }
  return [...byLine.values()].filter(d => d.carrier || d.expirationDate || d.policyNumber || Object.keys(d.extra).length);
}
/** A directly mapped column wins over what the label suggested. */
function putColumn(d: PriorCoverageDraft, column: string, value: string): void {
  const slot = PRIOR_SLOT[column];
  if (slot) d[slot] = value;
  else d.extra[column] = value;
}

/** A prior coverage as CRM Prior Coverage columns (dates ISO, premium a
 * number, term the 6 / 12 Month / Other choice). */
export function priorCoverageColumns(d: PriorCoverageDraft, source: string): Record<string, unknown> {
  const iso = (v: string) => toIsoDate(v || null) ?? undefined;
  const term = /\b6\b/.test(d.term) ? 298400000 : /\b12\b/.test(d.term) ? 298400001 : d.term ? 298400002 : undefined;
  const out: Record<string, unknown> = {
    iacrm_name: `Prior ${d.line ? `${d.line} ` : ""}Policy${d.carrier ? ` - ${d.carrier}` : ""}`.slice(0, 200),
    iacrm_priorcarriername: d.carrier.slice(0, 200) || undefined,
    iacrm_policynumber: d.policyNumber.slice(0, 100) || undefined,
    iacrm_effectivedate: iso(d.effectiveDate),
    iacrm_expirationdate: iso(d.expirationDate),
    iacrm_policyterm: term,
    iacrm_premium: parseMoney(d.premium) ?? undefined,
    iacrm_liabilitylimits: d.liabilityLimits.slice(0, 100) || undefined,
    iacrm_yearswithpriorcarrier: d.yearsWithCarrier.slice(0, 50) || undefined,
    iacrm_yearscontinuouscoverage: d.yearsContinuous.slice(0, 50) || undefined,
    iacrm_source: source.slice(0, 100) || undefined
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** The line of business a section names: "Prior Home Policy", "Opportunity
 * Policy - Auto", "Auto: Vehicles"; "" when it names none. */
export function lineOfSection(section: string | undefined): string {
  const s = section ?? "";
  const policy = /^(?:prior|new) (.{1,30}) policy$/i.exec(s) ?? /^opportunity policy - (.{1,30})$/i.exec(s);
  if (policy) return policy[1]!;
  const step = /^([^:]{1,40}):\s/.exec(s);
  return step ? step[1]! : "";
}

/** A section that belongs to ANOTHER line of business ("Prior Home Policy"
 * when the record is the Auto opportunity). Sections without a line belong
 * to every record. */
export function otherLine(section: string | undefined, lob: string): boolean {
  const line = lineOfSection(section);
  if (!line || !lob) return false;
  const a = canonical(line), b = canonical(lob);
  return !(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function buildTimelineNote(app: CapturedApplication, record: NoteRecord = "account", lob = ""): TimelineNote | null {
  // a line's opportunity takes only its own line's tables (Auto's prior
  // policy never lands on the Home opportunity)
  const tagged = app.fields.filter(f => noteRecordOf(f.mapped) === record && clean(f.value) && !otherLine(f.section, lob));
  if (!tagged.length) return null;
  return {
    subject: `QuoteCraftZ: Non Mapped Timeline Entries (${app.source.system})`,
    html: noteHtml("Non Mapped Timeline Entries", app, tagged).slice(0, 100000),
    count: tagged.length
  };
}

/** The note for ONE related contact (slot N = contactN): the values tagged
 * "Notes: Related contact", on that person's own timeline. */
export function buildRelatedContactNote(app: CapturedApplication, slot: number): TimelineNote | null {
  const tagged = app.fields
    .filter(f => noteSlotOf(f.mapped) === slot && clean(f.value))
    // one person: their values read as Field / Value, not a one-row table
    .map(f => ({ ...f, group: "" }));
  if (!tagged.length) return null;
  return {
    subject: `QuoteCraftZ: Non Mapped Timeline Entries (${app.source.system})`,
    html: noteHtml("Non Mapped Timeline Entries", app, tagged).slice(0, 100000),
    count: tagged.length
  };
}

/** Related-contact slots holding values for their own timeline. */
export function relatedNoteSlots(app: CapturedApplication): number[] {
  return [...new Set(app.fields.map(f => noteSlotOf(f.mapped)).filter((n): n is number => n !== null))].sort((a, b) => a - b);
}

/** One rich-text note body: a heading, when and where it was captured, then
 * per section a Field/Value table for single values and a table with the
 * list's real columns for its rows. Every field in ONE note. */
function noteHtml(title: string, app: CapturedApplication, fields: CapturedApplication["fields"]): string {
  const parts: string[] = [
    `<h2>${html(title)}</h2>`,
    `<p><b>Captured ${html(new Date(app.capturedAt).toLocaleString())} from ${html(app.source.system)}</b></p>`
  ];
  for (const section of [...new Set(fields.map(f => f.section))]) {
    const inSection = fields.filter(f => f.section === section);
    parts.push(`<h3>${html(section || "Notes")}</h3>`);
    const singles = inSection.filter(f => !isGridRow(f));
    if (singles.length) {
      parts.push(TABLE + "<tr><th>Field</th><th>Value</th></tr>" +
        singles.map(f => `<tr><td>${html(f.label)}</td><td>${html(usDate(f.value))}</td></tr>`).join("") + "</table>");
    }
    const rows = inSection.filter(isGridRow);
    if (rows.length) {
      const columns = [...new Set(rows.map(f => f.label))];
      const byRow = new Map<string, Record<string, string>>();
      for (const f of rows) byRow.set(f.group ?? "", { ...(byRow.get(f.group ?? "") ?? {}), [f.label]: usDate(f.value) });
      parts.push(TABLE + "<tr>" + columns.map(c => `<th>${html(c)}</th>`).join("") + "</tr>" +
        [...byRow.values()].map(r => "<tr>" + columns.map(c => `<td>${html(r[c] ?? "")}</td>`).join("") + "</tr>").join("") +
        "</table>");
    }
  }
  return parts.join("");
}

/** Default for the Insured type radio. Commercial only when the capture
 * carries real commercial markers (NAIC/SIC/FEIN, revenue/payroll, business
 * insurance lines) or a business with no person - a stray company-ish field
 * on a personal-lines quote must not flip the default. */
export function guessInsuredType(app: CapturedApplication): 1 | 2 {
  const id = identityFromCapture(app);
  if (!id.businessName) return 1;
  const person = `${id.firstName} ${id.lastName}`.trim();
  if (!person) return 2;
  const markers = app.fields.some(f =>
    /\bnaic\b|\bsic\b|\bfein\b|\bein\b|annual revenue|annual payroll|subcontractor|number of employees|workers[' ]?comp|general liability|professional liability|commercial auto|\bbop\b/i
      .test(`${f.label} ${f.value}`));
  return markers ? 2 : 1;
}

/** Structured coverage lines for iacrm_quotecoverage, from the capture's
 * coverage-ish fields. Code comes from a parenthesized abbreviation in the
 * label ("Bodily Injury Liability (BI)" -> BI), else initials. Values stay
 * verbatim in limitText. */
export function coverageLinesFromCapture(app: CapturedApplication): { code: string; label: string; limitText: string }[] {
  return flatFields(app)
    .filter(f => /\$\s*[\d,]/.test(f.value) || /coverage|liabilit|deductible|csl|\bum\b|uim|pip|medical|physical damage|comprehensive|collision|limit/i.test(f.label))
    .filter(f => !/total.*premium|due today|policy term/i.test(f.label))
    .map(f => {
      const paren = f.label.match(/\(([A-Z/&]{2,8})\)/);
      const code = paren ? paren[1]! : f.label.split(/\s+/).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 6);
      return { code, label: f.label, limitText: f.value.slice(0, 100) };
    });
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
  if (s.includes("bhhc") || s.includes("berkshire")) return "Berkshire Hathaway Homestate";
  if (s.includes("biberk")) return "biBerk";
  if (s.includes("chubb")) return "Chubb";
  if (s.includes("nationwide")) return "Nationwide";
  if (s.includes("thehartford") || s.includes("hartford")) return "The Hartford";
  if (s.includes("hiscox")) return "Hiscox";
  if (s.includes("nextinsurance") || s.includes("next-insurance")) return "NEXT";
  if (s.includes("pieinsurance") || s.includes("pie.")) return "Pie";
  if (s.includes("attune")) return "Attune";
  if (s.includes("coterie")) return "Coterie";
  if (s.includes("employers")) return "EMPLOYERS";
  return app.source.system;
}

/** The mapping target that marks a page value as a QUOTE's premium. Only
 * a value the agent mapped here makes a quote: a page shows other
 * premiums too (the prior policy's, the current policy's). */
export const QUOTE_PREMIUM_TARGET = "crm:quote.iacrm_premium";

/** What a rating portal's coverage/summary screen yields toward an
 * iacrm_quote: a premium MAPPED to the quote premium, WITHOUT a policy
 * number (a number means it sold - that's the policy flow instead). */
export interface QuoteDraft {
  hasQuote: boolean;
  premiumText: string;
  carrierName: string;
  coverageSummary: string;
  effectiveDate: string;
}

export function quoteFromCapture(app: CapturedApplication): QuoteDraft {
  const policy = policyFromCapture(app);
  const premium = clean(app.fields.find(f => f.mapped === QUOTE_PREMIUM_TARGET && clean(f.value))?.value ?? "");
  const lines = flatFields(app)
    .filter(f => /\$\s*[\d,]/.test(f.value) || /coverage|liabilit|deductible|csl|\bum\b|uim|pip|medical|physical damage|comprehensive|collision|limit/i.test(f.label))
    .map(f => `${f.label}: ${f.value}`);
  return {
    hasQuote: Boolean(parseMoney(premium)) && !policy.hasPolicy,
    premiumText: premium,
    carrierName: carrierGuess(app),
    coverageSummary: [...new Set(lines)].join("\n").slice(0, 3900),
    effectiveDate: policy.effectiveDate
  };
}

/** The account name a new record should get: business name for commercial,
 * the person's name otherwise. */
export function accountNameFromCapture(app: CapturedApplication): string {
  return str(app, "business", "legalName") ?? str(app, "contact", "fullName") ??
    clean(`${str(app, "contact", "firstName") ?? ""} ${str(app, "contact", "lastName") ?? ""}`);
}

/** A captured field's risk-data question: its label and the dictionary
 * key in iacrm_questionid. Grid rows are records: "Vehicles list Row 2:
 * VIN" is its own answer, never collapsed into Row 1's VIN. */
export function knowledgeKeyOf(field: CapturedAppField): { label: string; key: string } {
  const label = isGridRow(field) ? clean(`${field.section} ${field.group}: ${field.label}`) : clean(field.label);
  return { label, key: `capture:${canonical(label)}`.slice(0, 100) };
}

/** The risk-data question keys captured from one asset row ("crm:vehicle2"):
 * the row's mapped values, plus every other value of the same table row
 * (same section and row), so the whole vehicle's answers point at its
 * insured item. */
export function assetRowQuestionKeys(app: CapturedApplication, row: string): string[] {
  const mapped = app.fields.filter(f => f.mapped?.startsWith(`${row}.`) && clean(f.value));
  const rowsOf = new Set(mapped.filter(f => f.group).map(f => `${f.section}\u0000${f.group}`));
  const keys = app.fields
    .filter(f => f.section !== "Related contacts" && clean(f.value))
    .filter(f => mapped.includes(f) || (f.group && rowsOf.has(`${f.section}\u0000${f.group}`)))
    .map(f => knowledgeKeyOf(f).key)
    .filter(k => k !== "capture:");
  return [...new Set(keys)];
}

/** Upserts every captured field into the knowledge tables via the shared
 * READ-then-write core (`upsertKnowledge`): dictionary keyed by
 * `capture:{canonical label}` in iacrm_questionid, one answer per
 * account+question (re-loads update). Never touches iacrm_amsexternalid -
 * that column is reserved for the AMS sync. */
export async function writeApplicationKnowledge(
  env: CrmEnvironment,
  app: CapturedApplication,
  accountId: string,
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const now = new Date().toISOString();
  const sourceApp = (str(app, "application", "id") ?? app.source.system).slice(0, 100);
  const questions: QuestionSpec[] = [];
  const answers: AnswerSpec[] = [];
  const seen = new Set<string>();

  for (const field of app.fields) {
    if (field.section === "Related contacts") continue; // CRM-sourced context, not risk data
    const { label, key } = knowledgeKeyOf(field);
    const value = clean(field.value);
    if (key === "capture:" || !value || seen.has(key)) continue;
    seen.add(key);
    questions.push({
      key,
      body: {
        iacrm_carrierquestion_name: label.slice(0, 300),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_answertype: field.source.slice(0, 50),
        iacrm_lastseen: now
      }
    });
    answers.push({
      questionKey: key,
      sourceApplicationId: null,
      body: {
        iacrm_riskanswer_name: label.slice(0, 300),
        iacrm_value: value.slice(0, 500),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_capturedon: app.capturedAt,
        iacrm_sourceapplicationid: sourceApp
      }
    });
  }

  return upsertKnowledge(env, accountId, questions, answers, api);
}


/** The page sections a mapped row's values came from ("crm:vehicle2" ->
 * {"Vehicles"}): records on an asset attach to the asset from the same page. */
export function rowSections(app: CapturedApplication, row: string): Set<string> {
  return new Set(app.fields.filter(f => f.mapped?.startsWith(`${row}.`) && f.section).map(f => f.section));
}
