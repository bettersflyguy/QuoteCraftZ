import endpoints from "@/config/endpoints.json";
import { normalizeApplicant, normalizeQuoteResult, normalizeRunList } from "./normalize";
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
