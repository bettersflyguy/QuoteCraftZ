import { z } from "zod";
import type { CapturedApplicant, CapturedLobBlock, CapturedQuote, RunListItem } from "@/types";
import { renderCoverageSummary, buildCoverageLines } from "./renderCoverage";

export class NormalizeError extends Error {
  payloadSnippet: string;
  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "NormalizeError";
    this.payloadSnippet = JSON.stringify(payload)?.slice(0, 2000) ?? "";
  }
}

const RawQuote = z.object({
  quoteNumber: z.string().nullish(),
  coverages: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
  premiumDetails: z.object({
    premiums: z.array(z.object({ term: z.string().nullish(), totalPremium: z.string().nullish() }))
  }).nullish(),
  homeCoveragePremiums: z.array(z.object({ code: z.string(), name: z.string(), limits: z.string(), amountText: z.string() })).nullish(),
  endorsementPremiums: z.array(z.object({ name: z.string(), limits: z.string(), amountText: z.string() })).nullish()
}).passthrough();

const RawScriptResult = z.object({
  scriptName: z.string(),
  carrier: z.object({ id: z.number(), name: z.string() }).passthrough(),
  execId: z.number(),
  hasError: z.boolean(),
  errorMessage: z.string().nullish(),
  requestedQuotes: z.array(RawQuote).nullish(),
  alternateQuotes: z.array(RawQuote).nullish()
}).passthrough();

const RawLobBlock = z.object({
  lob: z.string(),
  scriptResults: z.array(RawScriptResult)
}).passthrough();

const RawQuoteResult = z.array(RawLobBlock);

function parsePremium(q: z.infer<typeof RawQuote>): { premium: number | null; termMonths: number | null } {
  const p = q.premiumDetails?.premiums?.[0];
  const premium = p?.totalPremium != null ? Number(p.totalPremium) : null;
  const t = p?.term != null ? Number(p.term) : null;
  return {
    premium: premium != null && Number.isFinite(premium) ? premium : null,
    termMonths: t === 6 || t === 12 ? t : null
  };
}

export function normalizeQuoteResult(
  raw: unknown,
  applicantQuoteIdByLob: Record<string, number>
): { blocks: CapturedLobBlock[] } {
  const parsed = RawQuoteResult.safeParse(raw);
  if (!parsed.success) throw new NormalizeError(`quote-result shape: ${parsed.error.message}`, raw);

  const blocks: CapturedLobBlock[] = parsed.data.map(block => {
    const quotes: CapturedQuote[] = [];
    const errors: { carrierName: string; message: string }[] = [];
    for (const s of block.scriptResults) {
      if (s.hasError) {
        errors.push({ carrierName: s.carrier.name, message: s.errorMessage ?? "Carrier returned an error" });
        continue;
      }
      const mk = (q: z.infer<typeof RawQuote>, kind: "requested" | "alternate", i: number): CapturedQuote => {
        const { premium, termMonths } = parsePremium(q);
        return {
          key: kind === "requested" ? `ezlynx:${s.execId}:req` : `ezlynx:${s.execId}:alt${i}`,
          kind,
          carrierEzlynxId: s.carrier.id,
          carrierName: s.carrier.name,
          quoteNumber: q.quoteNumber ?? null,
          premium,
          termMonths,
          coverageSummary: renderCoverageSummary(q, block.lob),
          coverageLines: buildCoverageLines(q, block.lob),
          raw: { lob: block.lob, scriptName: s.scriptName, carrier: s.carrier, execId: s.execId, kind, quote: q }
        };
      };
      (s.requestedQuotes ?? []).forEach(q => quotes.push(mk(q, "requested", 0)));
      (s.alternateQuotes ?? []).forEach((q, i) => quotes.push(mk(q, "alternate", i)));
    }
    return { lob: block.lob, applicantQuoteId: applicantQuoteIdByLob[block.lob] ?? 0, icq: null, quotes, errors };
  });

  return { blocks };
}

