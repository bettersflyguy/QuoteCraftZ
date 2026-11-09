/** EZLynx as a DATA-SERVICE source for the shared intake: the applicant and
 * rating run come from EZLynx's own data service (exact, not scraped). The
 * applicant becomes capture fields routed by the agent's data-service
 * mappings (Settings > Data Services); the rating run becomes held quotes. */
import type { CapturedAppField, HeldQuote } from "@/boldpenguin/types";
import type { CapturedApplicant, CapturedRun } from "@/types";
import { isNoteTarget, isRoutablePath } from "@/portal/fieldMaps";

export interface DataServiceField {
  id: string;
  label: string;
  /** "Insured" is the account (one record); "Contacts" repeat per person
   * (row 1 the applicant, then each contact added with Add contact);
   * "Phones" / "Emails" per additional phone / email; "Addresses" per
   * address (primary first). */
  section: "Insured" | "Contacts" | "Phones" | "Emails" | "Addresses";
  /** Ids this field had before the applicant and contacts were one list:
   * a saved mapping under one of them carries over. */
  legacy?: string[];
  defaultTarget: string;
  /** How the source's own screens label it (canonical), so the page peek
   * knows which on-screen fields the data service already covers.
   * "primary address>city": only the City inside the Primary Address
   * section (the Other Address twin is a separate page field);
   * "*address>city": the City in EVERY address section, one row each;
   * "#contact>gender": on the page headed "Contact"; "a/b>x": inside both. */
  pageLabels?: string[];
  /** Identifier (SSN, DL#): secured pass-through only - never a capture
   * field, a note or a share file; mapped only to a secured CRM column. */
  secured?: boolean;
}

/** On-screen labels, scoped (see the page scripts' scopeMatches): the
 * applicant's fields sit in the "Applicant Info" panel; a contact's in its
 * own panel ("Co-Applicant" / "Contact") or on the new-contact form (page
 * heading "Contact"). "a/b>x": inside both. */
const APP = (...labels: string[]): string[] => labels.map(l => `applicant info>${l}`);
const PRIMARY_ADDRESS = (...labels: string[]): string[] => labels.map(l => `applicant info/primary address>${l}`);
const EVERY_ADDRESS = (...labels: string[]): string[] => labels.map(l => `applicant info/*address>${l}`);
const CONTACT = (...labels: string[]): string[] => labels.flatMap(l => [`co applicant>${l}`, `contact>${l}`, `#contact>${l}`]);

/** EVERYTHING the EZLynx data service returns, so Settings shows exactly
 * what goes to CRM. The insured's ACCOUNT-level data is one section; every
 * PERSON is one Contacts list - row 1 is the applicant (the named insured,
 * CRM's primary contact unless the agent picks another at load), then each
 * contact added with Add contact. "legacy": the ids the same field had when
 * the applicant and the contacts were mapped separately, so saved mappings
 * carry over. Defaults reproduce what the dedicated importer always wrote. */
