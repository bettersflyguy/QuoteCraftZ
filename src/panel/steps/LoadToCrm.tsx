import { useState } from "react";
import { Button, Input, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { CapturedApplication } from "@/messages";
import type { AccountMatch, BatchItemResult } from "@/crm/dataverse";
import { accountNameFromCapture, applicantFromCapture } from "@/crm/appCommit";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: "10px"
  },
  title: { fontSize: "13px", fontWeight: 600 },
  hint: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  row: { display: "flex", gap: "6px" },
  match: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "6px 8px"
  },
  matchText: { minWidth: 0, overflowWrap: "anywhere" },
  result: { fontSize: "12px" },
  resultErr: { fontSize: "12px", color: tokens.colorStatusDangerForeground1 }
});

/** Loads the held captured application into the active CRM environment:
 * pick or create the insured Account, then enrichment + risk-data logging
 * run in the worker (panel/appCommit). Shared by the Bold Penguin capture
 * card and the carrier-portal card. */
export function LoadToCrm({ app }: { app: CapturedApplication }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(accountNameFromCapture(app));
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);
  const [loadedInto, setLoadedInto] = useState<string | null>(null);

  const asPanelError = (e: unknown) =>
    e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e));

  const search = async () => {
    setBusy("search");
    setError(null);
    try {
      const postal = applicantFromCapture(app).address?.postalCode ?? null;
      setMatches(await send<AccountMatch[]>({ type: "panel/searchAccounts", name: query, postalCode: postal || null }));
    } catch (e) {
      setError(asPanelError(e));
    } finally {
      setBusy(null);
    }
  };

  const commit = async (accountId: string, accountName: string) => {
    setBusy(accountId);
    setError(null);
    try {
      setResults(await send<BatchItemResult[]>({ type: "panel/appCommit", accountId }));
      setLoadedInto(accountName);
    } catch (e) {
      setError(asPanelError(e));
    } finally {
      setBusy(null);
    }
  };

  const createAndCommit = async () => {
    setBusy("create");
    setError(null);
    try {
      const a = applicantFromCapture(app);
      const created = await send<{ accountId: string; name: string }>({
        type: "panel/createAccount",
        fields: {
          name: query.trim() || accountNameFromCapture(app),
          street: a.address?.street ?? null,
          city: a.address?.city ?? null,
          state: a.address?.state ?? null,
          postalCode: a.address?.postalCode ?? null,
          phone: a.phones[0]?.number ?? null,
          email: a.emails[0] ?? null
        }
      });
      await commit(created.accountId, created.name);
    } catch (e) {
      setError(asPanelError(e));
      setBusy(null);
    }
  };

  if (results) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Loaded into {loadedInto}</div>
        {results.map(r => (
          <div key={r.key} className={r.error ? styles.resultErr : styles.result}>
            {r.error ? `${r.key}: ${r.error}` : r.key}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {!open && (
        <Button appearance="primary" onClick={() => { setOpen(true); void search(); }}>
          Load into CRM ({app.fields.length} fields)
        </Button>
      )}
      {open && (
        <>
          <div className={styles.title}>Load into CRM — pick the insured</div>
          {error && <ErrorBar error={error} onRetry={search} />}
          <div className={styles.row}>
            <Input
              style={{ flex: 1, minWidth: 0 }}
              value={query}
              onChange={(_, d) => setQuery(d.value)}
              onKeyDown={e => { if (e.key === "Enter") void search(); }}
              placeholder="Account name"
            />
            <Button disabled={busy !== null} onClick={search}>
              {busy === "search" ? <Spinner size="tiny" /> : "Search"}
            </Button>
          </div>
          {matches?.map(m => (
            <div key={m.accountId} className={styles.match}>
              <span className={styles.matchText}>
                {m.name}{m.city ? ` — ${m.city}` : ""}{m.postalCode ? ` ${m.postalCode}` : ""}
              </span>
              <Button size="small" disabled={busy !== null} onClick={() => commit(m.accountId, m.name)}>
                {busy === m.accountId ? <Spinner size="tiny" /> : "Load"}
              </Button>
            </div>
          ))}
          {matches && matches.length === 0 && <div className={styles.hint}>No matching accounts.</div>}
          {matches && (
            <Button disabled={busy !== null} onClick={createAndCommit}>
              {busy === "create" ? <Spinner size="tiny" /> : `Create "${query.trim() || accountNameFromCapture(app)}" and load`}
            </Button>
          )}
          <div className={styles.hint}>
            Loading fills empty insured-profile fields, finds or creates the
            contact, and logs every captured field to the risk-data tables.
            Agent-entered CRM data is never overwritten.
          </div>
        </>
      )}
    </div>
  );
}
