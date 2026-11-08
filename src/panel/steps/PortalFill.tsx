import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Checkbox, Input, Spinner, Tab, TabList, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownloadRegular, DatabaseArrowDownRegular, EyeFilled, EyeRegular, FormRegular, LockClosedRegular, NotepadRegular, RecordRegular, RecordStopRegular } from "@fluentui/react-icons";
import type { InsuredSearchRow } from "@/crm/dataverse";
import { grantActiveTab } from "../portalAccess";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import { exportCaptureToExcel } from "../downloadCapture";
import { LoadToCrm } from "./LoadToCrm";
import { QuotesView } from "../QuotesView";
import type { CaptureUpdatedBroadcast, CapturedApplication, CrmLink, PageContext, PortalFillResult } from "@/messages";
import { getActiveEnvironment, crmRecordUrl, type CrmEnvironment } from "@/crm/environments";
import { isGridRow } from "@/boldpenguin/normalize";
import { NOTE_TARGETS, isNoteTarget } from "@/portal/fieldMaps";

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
  // spreadsheet-style capture grid: sticky header, cell borders, zebra rows
  grid: {
    maxHeight: "260px",
    overflow: "auto",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "2px"
  },
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "12px" },
  th: {
    position: "sticky", top: 0, zIndex: 1, textAlign: "left", fontWeight: 600,
    padding: "3px 6px", backgroundColor: tokens.colorNeutralBackground4,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`, borderRight: `1px solid ${tokens.colorNeutralStroke2}`
  },
  groupCell: {
    padding: "3px 6px", fontWeight: 600, fontSize: "11px", color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
  },
  td: {
    padding: "2px 6px", verticalAlign: "top", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, borderRight: `1px solid ${tokens.colorNeutralStroke2}`
  },
  zebra: { backgroundColor: tokens.colorNeutralBackground2 },
  gridTitle: { fontSize: "12px", fontWeight: 600, marginBottom: "4px" },
  notesBlock: {
    display: "flex", flexDirection: "column", gap: "8px", padding: "8px",
    border: `1px dashed ${tokens.colorNeutralStroke1}`, borderRadius: "4px"
  },
  notesTitle: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600 },
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


/** Captured data grids (fields grouped "Row N") rebuilt as tables: the
 * grid's own column headers, one line per row, in page order. */
interface GridTable { title: string; label?: string; columns: string[]; rows: Record<string, string>[] }

function gridTables(fields: CapturedApplication["fields"]): GridTable[] {
  const out = new Map<string, { columns: string[]; rows: Map<string, Record<string, string>> }>();
  for (const f of fields) {
    if (!isGridRow(f)) continue;
    const t = out.get(f.section) ?? out.set(f.section, { columns: [], rows: new Map() }).get(f.section)!;
    if (!t.columns.includes(f.label)) t.columns.push(f.label);
    const row = t.rows.get(f.group) ?? t.rows.set(f.group, {}).get(f.group)!;
    row[f.label] = f.value;
  }
  return [...out.entries()].map(([title, t]) => ({ title, columns: t.columns, rows: [...t.rows.values()] }));
}

/** Icon-only action with its description as the hover tooltip. Disabled
 * actions stay hoverable so the tooltip still says why/what. */
function ActionIcon({ tip, icon, onClick, disabled, active }: {
  tip: string; icon: ReactElement; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <Tooltip content={tip} relationship="label" withArrow>
      <Button
        icon={icon}
        appearance={active ? "primary" : "secondary"}
        disabledFocusable={disabled}
        onClick={disabled ? undefined : onClick}
      />
    </Tooltip>
  );
}

/** Carrier-portal mode (the active tab is neither EZLynx, Bold Penguin, nor
 * the CRM): Ingest reads the visible insured data into the held application;
 * Fill writes it into this page's form. Mapping lives on its own page (the
 * settings menu), never inline with these actions. */
export function PortalFill({ onChanged, onFlowActive }: {
  onChanged: () => void;
  onFlowActive?: (active: boolean) => void;
}) {
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
  // move between the captured data and the quotes held for import
  const [view, setView] = useState<"data" | "quotes">("data");
  // "peek unmapped": red outlines on the page for what no mapping covers
  const [peekUnmapped, setPeekUnmapped] = useState(false);
  const [peekCount, setPeekCount] = useState<number | null>(null);
  const peekTabRef = useRef<number | null>(null);
  const togglePeekUnmapped = async () => {
    if (peekUnmapped) {
      const tabId = peekTabRef.current;
      setPeekUnmapped(false);
      setPeekCount(null);
      peekTabRef.current = null;
      if (tabId !== null) await send({ type: "panel/portalPeekUnmapped", tabId, on: false }).catch(() => {});
      return;
    }
    setBusy("peek");
    setError(null);
    try {
      const tab = await grantActiveTab(setAwaitingGrant);
      const r = await send<{ shown: number }>({ type: "panel/portalPeekUnmapped", tabId: tab.id, on: true });
      peekTabRef.current = tab.id;
      setPeekCount(r.shown);
      setPeekUnmapped(true);
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };
  // outlines never outlive this screen
  useEffect(() => () => {
    const tabId = peekTabRef.current;
    if (tabId !== null) void send({ type: "panel/portalPeekUnmapped", tabId, on: false }).catch(() => {});
  }, []);
  const [crmQuery, setCrmQuery] = useState("");
  const [crmRows, setCrmRows] = useState<InsuredSearchRow[] | null>(null);
  const [crmNote, setCrmNote] = useState<string | null>(null);
  const [crmLink, setCrmLink] = useState<CrmLink | null>(null);
  const [env, setEnv] = useState<CrmEnvironment | null>(null);
  const [loadFlow, setLoadFlow] = useState(false);

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

  // secured values held for the CRM: masked, never part of the capture
  const [secureHeld, setSecureHeld] = useState<{ path: string; label: string; masked: string }[]>([]);
  const refresh = useCallback(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
    send<CrmLink | null>({ type: "panel/getCrmLink" }).then(setCrmLink).catch(() => {});
    send<{ path: string; label: string; masked: string }[]>({ type: "panel/securePending" }).then(setSecureHeld).catch(() => {});
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
        refresh();
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
    setSecureHeld([]);
    setFillResult(null);
    setIngestResult(null);
    onChanged();
  };

  const name = businessName(app);
  // values tagged for a timeline note show apart from the regular capture
  const noteFields = app ? app.fields.filter(f => isNoteTarget(f.mapped)) : [];
  const regular = app ? app.fields.filter(f => !isNoteTarget(f.mapped)) : [];
  const renderGrid = (t: GridTable) => (
    <div key={t.title}>
      {t.label !== "Notes" && <div className={styles.gridTitle}>{t.title} ({t.rows.length} row{t.rows.length === 1 ? "" : "s"})</div>}
      <div className={styles.grid}>
        <table className={styles.table} style={{ tableLayout: "auto", minWidth: "100%" }}>
          <thead>
            <tr>{t.columns.map(c => <th key={c} className={styles.th}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i} className={i % 2 ? styles.zebra : undefined}>
                {t.columns.map(c => (
                  <td key={c} className={styles.td} style={{ maxWidth: 180 }} title={row[c] ?? ""}>{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className={styles.root}>
      <div className={styles.buttons}>
        <ActionIcon
          tip={autoCap ? "Stop auto-capture" : "Auto-capture as I work: reads every page you visit into the capture"}
          icon={busy === "autocap" ? <Spinner size="tiny" /> : autoCap ? <RecordStopRegular /> : <RecordRegular />}
          active={autoCap}
          disabled={busy !== null}
          onClick={toggleAutoCap}
        />
        <ActionIcon
          tip="Ingest this page: reads the insured data shown here"
          icon={busy === "ingest" ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
          disabled={busy !== null}
          onClick={() => run("ingest")}
        />
        <ActionIcon
          tip={app ? "Fill this page from the capture" : "Fill this page (capture or ingest something first)"}
          icon={busy === "fill" ? <Spinner size="tiny" /> : <FormRegular />}
          disabled={busy !== null || !app}
          onClick={() => run("fill")}
        />
        <ActionIcon
          tip="Fill from CRM: pick an insured to fill this page"
          icon={<DatabaseArrowDownRegular />}
          active={crmOpen}
          disabled={busy !== null}
          onClick={() => { setCrmOpen(v => !v); setCrmNote(null); }}
        />
        <Tooltip
          content={peekUnmapped
            ? `${peekCount ?? 0} unmapped field${peekCount === 1 ? "" : "s"} outlined in red. Click to hide.`
            : "Peek unmapped fields: outline in red what no mapping covers"}
          relationship="label"
          withArrow
        >
          <Button
            style={{ marginLeft: "auto", color: "#d13438" }}
            appearance={peekUnmapped ? "outline" : "subtle"}
            icon={busy === "peek" ? <Spinner size="tiny" /> : peekUnmapped ? <EyeFilled /> : <EyeRegular />}
            disabledFocusable={busy !== null && busy !== "peek"}
            aria-pressed={peekUnmapped}
            onClick={busy !== null ? undefined : () => void togglePeekUnmapped()}
          />
        </Tooltip>
      </div>
      {app
        ? <div className={styles.ready}>
            {name ?? "Application ready"}: {app.fields.length} field{app.fields.length === 1 ? "" : "s"} held
            {crmLink && env && (
              <>
                {" · "}
                <a href={crmRecordUrl(env, crmLink.kind, crmLink.id)} target="_blank" rel="noreferrer">Open in CRM</a>
              </>
            )}
          </div>
        : <div className={styles.hint}>Nothing captured yet.</div>}
      {awaitingGrant && (
        <Text size={200} style={{ display: "block", marginTop: 6, fontWeight: 600 }}>
          Waiting for browser approval to access {awaitingGrant}. Look for the permission
          prompt (in Edge it is under the Extensions puzzle-piece icon next to the address bar) and click Allow.
        </Text>
      )}
      {error && <ErrorBar error={error} />}
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
                <b>{r.kind === "account" ? "Account" : "Contact"}</b>: {r.name}
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
      {autoCap && live?.replaced && (
        <div className={styles.result}>New person detected. Started a fresh capture.</div>
      )}      {app && (
        <TabList size="small" selectedValue={view} onTabSelect={(_, d) => setView(d.value as "data" | "quotes")}>
          <Tab value="data">Data ({app.fields.length})</Tab>
          <Tab value="quotes">Quotes ({(app.quotes ?? []).length})</Tab>
        </TabList>
      )}
      {app && view === "quotes" && <QuotesView app={app} onChange={setApp} />}
      {app && view === "data" && regular.some(f => !isGridRow(f)) && (
        <div className={styles.grid}>
          <table className={styles.table}>
            <colgroup><col style={{ width: "42%" }} /><col /></colgroup>
            <thead>
              <tr>
                <th className={styles.th}>Field</th>
                <th className={styles.th}>Value</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(regular.filter(f => !isGridRow(f)).map(f => f.section))].map(section => (
                <Fragment key={section}>
                  <tr>
                    <td colSpan={2} className={styles.groupCell}>
                      {section === "Insured profile" && crmLink && env ? (
                        <a href={crmRecordUrl(env, crmLink.kind, crmLink.id)} target="_blank" rel="noreferrer"
                          title="Open this insured's CRM record in a new tab">
                          {section} ↗
                        </a>
                      ) : (section || "Page")}
                    </td>
                  </tr>
                  {regular.filter(f => f.section === section && !isGridRow(f)).map((f, i) => (
                    <tr key={`${f.label}:${i}`} className={i % 2 ? styles.zebra : undefined}>
                      <td className={styles.td} title={f.group ? `${f.group}: ${f.label}` : f.label}>
                        {f.group ? `${f.group}: ` : ""}{f.label}
                      </td>
                      <td className={styles.td} title={f.value}>{f.value}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {app && view === "data" && gridTables(regular).map(renderGrid)}
      {app && view === "data" && secureHeld.length > 0 && (
        <div>
          <div className={styles.gridTitle} title="Held in memory for this session only. Written to the secured CRM columns on load; never exported or noted.">
            <LockClosedRegular /> Secured ({secureHeld.length})
          </div>
          {renderGrid({ title: "secured", label: "Notes", columns: ["Field", "Value"], rows: secureHeld.map(s => ({ Field: s.label, Value: s.masked })) })}
        </div>
      )}
      {app && view === "data" && noteFields.length > 0 && (
        <div className={styles.notesBlock}>
          <div className={styles.notesTitle}><NotepadRegular /> Non Mapped Timeline Entries</div>
          {NOTE_TARGETS.filter(t => noteFields.some(f => f.mapped === t.value)).map(t => {
            const forRecord = noteFields.filter(f => f.mapped === t.value);
            const singles = forRecord.filter(f => !isGridRow(f));
            return (
              <div key={t.value}>
                <div className={styles.gridTitle}>On {t.label.replace(/^Notes: /, "")}</div>
                {singles.length > 0 && renderGrid({ title: `${t.value}:singles`, label: "Notes", columns: ["Field", "Value"], rows: singles.map(f => ({ Field: f.label, Value: f.value })) })}
                {gridTables(forRecord).map(renderGrid)}
              </div>
            );
          })}
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
          label="Auto-advance after fill (Next/Continue only; never submit, bind, or pay)"
        />
      )}
      {ingestResult && (
        <div className={styles.result}>
          {ingestResult.replaced && (
            <>This page belongs to a <b>different person</b> than the previous capture, so a fresh one was started (the old capture was discarded, not mixed in). </>
          )}
          Ingested {ingestResult.added} new field{ingestResult.added === 1 ? "" : "s"} ({ingestResult.total} held).
        </div>
      )}
      {fillResult && (
        <div className={styles.result}>
          Filled {fillResult.filledCount} of {fillResult.controlCount} form fields
          {fillResult.secure?.filled ? ` (${fillResult.secure.filled} secured)` : ""}
          {fillResult.existingCount ? `; ${fillResult.existingCount} kept their existing values` : ""}
          {fillResult.optionMismatchCount ? `; ${fillResult.optionMismatchCount} had no matching option` : ""}
          {fillResult.noData?.length ? `; ${fillResult.noData.length} mapped with no data` : ""}
          {fillResult.secure?.missing ? `; ${fillResult.secure.missing} secured with no value` : ""}.
          {fillResult.secure?.note && <div>{fillResult.secure.note}</div>}
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
