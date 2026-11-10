import endpoints from "@/config/endpoints.json";
import { normalizeApplicant, normalizeQuoteResult, normalizeRunList, buildIcqPairs, harvestLicenses, driversFromRiskApp } from "./normalize";
import type { CapturedRun, RunListItem } from "@/types";

export class EzlynxSessionError extends Error {
  constructor() { super("EZLynx session expired or unauthorized"); this.name = "EzlynxSessionError"; }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (url, init) => fetch(url, { credentials: "include", signal: AbortSignal.timeout(20_000), ...init });

async function getJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher(url);
  if (res.status === 401 || res.status === 403 || res.status === 302) throw new EzlynxSessionError();
  if (!res.ok) throw new Error(`EZLynx ${res.status} for ${url}`);
  return res.json();
}

/** The applicant alone (an applicant with no rating run yet). */
export async function fetchApplicant(applicantId: number, fetcher: Fetcher = defaultFetcher): Promise<import("@/types").CapturedApplicant> {
  return normalizeApplicant(await getJson(endpoints.applicant.replace("{applicantId}", String(applicantId)), fetcher));
}

export async function fetchRunList(applicantId: number, fetcher: Fetcher = defaultFetcher): Promise<RunListItem[]> {
  const url = endpoints.recentQuotes.replace("{applicantId}", String(applicantId));
  return normalizeRunList(await getJson(url, fetcher));
}

export async function fetchCapturedRun(
  applicantId: number,
  run: RunListItem,
  fetcher: Fetcher = defaultFetcher
): Promise<CapturedRun> {
  const applicant = normalizeApplicant(
    await getJson(endpoints.applicant.replace("{applicantId}", String(applicantId)), fetcher)
  );

  // one quote-result payload can carry multiple LOB blocks; fetch each distinct id,
  // keep the first block seen per LOB (dedup when both ids return both blocks)
  const idByLob: Record<string, number> = {};
  for (const q of run.quoteIdsByLob) idByLob[q.lob] = q.applicantQuoteId;

  const distinctIds = [...new Set(run.quoteIdsByLob.map(q => q.applicantQuoteId))];
  const seen = new Set<string>();
  const blocks = [];
  for (const id of distinctIds) {
    const url = endpoints.quoteResult.replace("{applicantQuoteId}", String(id));
    const { blocks: got } = normalizeQuoteResult(await getJson(url, fetcher), idByLob);
    for (const b of got) {
      if (!seen.has(b.lob)) { seen.add(b.lob); blocks.push(b); }
    }
  }

  // carrier underwriting Q&A - best-effort per LOB; the risk-application
  // endpoints are flaky (500s observed) and Q&A is enrichment, not the import
  try {
    const icqRaw = await getJson(endpoints.icq.replace("{applicationId}", String(run.applicationId)), fetcher);
    for (const b of blocks) {
      try {
        const slug = b.lob.toLowerCase() === "home" ? "home" : "auto";
        const appRaw = await getJson(
          endpoints.riskApplication.replace("{lobSlug}", slug).replace("{applicationId}", String(run.applicationId)),
          fetcher
        ) as { icqAnswers?: unknown };
        b.icq = buildIcqPairs(icqRaw, appRaw.icqAnswers);
        // per-driver licenses ride the same fetch; merge by name (ci)
        for (const lic of harvestLicenses(appRaw)) {
          const eq = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
          if (eq(lic.firstName, applicant.firstName) && eq(lic.lastName, applicant.lastName)) {
            applicant.dlNumber = applicant.dlNumber ?? lic.dlNumber;
            applicant.dlState = applicant.dlState ?? lic.dlState;
          }
          for (const co of applicant.coApplicants) {
            if (eq(lic.firstName, co.firstName) && eq(lic.lastName, co.lastName)) {
              co.dlNumber = co.dlNumber ?? lic.dlNumber;
              co.dlState = co.dlState ?? lic.dlState;
            }
          }
        }
        // drivers added on the quote (not on the contact list) join the people
        addDrivers(applicant, driversFromRiskApp(appRaw));
      } catch { /* leave b.icq null */ }
    }
  } catch { /* no catalog - leave all null */ }

  return {
    applicant,
    openApplicationId: run.applicationId,
    capturedAt: new Date().toISOString(),
    ratedAt: run.created ?? null,
    blocks
  };
}

export function applicantIdFromUrl(href: string): number | null {
  const m = new RegExp(endpoints.applicantUrlPattern).exec(href);
  return m?.[1] ? Number(m[1]) : null;
}

/** Drivers who aren't already the applicant or a contact become contacts
 * (same name = same person: their driver details fill what's missing). */
export function addDrivers(applicant: CapturedRun["applicant"], drivers: CapturedRun["applicant"]["coApplicants"]): void {
  const eq = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  for (const d of drivers) {
    const same = (p: { firstName: string; lastName: string }) => eq(p.firstName, d.firstName) && eq(p.lastName, d.lastName);
    if (same(applicant)) { applicant.details = { ...(d.details ?? {}), ...(applicant.details ?? {}) }; continue; }
    const co = applicant.coApplicants.find(same);
    if (co) {
      co.details = { ...(d.details ?? {}), ...(co.details ?? {}) };
      co.dateOfBirth = co.dateOfBirth ?? d.dateOfBirth;
      continue;
    }
    applicant.coApplicants.push(d);
  }
}
