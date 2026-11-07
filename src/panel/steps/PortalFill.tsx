import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Input, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { InsuredSearchRow } from "@/crm/dataverse";
import type { PortalScanResult } from "@/boldpenguin/types";
import { MAP_PATHS, PATH_LABEL } from "@/portal/fieldMaps";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import { exportCaptureToExcel } from "../downloadCapture";
import { LoadToCrm } from "./LoadToCrm";
import type { CaptureUpdatedBroadcast, CapturedApplication, CrmLink, PageContext, PortalFillResult } from "@/messages";
import { getActiveEnvironment, crmRecordUrl, type CrmEnvironment } from "@/crm/environments";

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
async function grantActiveTab(onAwaitingGrant?: (origin: string | null) => void): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https:/i.test(tab.url)) {
    throw new PanelError("session", "The active tab is not a readable page. Open the carrier portal, then retry.");
  }
  const origin = new URL(tab.url).origin;
  const already = await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);
  if (already) return { id: tab.id, url: tab.url };
  // first visit to this site: the browser shows a permission prompt (in Edge it
  // hides under the Extensions puzzle-piece icon) and this promise WAITS on it —
  // without the hint + timeout the panel looks dead until the prompt is found
  onAwaitingGrant?.(origin);
  try {
    const granted = await Promise.race([
      chrome.permissions.request({ origins: [`${origin}/*`] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new PanelError(
        "session",
        `The browser is waiting for you to allow access to ${origin}. Find the permission prompt — in Edge it is under the Extensions (puzzle-piece) icon next to the address bar — click Allow, then retry.`
      )), 25000))
    ]);
    if (!granted) {
      throw new PanelError("session", "Access to this site was declined — nothing was read or filled.");
    }
  } finally {
    onAwaitingGrant?.(null);
  }
  return { id: tab.id, url: tab.url };
}

/** Carrier-portal mode: the active tab is neither EZLynx, Bold Penguin, nor the
 * CRM. Ingest reads the visible insured data on this page into the held
 * application; Fill writes the held application into this page's form. */
