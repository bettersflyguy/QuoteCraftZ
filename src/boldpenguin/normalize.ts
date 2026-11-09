/** Alias-scored normalizer for Bold Penguin application fields.
 * TypeScript port of the Application Assistant concept's lib/normalizer.js;
 * the rule list is the field inventory from live Bold Penguin applications
 * (docs/bold-penguin-field-inventory.md). */
import type { NormalizedApplication } from "./types";
import { isRoutablePath } from "@/portal/fieldMaps";

const rules: [string, string[]][] = [
  ["business.legalName", ["legal business name", "business legal name", "named insured", "company name", "business name"]],
  ["business.dba", ["doing business as", "dba", "trade name"]],
  ["business.entityType", ["entity type", "business type", "legal entity"]],
  ["business.fein", ["federal employer identification number", "federal tax id", "tax id", "fein", "ein"]],
  ["business.website", ["business website", "website", "web address"]],
  ["business.description", ["business description", "description of operations", "operations description", "nature of business"]],
  ["business.industry", ["what kind of work do you do", "industry description", "business classification"]],
  ["business.foundingYear", ["founding year of business", "year business started", "year established"]],
  ["business.yearsInBusiness", ["years in business", "years operating"]],
  ["business.annualRevenue", ["estimated total gross revenue", "annual gross sales", "annual sales", "annual revenue", "gross receipts"]],
  ["business.employeeCount", ["number of employees", "employee count", "employees"]],
  ["employment.fullTimeEmployees", ["full time employees"]],
  ["employment.partTimeEmployees", ["part time employees"]],
  ["payroll.owners", ["business owners only", "owner wages"]],
  ["payroll.employees", ["full time part time and temporary employees", "employee wages"]],
  ["payroll.subcontractors", ["subcontractors"]],
  ["contact.firstName", ["policyholders first name", "contact first name", "first name"]],
  ["contact.lastName", ["policyholders last name", "contact last name", "last name"]],
  ["contact.fullName", ["primary contact", "contact name", "applicant name", "full name", "name insured", "named insured", "insured name"]],
  ["contact.email", ["email address", "email"]],
  ["contact.phone", ["phone number", "telephone", "phone"]],
  ["contact.dateOfBirth", ["date of birth", "birth date", "birthdate", "dob"]],
  ["contact.gender", ["gender", "sex"]],
  ["contact.maritalStatus", ["marital status"]],
  // bare "address" is safe as the LAST alias here: the contact rules run
  // first, so "Email Address" is claimed before this rule can see it
  ["address.street1", ["business address", "street address", "address line 1", "address 1", "street", "mailing address", "garaging address", "home address", "residence address", "address"]],
  ["address.street2", ["address line 2", "address 2", "suite", "unit", "apt", "apartment", "apt #"]],
  ["address.city", ["business city", "city"]],
  ["address.state", ["business state", "state", "province"]],
  ["address.postalCode", ["postal code", "zip code", "zipcode", "zip"]],
  ["coverage.effectiveDate", ["desired effective date", "policy effective date", "effective date", "coverage start date"]],
  ["coverage.expirationDate", ["policy expiration date", "expiration date"]],
  ["coverage.currentCarrier", ["current insurance carrier", "current carrier", "prior carrier"]],
  ["coverage.currentPremium", ["current annual premium", "current premium", "annual premium"]],
  ["coverage.lines", ["coverage types", "lines of business", "products selected", "coverages requested"]],
  ["coverage.autoLiabilityLimit", ["bodily injury property damage for this commercial auto policy", "commercial auto liability limit"]],
  ["policy.number", ["policy number", "policy no", "policy id"]],
  ["policy.premium", ["total policy premium", "6 month total premium", "12 month total premium", "total premium", "policy premium"]],
  ["history.lossesLastFiveYears", ["loss or claim in the last 5 years"]],
  ["history.coverageIssuesLastThreeYears", ["lapse of coverage been declined canceled or nonrenewed in the last 3 years"]],
  ["building.occupancyType", ["what type of building do you operate your business out of", "building occupancy type"]],
  ["building.sprinklered", ["does the building contain an automatic sprinkler system"]],
  ["building.floors", ["how many floors are in this building"]],
  ["building.occupiedSquareFeet", ["how many square feet does your business occupy"]],
  ["building.totalSquareFeet", ["total square footage of the building"]],
  ["building.yearBuilt", ["year the building your company occupies finished construction", "year built"]],
  ["building.constructionType", ["describes the construction of your building", "construction type"]],
  ["building.businessPersonalPropertyValue", ["total value of your business personal property"]],
  ["application.id", ["application id", "submission id", "quote id"]],
  ["application.status", ["application status", "submission status", "status"]]
];

