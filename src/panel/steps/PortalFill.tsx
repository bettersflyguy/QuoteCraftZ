import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Input, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import type { InsuredSearchRow } from "@/crm/dataverse";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import { exportCaptureToExcel } from "../downloadCapture";
import { LoadToCrm } from "./LoadToCrm";
import type { CaptureUpdatedBroadcast, CapturedApplication, PageContext, PortalFillResult } from "@/messages";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  title: { fontSize: "14px", fontWeight: 600 },
  hint: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  ready: { fontSize: "13px", fontWeight: 600 },
  result: {
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "8px"
  },
  buttons: { display: "flex", gap: "8px", flexWrap: "wrap" },
  fieldList: {
    maxHeight: "220px",
    overflowY: "auto",
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "6px 8px",
    display: "flex",
    flexDirection: "column",
    gap: "2px"
  },
  fieldSection: { fontWeight: 600, color: tokens.colorNeutralForeground3, fontSize: "11px", marginTop: "4px" },
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
  row: { display: "flex", gap: "6px" },
  grow: { flex: 1, minWidth: 0 },
  fieldRow: { display: "flex", gap: "6px", minWidth: 0 },
  fieldLabel: { color: tokens.colorNeutralForeground3, flexShrink: 0, maxWidth: "45%", overflowWrap: "anywhere" },
  fieldValue: { minWidth: 0, overflowWrap: "anywhere" }
});

interface IngestOutcome { added: number; total: number; app: CapturedApplication; replaced: boolean }

function businessName(app: CapturedApplication | null): string | null {
  const name = app?.normalized["business"]?.["legalName"] ?? app?.normalized["contact"]?.["fullName"];
  return typeof name === "string" && name ? name : null;
}

/** Requests access to the active tab's origin (user gesture required — that's
 * why this lives in the panel) and returns the tab. Portals aren't in the
 * manifest's host list; each site is granted individually at click time. */
