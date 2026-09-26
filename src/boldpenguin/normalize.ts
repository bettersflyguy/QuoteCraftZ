/** Alias-scored normalizer for Bold Penguin application fields.
 * TypeScript port of the Application Assistant concept's lib/normalizer.js;
 * the rule list is the field inventory from live Bold Penguin applications
 * (docs/bold-penguin-field-inventory.md). */
import type { NormalizedApplication } from "./types";

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
  ["contact.fullName", ["primary contact", "contact name", "applicant name", "full name"]],
  ["contact.email", ["email address", "email"]],
  ["contact.phone", ["phone number", "telephone", "phone"]],
  ["contact.dateOfBirth", ["date of birth", "birth date", "birthdate", "dob"]],
  ["contact.gender", ["gender", "sex"]],
  ["contact.maritalStatus", ["marital status"]],
  ["address.street1", ["business address", "street address", "address line 1", "address 1", "street"]],
  ["address.street2", ["address line 2", "address 2", "suite", "unit"]],
  ["address.city", ["business city", "city"]],
  ["address.state", ["business state", "state", "province"]],
  ["address.postalCode", ["postal code", "zip code", "zipcode", "zip"]],
  ["coverage.effectiveDate", ["desired effective date", "policy effective date", "effective date"]],
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
}

export function normalize(fields: NormalizableField[]): NormalizedApplication {
  const result: NormalizedApplication = {};
  const claimed = new Set<number>();

  for (const [path, aliases] of rules) {
    let best: { index: number; score: number; value: string } | null = null;
    fields.forEach((field, index) => {
      if (claimed.has(index) || !clean(field.value)) return;
      const label = canonical([field.label, field.name, field.section].filter(Boolean).join(" "));
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
