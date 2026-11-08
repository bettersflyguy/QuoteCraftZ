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
  /** "Applicant" fields are one record; "Co-applicants" repeat per person. */
  section: "Applicant" | "Co-applicants";
  defaultTarget: string;
  /** How the source's own screens label it (canonical), so the page peek
   * knows which on-screen fields the data service already covers. */
  pageLabels?: string[];
}

/** EVERYTHING the EZLynx data service returns for a person (SSN never; the
 * license NUMBER goes to the secured license columns and is not listed),
 * so Settings shows exactly what goes to CRM. Defaults reproduce what the
 * dedicated importer always wrote; the rest start "not mapped". */
export const EZLYNX_FIELDS: DataServiceField[] = [
  { id: "applicant.firstName", label: "First name", section: "Applicant", defaultTarget: "contact.firstName", pageLabels: ["first name"] },
  { id: "applicant.middleInitial", label: "Middle initial", section: "Applicant", defaultTarget: "", pageLabels: ["middle initial"] },
  { id: "applicant.lastName", label: "Last name", section: "Applicant", defaultTarget: "contact.lastName", pageLabels: ["last name"] },
  { id: "applicant.nickName", label: "Nickname", section: "Applicant", defaultTarget: "", pageLabels: ["nickname"] },
  { id: "applicant.maidenName", label: "Maiden name", section: "Applicant", defaultTarget: "", pageLabels: ["maiden name"] },
  { id: "applicant.dateOfBirth", label: "Date of birth", section: "Applicant", defaultTarget: "contact.dateOfBirth", pageLabels: ["dob", "date of birth"] },
  { id: "applicant.gender", label: "Gender", section: "Applicant", defaultTarget: "contact.gender", pageLabels: ["gender"] },
  { id: "applicant.maritalStatus", label: "Marital status", section: "Applicant", defaultTarget: "contact.maritalStatus", pageLabels: ["marital status"] },
  { id: "applicant.education", label: "Education", section: "Applicant", defaultTarget: "", pageLabels: ["education"] },
  { id: "applicant.industry", label: "Industry", section: "Applicant", defaultTarget: "", pageLabels: ["industry"] },
  { id: "applicant.occupation", label: "Occupation", section: "Applicant", defaultTarget: "", pageLabels: ["occupation"] },
  { id: "applicant.yearsAtOccupation", label: "Years at occupation", section: "Applicant", defaultTarget: "", pageLabels: ["years"] },
  { id: "applicant.priorEmployerInYears", label: "Prior employer (years)", section: "Applicant", defaultTarget: "", pageLabels: ["prior employer in years"] },
  { id: "applicant.driversLicenseStatus", label: "License status", section: "Applicant", defaultTarget: "", pageLabels: ["dl status"] },
  { id: "applicant.driversLicenseState", label: "License state", section: "Applicant", defaultTarget: "", pageLabels: ["dl state"] },
  { id: "applicant.applicantType", label: "Applicant type", section: "Applicant", defaultTarget: "", pageLabels: ["applicant type"] },
  { id: "applicant.customerSince", label: "Customer since", section: "Applicant", defaultTarget: "", pageLabels: ["customer since"] },
  { id: "applicant.accountName", label: "Account name", section: "Applicant", defaultTarget: "", pageLabels: ["account name"] },
  { id: "applicant.leadSource", label: "Lead source", section: "Applicant", defaultTarget: "", pageLabels: ["lead source"] },
  { id: "applicant.assignedProducer", label: "Assigned producer", section: "Applicant", defaultTarget: "", pageLabels: ["assigned producer"] },
  { id: "applicant.isVip", label: "VIP", section: "Applicant", defaultTarget: "", pageLabels: ["vip"] },
  { id: "applicant.isDeceased", label: "Deceased", section: "Applicant", defaultTarget: "", pageLabels: ["deceased"] },
  { id: "applicant.ratingState", label: "Rating state", section: "Applicant", defaultTarget: "", pageLabels: ["address state"] },
  { id: "applicant.isCommercial", label: "Commercial applicant", section: "Applicant", defaultTarget: "" },
  { id: "applicant.email", label: "Email", section: "Applicant", defaultTarget: "contact.email", pageLabels: ["email", "email address"] },
  { id: "applicant.phone", label: "Phone", section: "Applicant", defaultTarget: "contact.phone", pageLabels: ["phone number", "phone"] },
  { id: "applicant.mobile", label: "Mobile phone", section: "Applicant", defaultTarget: "" },
  { id: "applicant.street", label: "Street address", section: "Applicant", defaultTarget: "address.street1", pageLabels: ["address"] },
  { id: "applicant.unit", label: "Unit", section: "Applicant", defaultTarget: "", pageLabels: ["unit"] },
  { id: "applicant.address2", label: "Address line 2", section: "Applicant", defaultTarget: "address.street2", pageLabels: ["address line 2"] },
  { id: "applicant.city", label: "City", section: "Applicant", defaultTarget: "address.city", pageLabels: ["city"] },
  { id: "applicant.state", label: "State", section: "Applicant", defaultTarget: "address.state", pageLabels: ["state"] },
  { id: "applicant.county", label: "County", section: "Applicant", defaultTarget: "", pageLabels: ["county"] },
  { id: "applicant.postalCode", label: "ZIP code", section: "Applicant", defaultTarget: "address.postalCode", pageLabels: ["postal code", "zip code"] },
  { id: "applicant.postalCodeSuffix", label: "ZIP suffix", section: "Applicant", defaultTarget: "", pageLabels: ["postal code suffix"] },
  { id: "applicant.yearsAtAddress", label: "Years at address", section: "Applicant", defaultTarget: "", pageLabels: ["years at address"] },
  { id: "applicant.monthsAtAddress", label: "Months at address", section: "Applicant", defaultTarget: "", pageLabels: ["months at address"] },
  { id: "coApplicant.firstName", label: "First name", section: "Co-applicants", defaultTarget: "contacts[].firstName" },
  { id: "coApplicant.middleInitial", label: "Middle initial", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.lastName", label: "Last name", section: "Co-applicants", defaultTarget: "contacts[].lastName" },
  { id: "coApplicant.relationship", label: "Relationship", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.dateOfBirth", label: "Date of birth", section: "Co-applicants", defaultTarget: "contacts[].dateOfBirth" },
  { id: "coApplicant.gender", label: "Gender", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.maritalStatus", label: "Marital status", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.education", label: "Education", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.industry", label: "Industry", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.occupation", label: "Occupation", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.driversLicenseStatus", label: "License status", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.driversLicenseState", label: "License state", section: "Co-applicants", defaultTarget: "" },
  { id: "coApplicant.email", label: "Email", section: "Co-applicants", defaultTarget: "contacts[].email" },
  { id: "coApplicant.phone", label: "Phone", section: "Co-applicants", defaultTarget: "contacts[].phone" }
];

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

/** The applicant (and co-applicants, as a table) as capture fields, each
 * routed by its data-service mapping. */
export function ezlynxFields(a: CapturedApplicant, saved: Record<string, string> | undefined): CapturedAppField[] {
  const targets = effectiveTargets(saved);
  const out: CapturedAppField[] = [];
  const values = applicantValues(a);
  for (const f of EZLYNX_FIELDS.filter(x => x.section === "Applicant")) {
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
    for (const f of EZLYNX_FIELDS.filter(x => x.section === "Co-applicants")) {
      const value = (row[f.id] ?? "").trim();
      if (!value) continue;
      out.push({ label: f.label, value, section: "Co-applicants", group: `Row ${i + 1}`, source: "dataservice", mapped: routeFor(targets[f.id]!, i) });
    }
  });
  return out;
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