const RawApplicant = z.object({
  id: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullish(),
  isCommercial: z.boolean().nullish(),
  primaryAddress: z.object({
    address1: z.string(), city: z.string(), state: z.string(), postalCode: z.string()
  }).passthrough().nullish(),
  phoneNumbers: z.array(z.object({ number: z.string(), type: z.string().nullish() }).passthrough()).nullish(),
  // live shape is {type,email}; recon guessed {emailAddress}; accept both + bare strings
  emailAddresses: z.array(z.union([
    z.string(),
    z.object({ email: z.string() }).passthrough(),
    z.object({ emailAddress: z.string() }).passthrough()
  ])).nullish(),
  contacts: z.array(z.object({
    firstName: z.string(), lastName: z.string(),
    dateOfBirth: z.string().nullish(),
    relationship: z.object({ name: z.string() }).passthrough().nullish(),
    phoneNumbers: z.array(z.object({ number: z.string(), type: z.string().nullish() }).passthrough()).nullish(),
    emailAddresses: z.array(z.union([
      z.string(),
      z.object({ email: z.string() }).passthrough(),
      z.object({ emailAddress: z.string() }).passthrough()
    ])).nullish()
  }).passthrough()).nullish()
}).passthrough();

/** A value as display text: coded fields ({value,name}) by name, booleans
 * as Yes/No, numbers and strings as-is; empty -> "". */
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "name" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["name"]);
  return "";
}

/** One source address as display text. */
function addressOf(r: Record<string, unknown>): import("@/types").CapturedAddress {
  return {
    type: text(r["type"]), street: text(r["address1"]), unit: text(r["unit"]), address2: text(r["address2"]),
    city: text(r["city"]), state: text(r["state"]), county: text(r["county"]),
    postalCode: text(r["postalCode"]), postalCodeSuffix: text(r["postalCodeSuffix"]),
    yearsAtAddress: text(r["yearsAtAddress"]), monthsAtAddress: text(r["monthsAtAddress"])
  };
}

/** The primary address, then every other one (addresses[]), skipping empties. */
function allAddresses(a: Record<string, unknown>): import("@/types").CapturedAddress[] {
  const raw: unknown[] = [a["primaryAddress"], ...(Array.isArray(a["addresses"]) ? a["addresses"] as unknown[] : [])];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map(addressOf)
    .filter(x => x.street || x.city || x.postalCode);
}

/** A person's phones and emails as lists, in the source's order: the FIRST
 * of each is the primary (it feeds the CRM record), every other one is an
 * additional row the agent routes (a timeline note by default). */
export function contactChannels(r: Record<string, unknown>): {
  phones: import("@/types").CapturedPhone[]; emails: import("@/types").CapturedEmail[];
} {
  const phones = (Array.isArray(r["phoneNumbers"]) ? r["phoneNumbers"] as Record<string, unknown>[] : [])
    .map(p => ({ type: text(p?.["type"]), number: text(p?.["number"]), extension: text(p?.["extension"]) }))
    .filter(p => p.number);
  const emails = (Array.isArray(r["emailAddresses"]) ? r["emailAddresses"] as unknown[] : [])
    .map(e => {
      if (typeof e === "string") return { type: "", email: e.trim() };
      const o = (e ?? {}) as Record<string, unknown>;
      return { type: text(o["type"]), email: text(o["email"] ?? o["emailAddress"]) };
    })
    .filter(e => e.email);
  return { phones, emails };
}

/** Every person's phones / emails after their primary (the applicant's,
 * then each contact's), one row each, named by whose they are. */
function extraChannels(a: Record<string, unknown>): { phones: import("@/types").CapturedPhone[]; emails: import("@/types").CapturedEmail[] } {
  const people = [a, ...(Array.isArray(a["contacts"]) ? a["contacts"] as Record<string, unknown>[] : [])];
  const phones: import("@/types").CapturedPhone[] = [];
  const emails: import("@/types").CapturedEmail[] = [];
  for (const p of people) {
    const person = `${text(p["firstName"])} ${text(p["lastName"])}`.trim();
    const c = contactChannels(p);
    for (const ph of c.phones.slice(1)) phones.push({ ...ph, person });
    for (const em of c.emails.slice(1)) emails.push({ ...em, person });
  }
  return { phones, emails };
}

/** The person's other values (the data service returns far more than the
 * identity fields). SSN and license NUMBERS are not in here: they travel
 * only on the secured channel (see sources/ezlynxSource ezlynxSecure). */