const PERSON = (...labels: string[]): string[] => [...APP(...labels), ...CONTACT(...labels)];
const both = (k: string): string[] => [`applicant.${k}`, `coApplicant.${k}`];
export const EZLYNX_FIELDS: DataServiceField[] = [
  // the insured (account)
  { id: "applicant.applicantType", label: "Applicant type", section: "Insured", defaultTarget: "", pageLabels: APP("applicant type") },
  { id: "applicant.customerSince", label: "Customer since", section: "Insured", defaultTarget: "", pageLabels: APP("customer since") },
  { id: "applicant.accountName", label: "Account name", section: "Insured", defaultTarget: "", pageLabels: APP("account name") },
  { id: "applicant.leadSource", label: "Lead source", section: "Insured", defaultTarget: "", pageLabels: APP("lead source") },
  { id: "applicant.assignedProducer", label: "Assigned producer", section: "Insured", defaultTarget: "", pageLabels: APP("assigned producer") },
  { id: "applicant.csr", label: "CSR", section: "Insured", defaultTarget: "", pageLabels: APP("csr") },
  { id: "applicant.isVip", label: "VIP", section: "Insured", defaultTarget: "", pageLabels: APP("vip") },
  { id: "applicant.ratingState", label: "Rating state", section: "Insured", defaultTarget: "", pageLabels: APP("rating state", "address state") },
  { id: "applicant.isCommercial", label: "Commercial applicant", section: "Insured", defaultTarget: "" },
  // the insured's primary address (the account's Address 1)
  { id: "applicant.street", label: "Street address", section: "Insured", defaultTarget: "address.street1", pageLabels: PRIMARY_ADDRESS("address") },
  { id: "applicant.unit", label: "Unit", section: "Insured", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("unit") },
  { id: "applicant.address2", label: "Address line 2", section: "Insured", defaultTarget: "address.street2", pageLabels: PRIMARY_ADDRESS("address line 2") },
  { id: "applicant.city", label: "City", section: "Insured", defaultTarget: "address.city", pageLabels: PRIMARY_ADDRESS("city") },
  { id: "applicant.state", label: "State", section: "Insured", defaultTarget: "address.state", pageLabels: PRIMARY_ADDRESS("state") },
  { id: "applicant.county", label: "County", section: "Insured", defaultTarget: "crm:account.address1_county", pageLabels: PRIMARY_ADDRESS("county") },
  { id: "applicant.postalCode", label: "ZIP code", section: "Insured", defaultTarget: "address.postalCode", pageLabels: PRIMARY_ADDRESS("postal code", "zip code") },
  { id: "applicant.postalCodeSuffix", label: "ZIP suffix", section: "Insured", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("postal code suffix") },
  { id: "applicant.yearsAtAddress", label: "Years at address", section: "Insured", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("years at address") },
  { id: "applicant.monthsAtAddress", label: "Months at address", section: "Insured", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("months at address") },
  // every person: row 1 the applicant, then each contact (one CRM contact each)
  { id: "person.firstName", label: "First name", section: "Contacts", defaultTarget: "contacts[].firstName", pageLabels: PERSON("first name"), legacy: both("firstName") },
  { id: "person.middleInitial", label: "Middle initial", section: "Contacts", defaultTarget: "crm:contacts[].middlename", pageLabels: PERSON("middle initial"), legacy: both("middleInitial") },
  { id: "person.lastName", label: "Last name", section: "Contacts", defaultTarget: "contacts[].lastName", pageLabels: PERSON("last name"), legacy: both("lastName") },
  { id: "person.nickName", label: "Nickname", section: "Contacts", defaultTarget: "crm:contacts[].nickname", pageLabels: PERSON("nickname"), legacy: both("nickName") },
  { id: "person.maidenName", label: "Maiden name", section: "Contacts", defaultTarget: "", pageLabels: PERSON("maiden name"), legacy: both("maidenName") },
  { id: "person.relationship", label: "Relationship", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("relationship"), legacy: ["coApplicant.relationship"] },
  { id: "person.isCoApplicant", label: "Co-applicant", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("make this contact co applicant"), legacy: ["coApplicant.isCoApplicant"] },
  { id: "person.isDriver", label: "Driver", section: "Contacts", defaultTarget: "", legacy: ["coApplicant.isDriver"] },
  { id: "person.dateOfBirth", label: "Date of birth", section: "Contacts", defaultTarget: "contacts[].dateOfBirth", pageLabels: PERSON("dob", "date of birth"), legacy: both("dateOfBirth") },
  { id: "person.ssn", label: "SSN", section: "Contacts", defaultTarget: "secure:contacts[].iacrm_socialsecuritynumber", pageLabels: PERSON("ssn"), secured: true, legacy: both("ssn") },
  { id: "person.dlNumber", label: "DL#", section: "Contacts", defaultTarget: "secure:contacts[].iacrm_driverslicense", pageLabels: PERSON("dl"), secured: true, legacy: both("dlNumber") },
  { id: "person.gender", label: "Gender", section: "Contacts", defaultTarget: "crm:contacts[].gendercode", pageLabels: PERSON("gender"), legacy: both("gender") },
  { id: "person.maritalStatus", label: "Marital status", section: "Contacts", defaultTarget: "crm:contacts[].familystatuscode", pageLabels: PERSON("marital status"), legacy: both("maritalStatus") },
  { id: "person.education", label: "Education", section: "Contacts", defaultTarget: "crm:contacts[].educationcode", pageLabels: PERSON("education"), legacy: both("education") },
  { id: "person.industry", label: "Industry", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_employmentindustry", pageLabels: PERSON("industry"), legacy: both("industry") },
  { id: "person.occupation", label: "Occupation", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_employmentoccupation", pageLabels: PERSON("occupation"), legacy: both("occupation") },
  { id: "person.yearsAtOccupation", label: "Years at occupation", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_yearsemployed", pageLabels: PERSON("years"), legacy: both("yearsAtOccupation") },
  { id: "person.priorEmployerInYears", label: "Prior employer (years)", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_prioryearsemployed", pageLabels: PERSON("prior employer in years"), legacy: both("priorEmployerInYears") },
  { id: "person.driversLicenseStatus", label: "License status", section: "Contacts", defaultTarget: "", pageLabels: PERSON("dl status"), legacy: both("driversLicenseStatus") },
  { id: "person.driversLicenseState", label: "License state", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_dlstate", pageLabels: PERSON("dl state"), legacy: both("driversLicenseState") },
  { id: "person.preferredContactMethod", label: "Preferred contact method", section: "Contacts", defaultTarget: "crm:contacts[].preferredcontactmethodcode", pageLabels: PERSON("preferred contact method", "contact method"), legacy: both("preferredContactMethod") },
  { id: "person.isDeceased", label: "Deceased", section: "Contacts", defaultTarget: "", pageLabels: APP("deceased"), legacy: ["applicant.isDeceased"] },
  // each person's FIRST email / phone (the applicant's fill the insured);
  // the others are rows of the Phones / Emails lists
  { id: "person.email", label: "Primary email", section: "Contacts", defaultTarget: "contacts[].email", pageLabels: PERSON("email", "email address", "email type"), legacy: both("email") },
  { id: "person.phone", label: "Primary phone", section: "Contacts", defaultTarget: "contacts[].phone", pageLabels: PERSON("phone number", "phone", "phone type", "extension"), legacy: both("phone") },
  { id: "person.mobile", label: "Mobile phone", section: "Contacts", defaultTarget: "crm:contacts[].mobilephone", legacy: ["applicant.mobile"] },
  // each person's own address (their CRM contact's Address 1)
  { id: "person.street", label: "Street address", section: "Contacts", defaultTarget: "crm:contacts[].address1_line1", pageLabels: CONTACT("address"), legacy: ["coApplicant.street"] },
  { id: "person.address2", label: "Address line 2", section: "Contacts", defaultTarget: "crm:contacts[].address1_line2", pageLabels: CONTACT("address line 2"), legacy: ["coApplicant.address2"] },
  { id: "person.unit", label: "Unit", section: "Contacts", defaultTarget: "crm:contacts[].address1_line3", pageLabels: CONTACT("unit"), legacy: ["coApplicant.unit"] },
  { id: "person.city", label: "City", section: "Contacts", defaultTarget: "crm:contacts[].address1_city", pageLabels: CONTACT("city"), legacy: ["coApplicant.city"] },
  { id: "person.state", label: "State", section: "Contacts", defaultTarget: "crm:contacts[].address1_stateorprovince", pageLabels: CONTACT("state"), legacy: ["coApplicant.state"] },
  { id: "person.county", label: "County", section: "Contacts", defaultTarget: "crm:contacts[].address1_county", pageLabels: CONTACT("county"), legacy: ["coApplicant.county"] },
  { id: "person.postalCode", label: "ZIP code", section: "Contacts", defaultTarget: "crm:contacts[].address1_postalcode", pageLabels: CONTACT("postal code"), legacy: ["coApplicant.postalCode"] },
  // every phone / email after a person's primary (each person's), one row
  // each with whose it is, to the note the agent picks
  { id: "phone.person", label: "Person", section: "Phones", defaultTarget: "note" },
  { id: "phone.type", label: "Phone type", section: "Phones", defaultTarget: "note" },
  { id: "phone.number", label: "Phone number", section: "Phones", defaultTarget: "note" },
  { id: "phone.extension", label: "Extension", section: "Phones", defaultTarget: "note" },
  { id: "email.person", label: "Person", section: "Emails", defaultTarget: "note" },
  { id: "email.type", label: "Email type", section: "Emails", defaultTarget: "note" },
  { id: "email.email", label: "Email address", section: "Emails", defaultTarget: "note" },
  // every address the insured has: row N = CRM address N (1 = Address 1)
  { id: "address.type", label: "Address type", section: "Addresses", defaultTarget: "crm:addresses[].name", pageLabels: EVERY_ADDRESS("address type") },
  { id: "address.street", label: "Street address", section: "Addresses", defaultTarget: "crm:addresses[].line1", pageLabels: EVERY_ADDRESS("address") },
  { id: "address.address2", label: "Address line 2", section: "Addresses", defaultTarget: "crm:addresses[].line2", pageLabels: EVERY_ADDRESS("address line 2") },
  { id: "address.unit", label: "Unit", section: "Addresses", defaultTarget: "crm:addresses[].line3", pageLabels: EVERY_ADDRESS("unit") },
  { id: "address.city", label: "City", section: "Addresses", defaultTarget: "crm:addresses[].city", pageLabels: EVERY_ADDRESS("city") },
  { id: "address.state", label: "State", section: "Addresses", defaultTarget: "crm:addresses[].stateorprovince", pageLabels: EVERY_ADDRESS("state") },
  { id: "address.county", label: "County", section: "Addresses", defaultTarget: "crm:addresses[].county", pageLabels: EVERY_ADDRESS("county") },
  { id: "address.postalCode", label: "ZIP code", section: "Addresses", defaultTarget: "crm:addresses[].postalcode", pageLabels: EVERY_ADDRESS("postal code") },
  { id: "address.postalCodeSuffix", label: "ZIP suffix", section: "Addresses", defaultTarget: "", pageLabels: EVERY_ADDRESS("postal code suffix") },
  { id: "address.yearsAtAddress", label: "Years at address", section: "Addresses", defaultTarget: "", pageLabels: EVERY_ADDRESS("years at address") },
  { id: "address.monthsAtAddress", label: "Months at address", section: "Addresses", defaultTarget: "", pageLabels: EVERY_ADDRESS("months at address") }
];
/** A data service's fields as page-peek items: each covers the on-screen
 * fields its scoped labels name, badged with what it feeds. */
export function dataServicePeekItems(saved: Record<string, string> | undefined, labelOf: (target: string) => string):
  { key: string; label: string; kind: "mapped"; labels: string[]; target: string }[] {
  const targets = effectiveTargets(saved);
  return EZLYNX_FIELDS
    .filter(f => targets[f.id] && f.pageLabels?.length)
    .map(f => ({ key: `service:${f.id}`, label: labelOf(targets[f.id]!), kind: "mapped" as const, labels: f.pageLabels!, target: targets[f.id]! }));
}

export const DATA_SERVICE_STORAGE_KEY = "dataservice/fieldMap";
export type DataServiceMaps = Record<string, Record<string, string>>;

export async function getDataServiceMaps(): Promise<DataServiceMaps> {
  const s = await chrome.storage.local.get(DATA_SERVICE_STORAGE_KEY);
  return (s[DATA_SERVICE_STORAGE_KEY] as DataServiceMaps | undefined) ?? {};
}

export async function setDataServiceMap(source: string, map: Record<string, string>): Promise<void> {
  const all = await getDataServiceMaps();
  all[source] = map;
  await chrome.storage.local.set({ [DATA_SERVICE_STORAGE_KEY]: all });
}

/** A primary-contact target as the same target for every person's row
 * ("crm:primarycontact.x" -> "crm:contacts[].x"): how a mapping saved for
 * the applicant alone carries over to the Contacts list. */
function asListTarget(target: string): string {
  if (target === "note:contact") return "note:contacts[]";
  const m = /^(contact|crm:primarycontact|secure:primarycontact)\.(.+)$/.exec(target);
  if (!m) return target;
  return `${m[1] === "contact" ? "contacts[]" : m[1] === "crm:primarycontact" ? "crm:contacts[]" : "secure:contacts[]"}.${m[2]}`;
}

/** Effective target per field: the agent's choice, else (for the merged
 * Contacts list) what the applicant's or a contact's field was mapped to
 * before, else the default. "" means captured but not routed. */
export function effectiveTargets(saved: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of EZLYNX_FIELDS) {
    if (saved && f.id in saved) { out[f.id] = saved[f.id]!; continue; }
    const legacy = (f.legacy ?? []).find(id => saved && id in saved);
    out[f.id] = legacy ? asListTarget(saved![legacy]!) : f.defaultTarget;
  }
  return out;
}

/** A target as the explicit route for ONE record's field. Contacts rows:
 * person 0 is the applicant (the primary forms: contact.x,
 * crm:primarycontact.x, note:contact), person N the related contact in slot
 * N+1. Address rows number from 1 (row 0 = Address 1). */
function routeFor(target: string, row: number | null, personRow = false): string | undefined {
  if (!target) return undefined;
  if (personRow && row !== null) {
    const slot = row + 1;
    if (target === "note:contacts[]") return row === 0 ? "note:contact" : `note:contact${slot}`;
    const semantic = /^contacts\[\]\.([a-zA-Z]+)$/.exec(target);
    if (semantic) return row === 0 ? `contact.${semantic[1]}` : `contact${slot}.${semantic[1]}`;
    const crm = /^crm:contacts\[\]\.([a-z0-9_]+)$/.exec(target);
    if (crm) return row === 0 ? `crm:primarycontact.${crm[1]}` : `crm:contact${slot}.${crm[1]}`;
  }
  // a contact's own timeline only exists for a person row
  if (target === "note:contacts[]") return undefined;
  if (isNoteTarget(target)) return target;
  if (row !== null) {
    const addr = /^crm:addresses\[\]\.([a-z0-9_]+)$/.exec(target);
    if (addr) return `crm:address${row + 1}.${addr[1]}`;
  }
  return isRoutablePath(target) ? target : undefined;
}

/** Every person as {field suffix: display value}: the applicant first, then
 * each contact. */
function people(a: CapturedApplicant): Record<string, string>[] {
  const mobileOf = (phones: { type: string | null; number: string }[]) =>
    phones.find(p => /mobile|cell/i.test(p.type ?? ""))?.number ?? "";
  const applicant: Record<string, string> = {
    firstName: a.firstName, lastName: a.lastName, dateOfBirth: a.dateOfBirth ?? "",
    email: a.emails[0] ?? "", phone: a.phones[0]?.number ?? "", mobile: mobileOf(a.phones)
  };
  for (const [k, v] of Object.entries(a.details ?? {})) if (!(k in applicant)) applicant[k] = v;
  const contacts = a.coApplicants.map(c => {
    const row: Record<string, string> = {
      firstName: c.firstName, lastName: c.lastName, relationship: c.relationship,
      dateOfBirth: c.dateOfBirth ?? "", email: c.email ?? "", phone: c.phone ?? ""
    };
    for (const [k, v] of Object.entries(c.details ?? {})) if (!(k in row)) row[k] = v;
    return row;
  });
  return [applicant, ...contacts];
}

/** Account-level values (the applicant's record and primary address). */
function insuredValues(a: CapturedApplicant): Record<string, string> {
  const out: Record<string, string> = {
    "applicant.street": a.address?.street ?? "",
    "applicant.city": a.address?.city ?? "",
    "applicant.state": a.address?.state ?? "",
    "applicant.postalCode": a.address?.postalCode ?? ""
  };
  for (const [k, v] of Object.entries(a.details ?? {})) if (!(`applicant.${k}` in out)) out[`applicant.${k}`] = v;
  return out;
}

/** The insured and every person (as one Contacts table, the applicant on
 * row 1) as capture fields, each routed by its data-service mapping. */
export function ezlynxFields(a: CapturedApplicant, saved: Record<string, string> | undefined): CapturedAppField[] {
  const targets = effectiveTargets(saved);
  const out: CapturedAppField[] = [];
  const insured = insuredValues(a);
  for (const f of EZLYNX_FIELDS.filter(x => x.section === "Insured")) {
    const value = (insured[f.id] ?? "").trim();
    if (value) out.push({ label: f.label, value, section: "Insured", group: "", source: "dataservice", mapped: routeFor(targets[f.id]!, null) });
  }
  // secured fields never become capture fields, whatever they map to
  people(a).forEach((person, i) => {
    for (const f of EZLYNX_FIELDS.filter(x => x.section === "Contacts" && !x.secured)) {
      const value = (person[f.id.slice("person.".length)] ?? "").trim();
      if (value) out.push({ label: f.label, value, section: "Contacts", group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, i, true) });
    }
  });
  // additional phones / emails: rows of their own list
  const list = <T extends object>(section: "Phones" | "Emails", prefix: string, rows: T[]) => rows.slice(0, 40).forEach((r, i) => {
    for (const f of EZLYNX_FIELDS.filter(x => x.section === section)) {
      const value = String((r as Record<string, unknown>)[f.id.slice(prefix.length)] ?? "").trim();
      if (value) out.push({ label: f.label, value, section, group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, null) });
    }
  });
  list("Phones", "phone.", a.morePhones ?? []);
  list("Emails", "email.", a.moreEmails ?? []);
  (a.addresses ?? []).slice(0, 40).forEach((ad, i) => {
    for (const f of EZLYNX_FIELDS.filter(x => x.section === "Addresses")) {
      const value = (ad[f.id.slice("address.".length) as keyof typeof ad] ?? "").trim();
      if (value) out.push({ label: f.label, value, section: "Addresses", group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, i) });
    }
  });
  return out;
}

/** The secured values (SSN, DL#) for the pass-through channel, by their
 * mapped secured targets: person 0 (the applicant) to the primary contact,
 * person N to related contact slot N+1. Unmapped ones are dropped. */
export function ezlynxSecure(a: CapturedApplicant, saved: Record<string, string> | undefined): { path: string; value: string }[] {
  const targets = effectiveTargets(saved);
  const out: { path: string; value: string }[] = [];
  const add = (target: string | undefined, value: string | null | undefined, row: number) => {
    const v = (value ?? "").trim();
    if (!v || !target || !target.startsWith("secure:")) return;
    const path = target.replace("secure:contacts[]", row === 0 ? "secure:primarycontact" : `secure:contact${row + 1}`);
    if (!path.includes("[]") && (row === 0 || !path.startsWith("secure:primarycontact"))) out.push({ path, value: v });
  };
  [{ ssn: a.ssn, dlNumber: a.dlNumber }, ...a.coApplicants].forEach((p, i) => {
    add(targets["person.ssn"], p.ssn, i);
    add(targets["person.dlNumber"], p.dlNumber, i);
  });
  return out;
}
/** The applicant with its SSNs removed: what may be stored with the capture. */
export function withoutSsn<T extends CapturedApplicant>(a: T): T {
  return { ...a, ssn: null, coApplicants: a.coApplicants.map(c => ({ ...c, ssn: null })) };
}

/** The rating run's quotes as held quotes (all selected, Estimated - EZLynx
 * only returns estimates), carriers pre-matched from remembered aliases. */
export function quotesFromRun(run: CapturedRun, aliases: Record<number, string>): HeldQuote[] {
  return run.blocks.flatMap(block => block.quotes.map<HeldQuote>(q => ({
    key: q.key,
    provider: "EZLynx",
    source: "EZLynx",
    lob: block.lob,
    carrierName: q.carrierName,
    carrierRef: String(q.carrierEzlynxId),
    carrierId: aliases[q.carrierEzlynxId] ?? null,
    kind: q.kind,
    quoteNumber: q.quoteNumber,
    premium: q.premium,
    termMonths: q.termMonths,
    premiumStatus: "estimated",
    coverageSummary: q.coverageSummary,
    coverageLines: q.coverageLines,
    link: `https://app.ezlynx.com/web/account/${run.applicant.ezlynxApplicantId}/rating/quote-results/${run.openApplicationId}/${block.applicantQuoteId}`,
    selected: true
  })));
}

/** A source's new quotes REPLACE its earlier ones (a newer EZLynx rating
 * run supersedes the old run) while keeping the agent's choices on quotes
 * that carry over (selected, carrier, Firm/Estimated). Other sources' held
 * quotes stay. */
export function mergeHeldQuotes(existing: HeldQuote[] | undefined, incoming: HeldQuote[]): HeldQuote[] {
  const prior = new Map((existing ?? []).map(q => [q.key, q]));
  const merged = incoming.map(q => {
    const p = prior.get(q.key);
    return p ? { ...q, selected: p.selected, carrierId: p.carrierId ?? q.carrierId, premiumStatus: p.premiumStatus } : q;
  });
  const sources = new Set(incoming.map(q => q.source));
  return [...(existing ?? []).filter(q => !sources.has(q.source)), ...merged];
}

/** Canonical on-screen labels the data service covers with a MAPPED target
 * (the page peek treats those screen fields as handled). */
export function coveredPageLabels(saved: Record<string, string> | undefined): string[] {
  const targets = effectiveTargets(saved);
  return EZLYNX_FIELDS.filter(f => targets[f.id]).flatMap(f => f.pageLabels ?? []);
}
