import { useEffect, useState } from "react";
import { Checkbox, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import type { CapturedApplication, HeldQuote, PremiumStatus } from "@/boldpenguin/types";
import type { CarrierRow } from "@/crm/dataverse";
import { send } from "./api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "8px" },
  lob: { fontSize: "12px", fontWeight: 600, marginTop: "4px" },
  card: {
    display: "flex", flexDirection: "column", gap: "4px", padding: "6px 8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: "4px", fontSize: "12px"
  },
  off: { opacity: 0.55 },
  head: { display: "flex", alignItems: "center", gap: "6px" },
  name: { flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  premium: { fontWeight: 600, whiteSpace: "nowrap" },
  meta: { color: tokens.colorNeutralForeground3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  controls: { display: "flex", gap: "6px", alignItems: "center" },
  select: { flex: 1, minWidth: 0, fontSize: "12px", padding: "2px 4px" },
  status: { fontSize: "12px", padding: "2px 4px" },
  issue: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  empty: { fontSize: "12px", color: tokens.colorNeutralForeground3 }
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The CRM carrier whose name best matches the source's carrier name
 * ("Liberty Mutual (Formerly Safeco)" -> "Liberty Mutual"). */
function guessCarrier(name: string, carriers: CarrierRow[]): string | null {
  const n = norm(name);
  const hit = carriers.find(c => norm(c.name) === n) ??
    carriers.find(c => n.startsWith(norm(c.name)) || norm(c.name).startsWith(n.split(" ").slice(0, 2).join(" ")));
  return hit?.carrierId ?? null;
}

/** Held quotes from every source, grouped by line of business: include,
 * CRM carrier and Firm/Estimated are set here before loading into CRM. */
export function QuotesView({ app, onChange }: { app: CapturedApplication; onChange: (app: CapturedApplication) => void }) {
  const styles = useStyles();
  const [carriers, setCarriers] = useState<CarrierRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const quotes = app.quotes ?? [];

  const update = async (key: string, patch: { selected?: boolean; carrierId?: string | null; premiumStatus?: PremiumStatus }) => {
    try {
      onChange(await send<CapturedApplication>({ type: "panel/updateQuote", key, patch }));
    } catch (e) {
      setProblem(String((e as Error).message ?? e));
    }
  };

  useEffect(() => {
    void send<CarrierRow[]>({ type: "panel/getCarriers" }).then(async list => {
      setCarriers(list);
      // quotes without a CRM carrier get the best name match, once; one at a
      // time so the held capture is never written concurrently
      for (const q of quotes) {
        if (q.carrierId) continue;
        const id = guessCarrier(q.carrierName, list);
        if (id) await update(q.key, { carrierId: id });
      }
    }).catch(() => setCarriers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!quotes.length) {
    return <div className={styles.empty}>No quotes held. Ingest a quote results page.</div>;
  }
  const lobs = [...new Set(quotes.map(q => q.lob))];
  const card = (q: HeldQuote) => (
    <div key={q.key} className={`${styles.card} ${q.selected ? "" : styles.off}`}>
      <div className={styles.head}>
        <Checkbox checked={q.selected} onChange={(_, d) => void update(q.key, { selected: Boolean(d.checked) })} aria-label={`Include ${q.carrierName}`} />
        <span className={styles.name} title={q.carrierName}>{q.carrierName}{q.kind === "alternate" ? " (Alt)" : ""}</span>
        <span className={styles.premium}>{q.premium != null ? `$${q.premium.toFixed(2)}` : "No premium"}</span>
      </div>
      <Tooltip content={q.coverageSummary || "No coverage detail"} relationship="description" withArrow>
        <span className={styles.meta}>
          {[q.termMonths ? `${q.termMonths} mo` : "", q.source, q.coverageSummary.split("\n")[0] ?? ""].filter(Boolean).join(" · ")}
          {q.link && <> · <a href={q.link} target="_blank" rel="noreferrer">open</a></>}
        </span>
      </Tooltip>
      <div className={styles.controls}>
        <select
          className={styles.select}
          aria-label="CRM carrier"
          value={q.carrierId ?? ""}
          onChange={e => void update(q.key, { carrierId: e.target.value || null })}
        >
          <option value="">{carriers === null ? "Loading carriers…" : "CRM carrier: not set"}</option>
          {(carriers ?? []).map(c => <option key={c.carrierId} value={c.carrierId}>{c.name}</option>)}
        </select>
        <select
          className={styles.status}
          aria-label="Premium status"
          value={q.premiumStatus}
          onChange={e => void update(q.key, { premiumStatus: e.target.value as PremiumStatus })}
        >
          <option value="estimated">Estimated</option>
          <option value="firm">Firm</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className={styles.root}>
      {lobs.map(lob => (
        <div key={lob || "unknown"} className={styles.root}>
          <div className={styles.lob}>{lob || "Line of business not stated"} ({quotes.filter(q => q.lob === lob).length})</div>
          {quotes.filter(q => q.lob === lob).map(card)}
        </div>
      ))}
      {(app.quoteIssues ?? []).length > 0 && (
        <div>
          <div className={styles.lob}>No quote returned</div>
          {app.quoteIssues!.map((i, n) => <div key={n} className={styles.issue}>{i.lob}: {i.carrierName}: {i.message}</div>)}
        </div>
      )}
      {problem && <div className={styles.issue}>{problem}</div>}
    </div>
  );
}