function personDetails(r: Record<string, unknown>, address?: Record<string, unknown> | null): Record<string, string> {
  const d: Record<string, string> = {
    middleInitial: text(r["middleInitial"]),
    nickName: text(r["nickName"]),
    maidenName: text(r["maidenName"]),
    gender: text(r["gender"]),
    maritalStatus: text(r["maritalStatus"]),
    education: text(r["education"]),
    industry: text(r["industry"]),
    occupation: text(r["occupation"]),
    yearsAtOccupation: text(r["yearsAtOccupation"]),
    priorEmployerInYears: text(r["priorEmployerInYears"]),
    driversLicenseStatus: text(r["driversLicenseStatus"]),
    driversLicenseState: text(r["driversLicenseState"]),
    applicantType: text(r["applicantType"]),
    customerSince: text(r["customerSince"]).slice(0, 10),
    accountName: text(r["accountName"]),
    leadSource: text(r["leadSource"]),
    assignedProducer: text((r["assignedTo"] as Record<string, unknown> | undefined)?.["name"]).replace(/\s+/g, " "),
    csr: text((r["csrUserModel"] as Record<string, unknown> | undefined)?.["name"]).replace(/\s+/g, " "),
    preferredContactMethod: text(r["preferredContactMethod"]),
    isVip: text(r["isVip"]),
    isDeceased: text(r["isDeceased"]),
    ratingState: text(r["ratingState"]),
    isCommercial: text(r["isCommercial"]),
    isCoApplicant: text(r["isCoApplicant"]),
    isDriver: text(r["isDriver"])
  };
  if (address) {
    d["addressType"] = text(address["type"]);
    d["street"] = text(address["address1"]);
    d["city"] = text(address["city"]);
    d["state"] = text(address["state"]);
    d["postalCode"] = text(address["postalCode"]);
    d["unit"] = text(address["unit"]);
    d["address2"] = text(address["address2"]);
    d["county"] = text(address["county"]);
    d["postalCodeSuffix"] = text(address["postalCodeSuffix"]);
    d["yearsAtAddress"] = text(address["yearsAtAddress"]);
    d["monthsAtAddress"] = text(address["monthsAtAddress"]);
  }
  for (const k of Object.keys(d)) if (!d[k]) delete d[k];
  return d;
}

export function normalizeApplicant(raw: unknown): CapturedApplicant {
  const p = RawApplicant.safeParse(raw);
  if (!p.success) throw new NormalizeError(`applicant shape: ${p.error.message}`, raw);
  const a = p.data;
  return {
    details: personDetails(a as Record<string, unknown>, a.primaryAddress as Record<string, unknown> | null | undefined),
    ezlynxApplicantId: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    dateOfBirth: a.dateOfBirth ? a.dateOfBirth.slice(0, 10) : null,
    dlNumber: ((a as Record<string, unknown>)["driversLicenseNumber"] as string) || null,
    dlState: ((a as Record<string, unknown>)["driversLicenseState"] as string) || null,
    // secured pass-through only: the worker moves it to the session-memory
    // holding area and strips it before anything is stored
    ssn: text((a as Record<string, unknown>)["socialSecurityNumber"]) || null,
    address: a.primaryAddress
      ? { street: a.primaryAddress.address1, city: a.primaryAddress.city, state: a.primaryAddress.state, postalCode: a.primaryAddress.postalCode }
      : null,
    addresses: allAddresses(a as Record<string, unknown>),
    // every phone / email after the primary, one row each
    morePhones: extraChannels(a as Record<string, unknown>).phones,
    moreEmails: extraChannels(a as Record<string, unknown>).emails,
    phones: (a.phoneNumbers ?? []).map(pn => ({ type: pn.type ?? null, number: pn.number })),
    emails: (a.emailAddresses ?? [])
      .map(e => {
        if (typeof e === "string") return e;
        const rec = e as { email?: string; emailAddress?: string };
        return rec.email ?? rec.emailAddress ?? "";
      })
      .filter(Boolean),
    coApplicants: (a.contacts ?? []).map(c => ({
      details: personDetails(c as Record<string, unknown>, (c as Record<string, unknown>)["primaryAddress"] as Record<string, unknown> | null | undefined),
      firstName: c.firstName,
      lastName: c.lastName,
      relationship: c.relationship?.name ?? "",
      phone: c.phoneNumbers?.[0]?.number ?? null,
      dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : null,
      dlNumber: ((c as Record<string, unknown>)["driversLicenseNumber"] as string) || null,
      dlState: ((c as Record<string, unknown>)["driversLicenseState"] as string) || null,
      ssn: text((c as Record<string, unknown>)["socialSecurityNumber"]) || null,
      email: (c.emailAddresses ?? [])
        .map(e => (typeof e === "string" ? e : ("email" in e ? (e as { email: string }).email : (e as { emailAddress: string }).emailAddress)))
        .filter(Boolean)[0] ?? null
    })),
    isCommercial: a.isCommercial ?? false
  };
}

