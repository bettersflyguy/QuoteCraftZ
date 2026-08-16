const MAX = 5000;

export interface RawQuoteLike {
  coverages?: { name: string; value: string }[] | null;
  homeCoveragePremiums?: { code: string; name: string; limits: string; amountText: string }[] | null;
  endorsementPremiums?: { name: string; limits: string; amountText: string }[] | null;
}

/** Renders the COVERAGE cell text. Values pass through VERBATIM (spec invariant). */
export function renderCoverageSummary(q: RawQuoteLike, lob: string): string {
  const lines: string[] = [];
  const isHome = lob.toLowerCase() === "home";
  if (isHome && (q.homeCoveragePremiums?.length ?? 0) > 0) {
    for (const c of q.homeCoveragePremiums!) lines.push(`Cov ${c.code}: ${c.limits}: ${c.amountText}`);
    for (const e of q.endorsementPremiums ?? []) lines.push(`${e.name}: ${e.limits}: ${e.amountText}`);
  } else {
    for (const c of q.coverages ?? []) lines.push(`${c.name}: ${c.value}`);
  }
  return capOnLineBoundary(lines, MAX);
}

/** Structured coverage lines for iacrm_quotecoverage rows - same sources and
 * order as the rendered summary, values verbatim. */
export function buildCoverageLines(q: RawQuoteLike, lob: string): { code: string; label: string; limitText: string }[] {
  const isHome = lob.toLowerCase() === "home";
  if (isHome && (q.homeCoveragePremiums?.length ?? 0) > 0) {
    return [
      ...q.homeCoveragePremiums!.map(c => ({ code: c.code, label: `Cov ${c.code}`, limitText: c.limits })),
      ...(q.endorsementPremiums ?? []).map(e => ({ code: e.name, label: e.name, limitText: e.limits }))
    ];
  }
  return (q.coverages ?? []).map(c => ({ code: c.name, label: c.name, limitText: c.value }));
}

function capOnLineBoundary(lines: string[], max: number): string {
  let out = "";
  for (const line of lines) {
    const next = out ? out + "\n" + line : line;
    if (next.length > max - 1) return out + "…";
    out = next;
  }
  return out;
}