export function PortalFill({ onChanged, onFlowActive }: { onChanged: () => void; onFlowActive?: (active: boolean) => void }) {
  const styles = useStyles();
  const [app, setApp] = useState<CapturedApplication | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [awaitingGrant, setAwaitingGrant] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [fillResult, setFillResult] = useState<PortalFillResult | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestOutcome | null>(null);

  const [autoCap, setAutoCap] = useState(false);
  const [live, setLive] = useState<CaptureUpdatedBroadcast | null>(null);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmQuery, setCrmQuery] = useState("");
  const [crmRows, setCrmRows] = useState<InsuredSearchRow[] | null>(null);
  const [crmNote, setCrmNote] = useState<string | null>(null);
  const [crmLink, setCrmLink] = useState<CrmLink | null>(null);
  const [env, setEnv] = useState<CrmEnvironment | null>(null);
  const [loadFlow, setLoadFlow] = useState(false);
  const [mapScan, setMapScan] = useState<PortalScanResult | null>(null);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [mapNote, setMapNote] = useState<string | null>(null);

  useEffect(() => { getActiveEnvironment().then(setEnv).catch(() => {}); }, []);

  useEffect(() => {
    chrome.storage.local.get("portal/autoAdvance").then(s => {
      const v = s["portal/autoAdvance"];
      if (typeof v === "boolean") setAutoAdvance(v);
    }).catch(() => {});
  }, []);

  const toggleAdvance = (v: boolean) => {
    setAutoAdvance(v);
    void chrome.storage.local.set({ "portal/autoAdvance": v }).catch(() => {});
  };

  // combined pin signal: our own in-flight ops + the LoadToCrm flow
  useEffect(() => {
    onFlowActive?.(loadFlow || busy !== null || crmOpen);
    return () => onFlowActive?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFlow, busy, crmOpen]);

  const refresh = useCallback(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
    send<CrmLink | null>({ type: "panel/getCrmLink" }).then(setCrmLink).catch(() => {});
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
      const tab = await grantActiveTab(setAwaitingGrant);
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
      const tab = await grantActiveTab(setAwaitingGrant);
      if (kind === "fill") {
        setFillResult(await send<PortalFillResult>({ type: "panel/portalFill", tabId: tab.id, overwrite, autoAdvance }));
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

  const openMapper = async () => {
    setBusy("map");
    setError(null);
    setMapNote(null);
    try {
      const tab = await grantActiveTab(setAwaitingGrant);
      const scan = await send<PortalScanResult>({ type: "panel/portalScan", tabId: tab.id });
      const draft: Record<string, string> = {};
      for (const r of scan.rows) draft[r.key] = r.mapped ?? "";
      setMapDraft(draft);
      setMapScan(scan);
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const saveMapping = async () => {
    if (!mapScan) return;
    setBusy("map-save");
    setError(null);
    try {
      const map: Record<string, string> = {};
      for (const [key, v] of Object.entries(mapDraft)) if (v) map[key] = v;
      await send({ type: "panel/saveFieldMap", origin: mapScan.origin, map });
      const n = Object.keys(map).length;
      setMapNote(n
        ? `Saved ${n} mapping${n === 1 ? "" : "s"} for ${mapScan.origin}. Fill uses them on this site from now on.`
        : `Cleared the saved mappings for ${mapScan.origin} — Fill is back to automatic matching.`);
      setMapScan(null);
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
      setCrmLink({ kind: row.kind, id: row.id, name: row.name });
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
        ? <div className={styles.ready}>
            {name ?? "Application ready"} — {app.fields.length} field{app.fields.length === 1 ? "" : "s"} held
            {crmLink && env && (
              <>
                {" · "}
                <a href={crmRecordUrl(env, crmLink.kind, crmLink.id)} target="_blank" rel="noreferrer">Open in CRM</a>
              </>
            )}
          </div>
        : <div className={styles.hint}>
            Nothing captured yet. Ingest this page to pull the insured data shown
            here, or capture a completed application in Bold Penguin.
          </div>}
      {awaitingGrant && (
        <Text size={200} style={{ display: "block", marginTop: 6, fontWeight: 600 }}>
          Waiting for browser approval to access {awaitingGrant} — look for the permission
          prompt (in Edge it is under the Extensions puzzle-piece icon next to the address bar) and click Allow.
        </Text>
      )}
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
        <Button disabled={busy !== null} onClick={() => (mapScan ? setMapScan(null) : void openMapper())}>
          {busy === "map" ? <Spinner size="tiny" /> : mapScan ? "Close mapping" : "Map fields…"}
        </Button>
      </div>
      {mapScan && (
        <div className={styles.result}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Field mapping for {mapScan.origin} — teach once, used on every fill of this site.
          </div>
          {mapScan.rows.map(r => (
            <div key={r.key} className={styles.fieldRow} style={{ alignItems: "center", marginBottom: 4 }}>
              <span className={styles.fieldLabel} title={r.key}>{r.label}</span>
              {r.payment
                ? <span className={styles.fieldValue}>payment field — never filled</span>
                : (
                  <select
                    className={styles.grow}
                    value={mapDraft[r.key] ?? ""}
                    onChange={e => setMapDraft(d => ({ ...d, [r.key]: e.target.value }))}
                  >
                    <option value="">{r.autoPath ? `Auto (${PATH_LABEL.get(r.autoPath) ?? r.autoPath})` : "Auto (no match)"}</option>
                    <option value="skip">Never fill</option>
                    {MAP_PATHS.map(p => <option key={p.path} value={p.path}>{p.label}</option>)}
                  </select>
                )}
            </div>
          ))}
          <div className={styles.row} style={{ marginTop: 6 }}>
            <Button appearance="primary" size="small" disabled={busy !== null} onClick={saveMapping}>
              {busy === "map-save" ? <Spinner size="tiny" /> : "Save mapping"}
            </Button>
            <Button size="small" disabled={busy !== null} onClick={() => setMapScan(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {mapNote && <div className={styles.result}>{mapNote}</div>}
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
              {section === "Insured profile" && crmLink && env ? (
                <a
                  className={styles.fieldSection}
                  style={{ display: "block", textDecoration: "underline", cursor: "pointer" }}
                  href={crmRecordUrl(env, crmLink.kind, crmLink.id)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open this insured's CRM record in a new tab"
                >
                  {section} — open in CRM ↗
                </a>
              ) : (
                <div className={styles.fieldSection}>{section}</div>
              )}
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
      {app && (
        <Checkbox
          checked={autoAdvance}
          onChange={(_, d) => toggleAdvance(Boolean(d.checked))}
          label="Auto-advance after fill (Next/Continue only — never submit, bind, or pay)"
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
      {app && <LoadToCrm key={app.capturedAt} app={app} onFlowActive={setLoadFlow} onLoaded={refresh} />}
      {app && (
        <div className={styles.buttons}>
          <Button onClick={() => exportCaptureToExcel(app)}>Export to Excel</Button>
          <Button onClick={clear}>Clear captured application</Button>
        </div>
      )}
    </div>
  );
}
