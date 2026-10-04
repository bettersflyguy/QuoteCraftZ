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
    ["business.description", ["describe your business", "what does your business do", "description of operations", "nature of business", "what kind of work do you do"]],
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


  /* value variants: state abbreviations <-> full names, for option matching */
  const US_STATES = { AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia" };
  function valueVariants(value) {
    const v = clean(value);
    const out = [v];
    const up = v.toUpperCase();
    if (US_STATES[up]) out.push(US_STATES[up]);
    const abbr = Object.keys(US_STATES).find((k) => US_STATES[k].toLowerCase() === v.toLowerCase());
    if (abbr) out.push(abbr);
    return out;
  }

  /* a candidate must make sense for the field: a phone field never takes a
   * value without digits ("Cell" is a phone TYPE) */
  const FIELD_VALIDATORS = [
    { field: /phone|telephone|mobile|cellphone|cell number/, ok: (v) => String(v).replace(/[^0-9]/g, "").length >= 7 }
  ];

  /* standing answers (agency policy, Nathan 2026-10-04): the consumer-report /
   * third-party data disclosure is read on EVERY opening call script, so the
   * "I've read this disclosure to my client" acknowledgment always fills Yes.
   * The agent still reviews and advances the page. */
  const STANDING_CANDIDATES = [
    {
      path: "standing.disclosureRead",
      source: "standing",
      value: "Yes",
      aliases: [
        "customer consent timestamp",
        "consent timestamp",
        "i've read this disclosure to my client",
        "read this disclosure to my client",
        "was the above disclosure read or provided",
        "disclosure read to client",
        "consent to consumer reports"
      ]
    }
  ];

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
    /* a combined street line ("4054 W 115Th St, 409") splits into
     * street1 + street2 when nothing else provides line 2 */
    const s1 = candidates.find((c) => c.path === "address.street1");
    const hasS2 = candidates.some((c) => c.path === "address.street2");
    if (s1 && !hasS2) {
      const split = String(s1.value).match(/^(.*?\S)[,;]\s*((?:apt|unit|ste|suite|no|#)?\.?\s*[\w-]{1,10})$/i);
      if (split && /\d/.test(split[2])) {
        s1.value = clean(split[1]);
        candidates.push({ path: "address.street2", aliases: rules.find((r) => r[0] === "address.street2")[1], value: clean(split[2]), source: "normalized" });
      }
    }
    STANDING_CANDIDATES.forEach((sc) => candidates.push(sc));
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

  /* a candidate must never land in a field that structurally contradicts it:
   * street line 1 has no business in "Mailing Address Line 2" / Apt / Suite,
   * and a full name never fills First/Last/Middle (the split candidates do). */
  const PATH_FIELD_EXCLUDE = {
    "address.street1": /line\s*2|address\s*2\b|suite|\bapt\b|apartment|\bunit\b/,
    "address.street2": /line\s*1|address\s*1\b/,
    "contact.fullName": /\bfirst\b|\blast\b|\bmiddle\b/
  };

  function matchField(fieldName, candidates) {
    const fieldCanon = canonical(fieldName);
    let best = null;
    candidates.forEach((candidate) => {
      const exclude = PATH_FIELD_EXCLUDE[candidate.path];
      if (exclude && exclude.test(fieldCanon)) return;
      for (const v of FIELD_VALIDATORS) {
        if (v.field.test(fieldCanon) && !v.ok(candidate.value)) return;
      }
      const score = Math.max(...candidate.aliases.map((alias) => aliasScore(fieldName, alias))) + (candidate.source === "normalized" ? 3 : 0);
      if (score >= 72 && (!best || score > best.score)) best = { ...candidate, score };
    });
    return best;
  }

  function validForField(fieldName, value) {
    const fieldCanon = canonical(fieldName);
    for (const v of FIELD_VALIDATORS) {
      if (v.field.test(fieldCanon) && !v.ok(value)) return false;
    }
    return true;
  }

  return { buildCandidates, canonical, matchField, valueVariants, validForField };
});