async function grantActiveTab(): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https:/i.test(tab.url)) {
    throw new PanelError("session", "The active tab is not a readable page. Open the carrier portal, then retry.");
  }
  const origin = `${new URL(tab.url).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new PanelError("session", "Access to this site was declined — nothing was read or filled.");
  }
  return { id: tab.id, url: tab.url };
}

/** Carrier-portal mode: the active tab is neither EZLynx, Bold Penguin, nor the
 * CRM. Ingest reads the visible insured data on this page into the held
 * application; Fill writes the held application into this page's form. */
export function PortalFill({ onChanged }: { onChanged: () => void }) {
  const styles = useStyles();
  const [app, setApp] = useState<CapturedApplication | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [fillResult, setFillResult] = useState<PortalFillResult | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestOutcome | null>(null);

  const [autoCap, setAutoCap] = useState(false);
  const [live, setLive] = useState<CaptureUpdatedBroadcast | null>(null);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmQuery, setCrmQuery] = useState("");
  const [crmRows, setCrmRows] = useState<InsuredSearchRow[] | null>(null);
  const [crmNote, setCrmNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    send<PageContext>({ type: "panel/getPageContext" }).then(c => setAutoCap(c.autoCapturing)).catch(() => {});
    // live merges from the auto-capture driver while the agent works the site
    const onMsg = (m: unknown) => {
      const b = m as CaptureUpdatedBroadcast;
      if (b?.type === "portal/captureUpdated") {
        setLive(b);
        refresh();
        onChanged();
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAutoCap = async () => {
    setBusy("autocap");
    setError(null);
    try {
      const tab = await grantActiveTab();
      await send({ type: "panel/autoCapture", tabId: tab.id, enable: !autoCap });
      setAutoCap(!autoCap);
      if (autoCap) setLive(null);
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: "fill" | "ingest") => {
    setBusy(kind);
    setError(null);
    setFillResult(null);
    setIngestResult(null);
    try {
      const tab = await grantActiveTab();
      if (kind === "fill") {
        setFillResult(await send<PortalFillResult>({ type: "panel/portalFill", tabId: tab.id, overwrite }));
      } else {
        const outcome = await send<IngestOutcome>({ type: "panel/portalIngest", tabId: tab.id });
        setIngestResult(outcome);
        setApp(outcome.app);
        onChanged();
      }
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const crmSearch = async () => {
    setBusy("crm");
    setError(null);
    try {
      setCrmRows(await send<InsuredSearchRow[]>({ type: "panel/crmSearch", query: crmQuery.trim() }));
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const crmPull = async (row: InsuredSearchRow) => {
    setBusy(row.id);
    setError(null);
    try {
      const outcome = await send<IngestOutcome>({ type: "panel/crmPull", kind: row.kind, id: row.id, name: row.name });
      setApp(outcome.app);
      setCrmNote(
        `${outcome.replaced ? "Started a fresh application from" : "Merged"} ${row.name}: ` +
        `${outcome.added} field${outcome.added === 1 ? "" : "s"} from the CRM (${outcome.total} held). Ready to fill this quote sheet.`
      );
      setCrmOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    await send({ type: "panel/bpClear" }).catch(() => {});
    setApp(null);
    setFillResult(null);
    setIngestResult(null);
    onChanged();
  };

  const name = businessName(app);

  return (
    <div className={styles.root}>
      <div className={styles.title}>Carrier portal</div>
      {app
        ? <div className={styles.ready}>{name ?? "Application ready"} — {app.fields.length} field{app.fields.length === 1 ? "" : "s"} held</div>
        : <div className={styles.hint}>
            Nothing captured yet. Ingest this page to pull the insured data shown
            here, or capture a completed application in Bold Penguin.
          </div>}
      {error && <ErrorBar error={error} />}
      <div className={styles.buttons}>
        <Button appearance={autoCap ? "secondary" : "primary"} disabled={busy !== null} onClick={toggleAutoCap}>
          {busy === "autocap" ? <Spinner size="tiny" /> : autoCap ? "Stop auto-capture" : "Auto-capture as I work"}
        </Button>
        <Button disabled={busy !== null} onClick={() => run("ingest")}>
          {busy === "ingest" ? <Spinner size="tiny" /> : "Ingest this page"}
        </Button>
        <Button appearance="primary" disabled={busy !== null || !app} onClick={() => run("fill")}>
          {busy === "fill" ? <Spinner size="tiny" /> : "Fill this page"}
        </Button>
        <Button disabled={busy !== null} onClick={() => { setCrmOpen(v => !v); setCrmNote(null); }}>
          Fill from CRM…
        </Button>
      </div>
      {crmOpen && (
        <>
          <div className={styles.row}>
            <Input
              className={styles.grow}
              value={crmQuery}
              onChange={(_, d) => setCrmQuery(d.value)}
              onKeyDown={e => { if (e.key === "Enter" && crmQuery.trim()) void crmSearch(); }}
              placeholder="Search accounts and contacts"
            />
            <Button disabled={busy !== null || !crmQuery.trim()} onClick={crmSearch}>
              {busy === "crm" ? <Spinner size="tiny" /> : "Search"}
            </Button>
          </div>
          {crmRows?.map(r => (
            <div key={`${r.kind}:${r.id}`} className={styles.match}>
              <span className={styles.matchText}>
                <b>{r.kind === "account" ? "Account" : "Contact"}</b> — {r.name}
                {r.city ? `, ${r.city}` : ""}{r.postalCode ? ` ${r.postalCode}` : ""}
              </span>
              <Button size="small" disabled={busy !== null} onClick={() => crmPull(r)}>
                {busy === r.id ? <Spinner size="tiny" /> : "Use"}
              </Button>
            </div>
          ))}
          {crmRows && crmRows.length === 0 && <div className={styles.hint}>No matching accounts or contacts.</div>}
        </>
      )}
      {crmNote && <div className={styles.result}>{crmNote}</div>}
      {autoCap && (
        <div className={styles.result}>
          Auto-capturing this tab — every page you visit is read and merged
          automatically (still never clicks or types).
          {live && (
            <> {live.replaced
              ? " New person detected — started a fresh capture."
              : ` Last page added ${live.added} field${live.added === 1 ? "" : "s"} (${live.total} held).`}</>
          )}
        </div>
      )}
      {app && (
        <div className={styles.fieldList}>
          {[...new Set(app.fields.map(f => f.section))].map(section => (
            <div key={section}>
              <div className={styles.fieldSection}>{section}</div>
              {app.fields.filter(f => f.section === section).map((f, i) => (
                <div key={`${f.label}:${i}`} className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{f.group ? `${f.group} — ` : ""}{f.label}</span>
                  <span className={styles.fieldValue}>{f.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {app && (
        <Checkbox
          checked={overwrite}
          onChange={(_, d) => setOverwrite(Boolean(d.checked))}
          label="Fill: overwrite fields that already have values"
        />
      )}
      {ingestResult && (
        <div className={styles.result}>
          {ingestResult.replaced && (
            <>This page belongs to a <b>different person</b> than the previous capture — started a fresh one (the old capture was discarded, not mixed in). </>
          )}
          Ingested {ingestResult.added} new field{ingestResult.added === 1 ? "" : "s"} from this page
          ({ingestResult.total} held in total). Switch to the next portal or rater and fill from it.
        </div>
      )}
      {fillResult && (
        <div className={styles.result}>
          Filled {fillResult.filledCount} of {fillResult.controlCount} form fields
          {fillResult.existingCount ? `; ${fillResult.existingCount} kept their existing values` : ""}
          {fillResult.optionMismatchCount ? `; ${fillResult.optionMismatchCount} had no matching option` : ""}.
          {fillResult.filledCount ? " Review the highlighted values before moving on." : " Move to the portal page that shows the application form and retry."}
        </div>
      )}
      {app && <LoadToCrm key={app.capturedAt} app={app} />}
      {app && (
        <div className={styles.buttons}>
          <Button onClick={() => exportCaptureToExcel(app)}>Export to Excel</Button>
          <Button onClick={clear}>Clear captured application</Button>
        </div>
      )}
    </div>
  );
}
