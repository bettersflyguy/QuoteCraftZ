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
  /** "Applicant" fields are one record; "Contacts" repeat per contact
   * (Add contact, co-applicant or not); "Phones" / "Emails" per additional
   * phone / email; "Addresses" per address (primary first). */
  section: "Applicant" | "Contacts" | "Phones" | "Emails" | "Addresses";
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

/** EVERYTHING the EZLynx data service returns for a person (SSN never; the
 * license NUMBER goes to the secured license columns and is not listed),
 * so Settings shows exactly what goes to CRM. Defaults reproduce what the
 * dedicated importer always wrote; the rest start "not mapped". */
export const EZLYNX_FIELDS: DataServiceField[] = [
  { id: "applicant.firstName", label: "First name", section: "Applicant", defaultTarget: "contact.firstName", pageLabels: APP("first name") },
  { id: "applicant.middleInitial", label: "Middle initial", section: "Applicant", defaultTarget: "crm:primarycontact.middlename", pageLabels: APP("middle initial") },
  { id: "applicant.lastName", label: "Last name", section: "Applicant", defaultTarget: "contact.lastName", pageLabels: APP("last name") },
  { id: "applicant.nickName", label: "Nickname", section: "Applicant", defaultTarget: "crm:primarycontact.nickname", pageLabels: APP("nickname") },
  { id: "applicant.maidenName", label: "Maiden name", section: "Applicant", defaultTarget: "", pageLabels: APP("maiden name") },
  { id: "applicant.dateOfBirth", label: "Date of birth", section: "Applicant", defaultTarget: "contact.dateOfBirth", pageLabels: APP("dob", "date of birth") },
  { id: "applicant.ssn", label: "SSN", section: "Applicant", defaultTarget: "secure:primarycontact.iacrm_socialsecuritynumber", pageLabels: APP("ssn"), secured: true },
  { id: "applicant.dlNumber", label: "DL#", section: "Applicant", defaultTarget: "secure:primarycontact.iacrm_driverslicense", pageLabels: APP("dl"), secured: true },
  { id: "applicant.gender", label: "Gender", section: "Applicant", defaultTarget: "crm:primarycontact.gendercode", pageLabels: APP("gender") },
  { id: "applicant.maritalStatus", label: "Marital status", section: "Applicant", defaultTarget: "crm:primarycontact.familystatuscode", pageLabels: APP("marital status") },
  { id: "applicant.education", label: "Education", section: "Applicant", defaultTarget: "crm:primarycontact.educationcode", pageLabels: APP("education") },
  { id: "applicant.industry", label: "Industry", section: "Applicant", defaultTarget: "crm:primarycontact.iacrm_employmentindustry", pageLabels: APP("industry") },
  { id: "applicant.occupation", label: "Occupation", section: "Applicant", defaultTarget: "crm:primarycontact.iacrm_employmentoccupation", pageLabels: APP("occupation") },
  { id: "applicant.yearsAtOccupation", label: "Years at occupation", section: "Applicant", defaultTarget: "crm:primarycontact.iacrm_yearsemployed", pageLabels: APP("years") },
  { id: "applicant.priorEmployerInYears", label: "Prior employer (years)", section: "Applicant", defaultTarget: "crm:primarycontact.iacrm_prioryearsemployed", pageLabels: APP("prior employer in years") },
  { id: "applicant.driversLicenseStatus", label: "License status", section: "Applicant", defaultTarget: "", pageLabels: APP("dl status") },
  { id: "applicant.driversLicenseState", label: "License state", section: "Applicant", defaultTarget: "crm:primarycontact.iacrm_dlstate", pageLabels: APP("dl state") },
  { id: "applicant.applicantType", label: "Applicant type", section: "Applicant", defaultTarget: "", pageLabels: APP("applicant type") },
  { id: "applicant.customerSince", label: "Customer since", section: "Applicant", defaultTarget: "", pageLabels: APP("customer since") },
  { id: "applicant.accountName", label: "Account name", section: "Applicant", defaultTarget: "", pageLabels: APP("account name") },
  { id: "applicant.leadSource", label: "Lead source", section: "Applicant", defaultTarget: "", pageLabels: APP("lead source") },
  { id: "applicant.assignedProducer", label: "Assigned producer", section: "Applicant", defaultTarget: "", pageLabels: APP("assigned producer") },
  { id: "applicant.csr", label: "CSR", section: "Applicant", defaultTarget: "", pageLabels: APP("csr") },
  { id: "applicant.preferredContactMethod", label: "Preferred contact method", section: "Applicant", defaultTarget: "crm:primarycontact.preferredcontactmethodcode", pageLabels: APP("preferred contact method", "contact method") },
  { id: "applicant.isVip", label: "VIP", section: "Applicant", defaultTarget: "", pageLabels: APP("vip") },
  { id: "applicant.isDeceased", label: "Deceased", section: "Applicant", defaultTarget: "", pageLabels: APP("deceased") },
  { id: "applicant.ratingState", label: "Rating state", section: "Applicant", defaultTarget: "", pageLabels: APP("rating state") },
  { id: "applicant.isCommercial", label: "Commercial applicant", section: "Applicant", defaultTarget: "" },
  // the PRIMARY (first) email and phone feed the insured; every other one
  // is a row of the Phones / Emails lists below
  { id: "applicant.email", label: "Primary email", section: "Applicant", defaultTarget: "contact.email", pageLabels: APP("email", "email address", "email type") },
  { id: "applicant.phone", label: "Primary phone", section: "Applicant", defaultTarget: "contact.phone", pageLabels: APP("phone number", "phone", "phone type", "extension") },
  { id: "applicant.mobile", label: "Mobile phone", section: "Applicant", defaultTarget: "crm:primarycontact.mobilephone" },
  { id: "applicant.street", label: "Street address", section: "Applicant", defaultTarget: "address.street1", pageLabels: PRIMARY_ADDRESS("address") },
  { id: "applicant.unit", label: "Unit", section: "Applicant", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("unit") },
  { id: "applicant.address2", label: "Address line 2", section: "Applicant", defaultTarget: "address.street2", pageLabels: PRIMARY_ADDRESS("address line 2") },
  { id: "applicant.city", label: "City", section: "Applicant", defaultTarget: "address.city", pageLabels: PRIMARY_ADDRESS("city") },
  { id: "applicant.state", label: "State", section: "Applicant", defaultTarget: "address.state", pageLabels: PRIMARY_ADDRESS("state") },
  { id: "applicant.county", label: "County", section: "Applicant", defaultTarget: "crm:account.address1_county", pageLabels: PRIMARY_ADDRESS("county") },
  { id: "applicant.postalCode", label: "ZIP code", section: "Applicant", defaultTarget: "address.postalCode", pageLabels: PRIMARY_ADDRESS("postal code", "zip code") },
  { id: "applicant.postalCodeSuffix", label: "ZIP suffix", section: "Applicant", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("postal code suffix") },
  { id: "applicant.yearsAtAddress", label: "Years at address", section: "Applicant", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("years at address") },
  { id: "applicant.monthsAtAddress", label: "Months at address", section: "Applicant", defaultTarget: "", pageLabels: PRIMARY_ADDRESS("months at address") },
  // every contact added with "Add contact" (co-applicant or not): one row
  // each, one related contact in CRM each
  { id: "coApplicant.firstName", label: "First name", section: "Contacts", defaultTarget: "contacts[].firstName", pageLabels: CONTACT("first name") },
  { id: "coApplicant.middleInitial", label: "Middle initial", section: "Contacts", defaultTarget: "crm:contacts[].middlename", pageLabels: CONTACT("middle initial") },
  { id: "coApplicant.lastName", label: "Last name", section: "Contacts", defaultTarget: "contacts[].lastName", pageLabels: CONTACT("last name") },
  { id: "coApplicant.nickName", label: "Nickname", section: "Contacts", defaultTarget: "crm:contacts[].nickname", pageLabels: CONTACT("nickname") },
  { id: "coApplicant.maidenName", label: "Maiden name", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("maiden name") },
  { id: "coApplicant.relationship", label: "Relationship", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("relationship") },
  { id: "coApplicant.isCoApplicant", label: "Co-applicant", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("make this contact co applicant") },
  { id: "coApplicant.isDriver", label: "Driver", section: "Contacts", defaultTarget: "" },
  { id: "coApplicant.dateOfBirth", label: "Date of birth", section: "Contacts", defaultTarget: "contacts[].dateOfBirth", pageLabels: CONTACT("dob", "date of birth") },
  { id: "coApplicant.ssn", label: "SSN", section: "Contacts", defaultTarget: "secure:contacts[].iacrm_socialsecuritynumber", pageLabels: CONTACT("ssn"), secured: true },
  { id: "coApplicant.dlNumber", label: "DL#", section: "Contacts", defaultTarget: "secure:contacts[].iacrm_driverslicense", pageLabels: CONTACT("dl"), secured: true },
  { id: "coApplicant.gender", label: "Gender", section: "Contacts", defaultTarget: "crm:contacts[].gendercode", pageLabels: CONTACT("gender") },
  { id: "coApplicant.maritalStatus", label: "Marital status", section: "Contacts", defaultTarget: "crm:contacts[].familystatuscode", pageLabels: CONTACT("marital status") },
  { id: "coApplicant.education", label: "Education", section: "Contacts", defaultTarget: "crm:contacts[].educationcode", pageLabels: CONTACT("education") },
  { id: "coApplicant.industry", label: "Industry", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_employmentindustry", pageLabels: CONTACT("industry") },
  { id: "coApplicant.occupation", label: "Occupation", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_employmentoccupation", pageLabels: CONTACT("occupation") },
  { id: "coApplicant.yearsAtOccupation", label: "Years at occupation", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_yearsemployed", pageLabels: CONTACT("years") },
  { id: "coApplicant.priorEmployerInYears", label: "Prior employer (years)", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_prioryearsemployed", pageLabels: CONTACT("prior employer in years") },
  { id: "coApplicant.driversLicenseStatus", label: "License status", section: "Contacts", defaultTarget: "", pageLabels: CONTACT("dl status") },
  { id: "coApplicant.driversLicenseState", label: "License state", section: "Contacts", defaultTarget: "crm:contacts[].iacrm_dlstate", pageLabels: CONTACT("dl state") },
  { id: "coApplicant.preferredContactMethod", label: "Preferred contact method", section: "Contacts", defaultTarget: "crm:contacts[].preferredcontactmethodcode", pageLabels: CONTACT("contact method") },
  // a contact's FIRST email / phone fill their CRM contact; the others are
  // rows of the Phones / Emails lists, with the contact's name
  { id: "coApplicant.email", label: "Primary email", section: "Contacts", defaultTarget: "contacts[].email", pageLabels: CONTACT("email", "email address", "email type") },
  { id: "coApplicant.phone", label: "Primary phone", section: "Contacts", defaultTarget: "contacts[].phone", pageLabels: CONTACT("phone number", "phone", "phone type", "extension") },
  // a contact's own address (EZLynx keeps one per contact): their CRM Address 1
  { id: "coApplicant.street", label: "Street address", section: "Contacts", defaultTarget: "crm:contacts[].address1_line1", pageLabels: CONTACT("address") },
  { id: "coApplicant.address2", label: "Address line 2", section: "Contacts", defaultTarget: "crm:contacts[].address1_line2", pageLabels: CONTACT("address line 2") },
  { id: "coApplicant.unit", label: "Unit", section: "Contacts", defaultTarget: "crm:contacts[].address1_line3", pageLabels: CONTACT("unit") },
  { id: "coApplicant.city", label: "City", section: "Contacts", defaultTarget: "crm:contacts[].address1_city", pageLabels: CONTACT("city") },
  { id: "coApplicant.state", label: "State", section: "Contacts", defaultTarget: "crm:contacts[].address1_stateorprovince", pageLabels: CONTACT("state") },
  { id: "coApplicant.county", label: "County", section: "Contacts", defaultTarget: "crm:contacts[].address1_county", pageLabels: CONTACT("county") },
  { id: "coApplicant.postalCode", label: "ZIP code", section: "Contacts", defaultTarget: "crm:contacts[].address1_postalcode", pageLabels: CONTACT("postal code") },
  // every phone / email after a person's primary (the applicant's and each
  // contact's): one row each, with whose it is, to the note the agent picks
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

/** Effective target per field: the agent's choice, else the default.
 * "" means captured but not routed to a CRM field. */
export function effectiveTargets(saved: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of EZLYNX_FIELDS) out[f.id] = saved && f.id in saved ? saved[f.id]! : f.defaultTarget;
  return out;
}

/** A target as the explicit route for ONE record's field: single paths as
 * they are; array targets fan to the person's slot (related contacts start
 * at contact2, contact1 being the primary insured). */
function routeFor(target: string, row: number | null): string | undefined {
  if (!target) return undefined;
  if (isNoteTarget(target)) return target;
  if (row !== null) {
    const semantic = /^contacts\[\]\.([a-zA-Z]+)$/.exec(target);
    if (semantic) return `contact${row + 2}.${semantic[1]}`;
    const crm = /^crm:contacts\[\]\.([a-z0-9_]+)$/.exec(target);
    if (crm) return `crm:contact${row + 2}.${crm[1]}`;
    // addresses number from 1 (row 0 = the primary = Address 1)
    const addr = /^crm:addresses\[\]\.([a-z0-9_]+)$/.exec(target);
    if (addr) return `crm:address${row + 1}.${addr[1]}`;
  }
  return isRoutablePath(target) ? target : undefined;
}

/** Field id -> display value for the applicant: identity fields directly,
 * everything else from the source's details ("applicant.gender" ->
 * details.gender). */
function applicantValues(a: CapturedApplicant): Record<string, string> {
  const mobile = a.phones.find(p => /mobile|cell/i.test(p.type ?? ""))?.number ?? "";
  const out: Record<string, string> = {
    "applicant.firstName": a.firstName,
    "applicant.lastName": a.lastName,
    "applicant.dateOfBirth": a.dateOfBirth ?? "",
    "applicant.email": a.emails[0] ?? "",
    "applicant.phone": a.phones[0]?.number ?? "",
    "applicant.mobile": mobile,
    "applicant.street": a.address?.street ?? "",
    "applicant.city": a.address?.city ?? "",
    "applicant.state": a.address?.state ?? "",
    "applicant.postalCode": a.address?.postalCode ?? ""
  };
  for (const [k, v] of Object.entries(a.details ?? {})) if (!(`applicant.${k}` in out)) out[`applicant.${k}`] = v;
  return out;
}

/** The applicant (and every contact, as a table) as capture fields, each
 * routed by its data-service mapping. */
export function ezlynxFields(a: CapturedApplicant, saved: Record<string, string> | undefined): CapturedAppField[] {
  const targets = effectiveTargets(saved);
  const out: CapturedAppField[] = [];
  const values = applicantValues(a);
  // secured fields never become capture fields, whatever they map to
  for (const f of EZLYNX_FIELDS.filter(x => x.section === "Applicant" && !x.secured)) {
    const value = (values[f.id] ?? "").trim();
    if (!value) continue;
    out.push({ label: f.label, value, section: "Applicant", group: "", source: "dataservice", mapped: routeFor(targets[f.id]!, null) });
  }
  a.coApplicants.forEach((c, i) => {
    const row: Record<string, string> = {
      "coApplicant.firstName": c.firstName,
      "coApplicant.lastName": c.lastName,
      "coApplicant.relationship": c.relationship,
      "coApplicant.dateOfBirth": c.dateOfBirth ?? "",
      "coApplicant.email": c.email ?? "",
      "coApplicant.phone": c.phone ?? ""
    };
    for (const [k, v] of Object.entries(c.details ?? {})) if (!(`coApplicant.${k}` in row)) row[`coApplicant.${k}`] = v;
    for (const f of EZLYNX_FIELDS.filter(x => x.section === "Contacts" && !x.secured)) {
      const value = (row[f.id] ?? "").trim();
      if (!value) continue;
      out.push({ label: f.label, value, section: "Contacts", group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, i) });
    }
  });
  // additional phones / emails: rows of their own list (never a CRM slot
  // by default - the primary already fills the insured)
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
      if (!value) continue;
      out.push({ label: f.label, value, section: "Addresses", group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, i) });
    }
  });
  return out;
}

/** The secured values (SSN, DL#) for the pass-through channel, by their
 * mapped secured targets: the applicant's concrete, each co-applicant's
 * row slot (contact2 = first co-applicant). Unmapped ones are dropped. */
export function ezlynxSecure(a: CapturedApplicant, saved: Record<string, string> | undefined): { path: string; value: string }[] {
  const targets = effectiveTargets(saved);
  const out: { path: string; value: string }[] = [];
  const add = (target: string | undefined, value: string | null | undefined, row: number | null) => {
    const v = (value ?? "").trim();
    if (!v || !target || !target.startsWith("secure:")) return;
    const path = row === null ? target : target.replace("secure:contacts[]", `secure:contact${row + 2}`);
    if (!path.includes("[]")) out.push({ path, value: v });
  };
  add(targets["applicant.ssn"], a.ssn, null);
  add(targets["applicant.dlNumber"], a.dlNumber, null);
  a.coApplicants.forEach((c, i) => {
    add(targets["coApplicant.ssn"], c.ssn, i);
    add(targets["coApplicant.dlNumber"], c.dlNumber, i);
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
