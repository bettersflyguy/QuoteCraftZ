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

export function normalizeApplicant(raw: unknown): CapturedApplicant {
  const p = RawApplicant.safeParse(raw);
  if (!p.success) throw new NormalizeError(`applicant shape: ${p.error.message}`, raw);
  const a = p.data;
  return {
    ezlynxApplicantId: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    dateOfBirth: a.dateOfBirth ? a.dateOfBirth.slice(0, 10) : null,
    address: a.primaryAddress
      ? { street: a.primaryAddress.address1, city: a.primaryAddress.city, state: a.primaryAddress.state, postalCode: a.primaryAddress.postalCode }
      : null,
    phones: (a.phoneNumbers ?? []).map(pn => ({ type: pn.type ?? null, number: pn.number })),
    emails: (a.emailAddresses ?? [])
      .map(e => {
        if (typeof e === "string") return e;
        const rec = e as { email?: string; emailAddress?: string };
        return rec.email ?? rec.emailAddress ?? "";
      })
      .filter(Boolean),
    coApplicants: (a.contacts ?? []).map(c => ({
      firstName: c.firstName,
      lastName: c.lastName,
      relationship: c.relationship?.name ?? "",
      phone: c.phoneNumbers?.[0]?.number ?? null,
      dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : null,
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
): { pairs: import("@/types").IcqPair[]; answeredCount: number; totalQuestions: number } | null {
  const catalog = z.object({
    locations: z.array(z.object({
      questions: z.array(z.object({
        questionId: z.string(),
        questionShortName: z.string().nullish(),
        label: z.string().nullish()
      }).passthrough()).nullish()
    }).passthrough())
  }).passthrough().safeParse(catalogRaw);
  if (!catalog.success) return null;
  const answers = z.array(z.object({ key: z.string(), value: z.string().nullish() }).passthrough()).safeParse(answersRaw ?? []);
  const byKey = new Map((answers.success ? answers.data : []).map(a => [a.key, a.value ?? null]));
  const pairs = catalog.data.locations.flatMap(l => l.questions ?? []).map(q => ({
    questionId: q.questionId,
    carrier: q.questionShortName ?? null,
    label: q.label ?? q.questionId,
    answer: byKey.get(q.questionId) ?? null
  }));
  return {
    pairs,
    answeredCount: pairs.filter(p => p.answer != null).length,
    totalQuestions: pairs.length
  };
}