const RawRunRow = z.object({
  applicantId: z.number(),
  created: z.string(),
  applicationId: z.number(),
  autoApplicantQuoteId: z.number().nullish(),
  homeApplicantQuoteId: z.number().nullish(),
  lobs: z.string().nullish(),
  description: z.string().nullish()
}).passthrough();

export function normalizeRunList(raw: unknown): RunListItem[] {
  const p = z.array(RawRunRow).safeParse(raw);
  if (!p.success) throw new NormalizeError(`run-list shape: ${p.error.message}`, raw);
  return p.data.map(r => {
    const quoteIdsByLob: { lob: string; applicantQuoteId: number }[] = [];
    if (r.autoApplicantQuoteId) quoteIdsByLob.push({ lob: "Auto", applicantQuoteId: r.autoApplicantQuoteId });
    if (r.homeApplicantQuoteId) quoteIdsByLob.push({ lob: "Home", applicantQuoteId: r.homeApplicantQuoteId });
    return {
      applicationId: r.applicationId,
      applicantId: r.applicantId,
      created: r.created,
      lobs: r.lobs ?? quoteIdsByLob.map(q => q.lob).join(", "),
      quoteIdsByLob,
      description: r.description ?? ""
    };
  });
}

/** Joins the ICQ question catalog with the application's answers. Question ids
 * and answer keys share a namespace for carrier questions; answers whose key
 * matches no catalog question are app-internal fields and are ignored (they can
 * carry PII). Values verbatim. */
export function buildIcqPairs(
  catalogRaw: unknown,
  answersRaw: unknown
): NonNullable<import("@/types").CapturedLobBlock["icq"]> | null {
  const catalog = z.object({
    stateCode: z.string().nullish(),
    locations: z.array(z.object({
      questions: z.array(z.object({
        questionId: z.string(),
        questionShortName: z.string().nullish(),
        label: z.string().nullish(),
        helpText: z.string().nullish(),
        answerType: z.object({ name: z.string().nullish() }).passthrough().nullish(),
        options: z.array(z.object({ value: z.string(), displayText: z.string().nullish() }).passthrough()).nullish()
      }).passthrough()).nullish()
    }).passthrough())
  }).passthrough().safeParse(catalogRaw);
  if (!catalog.success) return null;
  const answers = z.array(z.object({ key: z.string(), value: z.string().nullish() }).passthrough()).safeParse(answersRaw ?? []);
  const byKey = new Map((answers.success ? answers.data : []).map(a => [a.key, a.value ?? null]));
  const questions = catalog.data.locations.flatMap(l => l.questions ?? []);
  const pairs = questions.map(q => ({
    questionId: q.questionId,
    carrier: q.questionShortName ?? null,
    label: q.label ?? q.questionId,
    answer: byKey.get(q.questionId) ?? null
  }));
  return {
    pairs,
    answeredCount: pairs.filter(p => p.answer != null).length,
    totalQuestions: pairs.length,
    state: catalog.data.stateCode ?? null,
    catalog: questions.map(q => ({
      questionId: q.questionId,
      carrier: q.questionShortName ?? null,
      label: q.label ?? q.questionId,
      helpText: q.helpText ?? null,
      answerType: q.answerType?.name ?? null,
      options: (q.options ?? []).map(o => ({ value: o.value, displayText: o.displayText ?? o.value }))
    }))
  };
}

/** Harvests per-person licenses from a risk-application payload. Auto apps
 * carry drivers[]; Home apps carry a single applicant object. */
export function harvestLicenses(appRaw: unknown): { firstName: string; lastName: string; dlNumber: string; dlState: string | null }[] {
  const schema = z.object({
    drivers: z.array(z.object({
      firstName: z.string().nullish(), lastName: z.string().nullish(),
      driversLicenseNumber: z.string().nullish(), driversLicenseState: z.string().nullish()
    }).passthrough()).nullish(),
    applicant: z.object({
      firstName: z.string().nullish(), lastName: z.string().nullish(),
      driversLicenseNumber: z.string().nullish(), driversLicenseState: z.string().nullish()
    }).passthrough().nullish()
  }).passthrough().safeParse(appRaw);
  if (!schema.success) return [];
  const people = [...(schema.data.drivers ?? []), ...(schema.data.applicant ? [schema.data.applicant] : [])];
  return people
    .filter(p => p.firstName && p.lastName && p.driversLicenseNumber)
    .map(p => ({
      firstName: p.firstName!, lastName: p.lastName!,
      dlNumber: p.driversLicenseNumber!, dlState: p.driversLicenseState ?? null
    }));
}
