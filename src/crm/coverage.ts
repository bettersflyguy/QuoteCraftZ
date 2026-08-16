import type { CapturedQuote } from "@/types";
import type { CrmEnvironment } from "./environments";
import type { BatchItemResult } from "./dataverse";

export interface CoverageApi {
  getCoverageQuoteNavProp(env: CrmEnvironment): Promise<string | null>;
  getCoverageRowIds(env: CrmEnvironment, quoteId: string): Promise<string[]>;
  executeBatch(
    env: CrmEnvironment,
    ops: { key: string; method: "PATCH" | "POST" | "DELETE"; url: string; body?: unknown }[]
  ): Promise<BatchItemResult[]>;
}

/** "$606,900" / "$606900" / "606900" -> 606900; "No Coverage" / "INCLUDED" /
 * "1%" / "500 CSL" -> null. Verbatim text is preserved separately. */
export function parseLimitValue(text: string): number | null {
  const m = /^\$?([\d,]+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function buildCoverageRowBodies(
  quote: CapturedQuote,
  quoteId: string,
  quoteNavProp: string
): Record<string, unknown>[] {
  return quote.coverageLines.map((line, i) => {
    const body: Record<string, unknown> = {
      iacrm_quotecoverage_name: line.label.slice(0, 300),
      iacrm_coveragecode: line.code.slice(0, 50),
      iacrm_limittext: line.limitText.slice(0, 100),
      iacrm_displayorder: i,
      iacrm_amsexternalid: `${quote.key}:cov:${i}`,
      [`${quoteNavProp}@odata.bind`]: `/iacrm_quotes(${quoteId})`
    };
    const v = parseLimitValue(line.limitText);
    if (v != null) body["iacrm_limitvalue"] = v;
    return body;
  });
}

export interface CoverageWriteResult { quotesCovered: number; linesWritten: number; skipped: "no-columns" | null }

/** Replace-style write: delete the quote's existing coverage rows, then create
 * fresh ones. Idempotent without needing an alternate key, and a coverage
 * dropped on re-rate never leaves a stale row behind. No-ops (skipped:
 * "no-columns") until the CRM-side schema is deployed. */
export async function writeCoverageLines(
  env: CrmEnvironment,
  quotes: { quote: CapturedQuote; quoteId: string }[],
  api: CoverageApi
): Promise<CoverageWriteResult> {
  const nav = await api.getCoverageQuoteNavProp(env);
  if (!nav) return { quotesCovered: 0, linesWritten: 0, skipped: "no-columns" };

  const ops: { key: string; method: "PATCH" | "POST" | "DELETE"; url: string; body?: unknown }[] = [];
  let linesWritten = 0;
  for (const { quote, quoteId } of quotes) {
    if (!quote.coverageLines.length) continue;
    const existing = await api.getCoverageRowIds(env, quoteId);
    for (const id of existing) ops.push({ key: `del:${id}`, method: "DELETE", url: `iacrm_quotecoverages(${id})` });
    for (const body of buildCoverageRowBodies(quote, quoteId, nav)) {
      ops.push({ key: `cov:${body["iacrm_amsexternalid"]}`, method: "POST", url: "iacrm_quotecoverages", body });
      linesWritten++;
    }
  }
  if (ops.length) {
    const results = await api.executeBatch(env, ops);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} coverage row op(s) failed: ${failed[0]!.error}`);
  }
  return { quotesCovered: quotes.filter(q => q.quote.coverageLines.length > 0).length, linesWritten, skipped: null };
}
