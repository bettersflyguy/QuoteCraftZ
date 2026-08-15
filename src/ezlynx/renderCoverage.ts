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

function capOnLineBoundary(lines: string[], max: number): string {
  let out = "";
  for (const line of lines) {
    const next = out ? out + "\n" + line : line;
    if (next.length > max - 1) return out + "…";
    out = next;
  }
  return out;
}