/** Labels that must never claim a rule even when an alias scores: a
 * "Finance or Leasing Company Name" is a lienholder, not the insured's
 * business name. */
const excludes: Record<string, RegExp> = {
  "business.legalName": /financ|leas|lien|mortgag|\bbank\b|lender/,
  "business.dba": /financ|leas|lien|mortgag|\bbank\b|lender/
};

export function clean(value: unknown): string {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

export function canonical(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function score(label: string, alias: string): number {
  if (label === alias) return 100;
  if (label.startsWith(alias + " ") || label.endsWith(" " + alias)) return 85;
  if (label.includes(alias)) return 70;
  const wanted = alias.split(" ");
  const actual = new Set(label.split(" "));
  const matches = wanted.filter(token => actual.has(token)).length;
  return matches === wanted.length ? 55 : 0;
}

function setPath(target: NormalizedApplication, path: string, value: string): void {
  const [head, tail] = path.split(".") as [string, string];
  (target[head] ??= {})[tail] = value;
}

export interface NormalizableField {
  label: string;
  value: string;
  name?: string;
  section?: string;
  /** "Row N" for a data-grid row (Drivers, Vehicles lists): array records,
   * never alias-guessed into the primary insured's identity. */
  group?: string;
  /** Explicit rule path (agent-taught capture) - routed directly, never
   * alias-scored. Only known MAP_PATHS paths are honored. */
  mapped?: string;
}

/** A data-grid row field (group "Row N"). */
export const isGridRow = (field: { group?: string }): boolean => /^Row \d+$/.test(field.group ?? "");

/** Well-known CRM columns that ALSO feed the semantic pipeline - identity
 * review, duplicate gate, contact dedupe, policy draft and portal fill all
 * read semantic paths, so a taught "Insured (account): Email" must drive
 * them exactly like the semantic "Email" target would. */
export const CRM_BRIDGE: Record<string, string> = {
  "crm:account.iacrm_insuredfirstname": "contact.firstName",
  "crm:account.iacrm_insuredlastname": "contact.lastName",
  "crm:account.emailaddress1": "contact.email",
  "crm:account.telephone1": "contact.phone",
  "crm:account.address1_line1": "address.street1",
  "crm:account.address1_line2": "address.street2",
  "crm:account.address1_city": "address.city",
  "crm:account.address1_stateorprovince": "address.state",
  "crm:account.address1_postalcode": "address.postalCode",
  "crm:primarycontact.firstname": "contact.firstName",
  "crm:primarycontact.lastname": "contact.lastName",
  "crm:primarycontact.emailaddress1": "contact.email",
  "crm:primarycontact.mobilephone": "contact.phone",
  "crm:primarycontact.telephone1": "contact.phone",
  "crm:primarycontact.birthdate": "contact.dateOfBirth",
  "crm:primarycontact.gendercode": "contact.gender",
  "crm:primarycontact.familystatuscode": "contact.maritalStatus",
  "crm:address1.line1": "address.street1",
  "crm:address1.line2": "address.street2",
  "crm:address1.city": "address.city",
  "crm:address1.stateorprovince": "address.state",
  "crm:address1.postalcode": "address.postalCode",
  "crm:policy1.iacrm_policynumber": "policy.number",
  "crm:policy1.iacrm_premium": "policy.premium",
  "crm:policy1.iacrm_effectivedate": "coverage.effectiveDate",
  "crm:policy1.iacrm_expirationdate": "coverage.expirationDate"
};
const CONTACT_COLUMN_BRIDGE: Record<string, string> = {
  firstname: "firstName", lastname: "lastName", emailaddress1: "email",
  mobilephone: "phone", telephone1: "phone", birthdate: "dateOfBirth"
};

function bridgeOf(path: string): string | null {
  if (CRM_BRIDGE[path]) return CRM_BRIDGE[path]!;
  const m = /^crm:contact(\d+)\.([a-z0-9_]+)$/.exec(path);
  const key = m ? CONTACT_COLUMN_BRIDGE[m[2]!] : undefined;
  return m && key ? `contact${m[1]}.${key}` : null;
}

/** Field indices carrying a valid explicit path, with the paths they set
 * (first capture of a path wins), plus the semantic paths well-known CRM
 * columns bridge into. These are spoken for: alias scoring must never claim
 * the indices, and alias rules must never overwrite their paths. A semantic
 * explicit teaching beats a bridged one for the same path. */
function explicitRouting(fields: NormalizableField[]): {
  indices: Set<number>; byIndex: Map<number, string>; paths: Set<string>; bridged: Map<string, string>;
} {
  const indices = new Set<number>();
  const byIndex = new Map<number, string>();
  const paths = new Set<string>();
  fields.forEach((field, index) => {
    const path = field.mapped;
    // timeline-note teachings are spoken for (never alias-guessed into a
    // CRM field) but route nowhere: they become the note
    if (path && /^note(:[a-z]+\d*)?$/.test(path)) { indices.add(index); return; }
    if (!path || !isRoutablePath(path) || !clean(field.value)) return;
    indices.add(index);
    if (paths.has(path)) return;
    paths.add(path);
    byIndex.set(index, path);
  });
  const bridged = new Map<string, string>();
  for (const [index, path] of byIndex) {
    const target = bridgeOf(path);
    if (target && !paths.has(target) && !bridged.has(target)) bridged.set(target, clean(fields[index]!.value));
  }
  for (const target of bridged.keys()) paths.add(target);
  return { indices, byIndex, paths, bridged };
}

/** Which field indices the rules under the given path prefixes would claim -
 * used to decide what is "structurally mapped" (written to CRM columns)
 * versus supplemental data that belongs in an activity note. */
export function claimedIndices(fields: NormalizableField[], pathPrefixes: string[]): Set<number> {
  const explicit = explicitRouting(fields);
  const claimed = new Set<number>();
  for (const index of explicit.indices) {
    const path = fields[index]!.mapped!;
    if (pathPrefixes.some(p => path.startsWith(p))) claimed.add(index);
  }
  for (const [path, aliases] of rules) {
    if (!pathPrefixes.some(p => path.startsWith(p))) continue;
    let best: { index: number; score: number } | null = null;
    fields.forEach((field, index) => {
      if (claimed.has(index) || explicit.indices.has(index) || isGridRow(field) || !clean(field.value)) return;
      const label = canonical([field.label, field.name, field.section].filter(Boolean).join(" "));
      if (excludes[path]?.test(label)) return;
      const fieldScore = Math.max(...aliases.map(alias => score(label, canonical(alias))));
      if (fieldScore > 0 && (!best || fieldScore > best.score)) best = { index, score: fieldScore };
    });
    if (best !== null) claimed.add((best as { index: number }).index);
  }
  return claimed;
}

export function normalize(fields: NormalizableField[]): NormalizedApplication {
  const result: NormalizedApplication = {};
  const claimed = new Set<number>();

  // explicitly routed (agent-taught) fields first: they claim their index and
  // own their path outright - alias scoring never sees them or overwrites them
  const explicit = explicitRouting(fields);
  for (const index of explicit.indices) claimed.add(index);
  for (const [index, path] of explicit.byIndex) setPath(result, path, clean(fields[index]!.value));
  for (const [path, value] of explicit.bridged) setPath(result, path, value);

  for (const [path, aliases] of rules) {
    if (explicit.paths.has(path)) continue;
    let best: { index: number; score: number; value: string } | null = null;
    fields.forEach((field, index) => {
      if (claimed.has(index) || isGridRow(field) || !clean(field.value)) return;
      const label = canonical([field.label, field.name, field.section].filter(Boolean).join(" "));
      if (excludes[path]?.test(label)) return;
      const fieldScore = Math.max(...aliases.map(alias => score(label, canonical(alias))));
      if (fieldScore > 0 && (!best || fieldScore > best.score)) best = { index, score: fieldScore, value: clean(field.value) };
    });
    if (best !== null) {
      const b = best as { index: number; score: number; value: string };
      setPath(result, path, b.value);
      claimed.add(b.index);
    }
  }

  const contact = result["contact"];
  if (contact && !contact["fullName"]) {
    const fullName = clean([contact["firstName"], contact["lastName"]].filter(Boolean).join(" "));
    if (fullName) contact["fullName"] = fullName;
  }

  return result;
}
