(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BettersPortalMapper = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const rules = [
    ["business.legalName", ["business name", "legal business name", "legal name", "company name", "named insured", "applicant business name"]],
    ["business.dba", ["dba", "doing business as", "trade name"]],
    ["business.entityType", ["legal entity type", "entity type", "organization type", "business type"]],
    ["business.fein", ["fein", "ein", "federal tax id", "tax identification number", "employer identification number"]],
    ["business.industry", ["industry", "business description", "business activity", "type of work", "operations"]],
    ["business.foundingYear", ["founding year", "year established", "year business started", "business start year"]],
    ["business.annualRevenue", ["annual revenue", "gross revenue", "annual sales", "gross sales", "estimated sales"]],
    ["contact.firstName", ["first name", "given name", "contact first name", "policyholder first name", "given-name"]],
    ["contact.lastName", ["last name", "surname", "contact last name", "policyholder last name", "family-name"]],
    ["contact.fullName", ["contact name", "applicant name", "policyholder name", "full name"]],
    ["contact.email", ["email", "email address", "contact email"]],
    ["contact.phone", ["phone", "phone number", "telephone", "mobile", "tel"]],
    ["contact.dateOfBirth", ["date of birth", "birth date", "birthdate", "dob", "bday"]],
    ["contact.gender", ["gender", "sex"]],
    ["contact.maritalStatus", ["marital status"]],
    ["address.street1", ["street address", "address line 1", "address 1", "business address", "mailing address", "garaging address", "address-line1"]],
    ["address.street2", ["suite", "unit", "address line 2", "address 2", "address-line2"]],
    ["address.city", ["city", "address-level2"]],
    ["address.state", ["state", "province", "address-level1"]],
    ["address.postalCode", ["zip", "zipcode", "zip code", "postal code", "postal-code"]],
    ["coverage.effectiveDate", ["effective date", "policy start date", "coverage start date", "desired effective date"]],
    ["coverage.expirationDate", ["expiration date", "policy expiration date"]],
    ["coverage.currentCarrier", ["current carrier", "prior carrier", "insurance carrier"]],
    ["coverage.currentPremium", ["current premium", "annual premium", "prior premium"]],
    ["coverage.autoLiabilityLimit", ["auto liability limit", "bodily injury property damage", "combined single limit"]],
    ["employment.fullTimeEmployees", ["full time employees", "full-time employees"]],
    ["employment.partTimeEmployees", ["part time employees", "part-time employees"]],
    ["payroll.owners", ["owner payroll", "owner wages"]],
    ["payroll.employees", ["employee payroll", "annual payroll", "employee wages"]],
    ["payroll.subcontractors", ["subcontractor cost", "subcontractors"]],
    ["building.floors", ["number of floors", "building floors"]],
    ["building.occupiedSquareFeet", ["occupied square feet", "square footage occupied"]],
    ["building.totalSquareFeet", ["total square feet", "building square footage"]],
    ["building.yearBuilt", ["year built", "construction year"]],
    ["building.constructionType", ["construction type", "building construction"]],
    ["building.businessPersonalPropertyValue", ["business personal property", "bpp value", "contents value"]],
    ["history.lossesLastFiveYears", ["loss or claim", "prior losses", "claims in the last 5 years"]],
    ["history.coverageIssuesLastThreeYears", ["lapse of coverage", "declined canceled or nonrenewed", "prior coverage issues"]],
    ["application.id", ["application id", "submission id", "quote id"]]
  ];

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function canonical(value) {
    return clean(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  function getPath(object, path) {
    return path.split(".").reduce((value, key) => value && value[key], object);
  }

  function comparable(value) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }

  /* raw captured labels this generic are POISON as fill candidates: a field
   * captured as "Name: Edward Parkin" would substring-match First Name, Last
   * Name and NamedInsured.City alike. The normalized identity (with proper
   * alias sets) covers these; the raw duplicates are dropped. */
  const GENERIC_LABELS = new Set(["name", "full name", "address", "mailing address", "city", "state", "zip", "zip code", "phone", "phone number", "email", "email address"]);

  function buildCandidates(payload) {
    const candidates = [];
    const normalized = (payload && payload.normalized) || {};
    rules.forEach(([path, aliases]) => {
      const value = getPath(normalized, path);
      if (comparable(value) && clean(value)) candidates.push({ path, aliases, value: clean(value), source: "normalized" });
    });
    /* a capture holding only a glued full name still fills First/Last: split
     * on the fly (middle names dropped — mirrors the identity rules) */
    const contact = normalized.contact || {};
    if (clean(contact.fullName) && !clean(contact.firstName)) {
      const parts = clean(contact.fullName).split(" ");
      if (parts.length > 1) {
        candidates.push({ path: "contact.firstName", aliases: rules.find(function (r) { return r[0] === "contact.firstName"; })[1], value: parts[0], source: "normalized" });
        candidates.push({ path: "contact.lastName", aliases: rules.find(function (r) { return r[0] === "contact.lastName"; })[1], value: parts[parts.length - 1], source: "normalized" });
      }
    }
    (payload && payload.fields || []).forEach((field, index) => {
      if (!comparable(field.value) || !clean(field.value) || !clean(field.label)) return;
      if (GENERIC_LABELS.has(canonical(field.label))) return;
      const aliases = [field.label];
      if (/\bvin\b/i.test(field.label)) aliases.push("VIN", "VIN number", "vehicle VIN", "vehicle identification number");
      if (field.group) aliases.push(`${field.group} ${field.label}`);
      if (field.section) aliases.push(`${field.section} ${field.label}`);
      candidates.push({ path: `fields.${index}`, aliases, value: clean(field.value), source: "captured" });
    });
    return candidates;
  }

  function aliasScore(fieldName, alias) {
    const field = canonical(fieldName);
    const wanted = canonical(alias);
    if (!field || !wanted) return 0;
    if (field === wanted) return 120;
    if (field.startsWith(`${wanted} `) || field.endsWith(` ${wanted}`)) return 100;
    /* substring matches need a distinctive alias — a short single word inside
     * a longer field name ("name" in "named insured city") proves nothing */
    if (field.includes(wanted) && (wanted.length >= 8 || wanted.indexOf(" ") > 0)) return 90;
    if (wanted.length >= 8 && wanted.includes(field)) return 78;
    const tokens = wanted.split(" ").filter((token) => token.length > 2);
    const actual = new Set(field.split(" "));
    const matched = tokens.filter((token) => actual.has(token)).length;
    if (tokens.length >= 2 && matched === tokens.length) return 72;
    return 0;
  }

  function matchField(fieldName, candidates) {
    let best = null;
    candidates.forEach((candidate) => {
      const score = Math.max(...candidate.aliases.map((alias) => aliasScore(fieldName, alias))) + (candidate.source === "normalized" ? 3 : 0);
      if (score >= 72 && (!best || score > best.score)) best = { ...candidate, score };
    });
    return best;
  }

  return { buildCandidates, canonical, matchField };
});
