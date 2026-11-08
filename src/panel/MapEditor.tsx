import { useEffect, useMemo, useRef, useState } from "react";
import { CursorClickRegular, EyeFilled, EyeRegular, StopRegular } from "@fluentui/react-icons";
import { TargetPicker } from "./TargetPicker";
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import type { PeekItem, PeekResult, PortalScanResult, PortalScanRow } from "@/boldpenguin/types";
import { MAP_PATH_GROUPS, PATH_LABEL, isArrayPath } from "@/portal/fieldMaps";
import { catalogLabel, type FieldCatalog } from "@/crm/fieldCatalog";
import { send } from "./api";

type OptionGroup = { group: string; paths: { path: string; label: string }[] };

/** Capture targets: every core column of each CRM entity (live metadata, in
 * hierarchy order) plus the semantic risk-data groups that have no CRM table
 * (building, payroll, vehicles). Without a catalog (not signed in), the
 * built-in semantic vocabulary stands in. */
function captureGroups(catalog: FieldCatalog | null): OptionGroup[] {
  const riskData = MAP_PATH_GROUPS.filter(g => /risk data/.test(g.group));
  if (!catalog?.entities.length) return MAP_PATH_GROUPS;
  const crm = catalog.entities.map(e => ({
    group: e.label,
    paths: e.columns.map(c => ({ path: `crm:${e.key}${e.array ? "[]" : ""}.${c.name}`, label: c.label }))
  }));
  return [...crm, ...riskData];
}

/** Array targets ("Related contacts - all rows") are capture-only: a fill
 * can't know which row a single control belongs to. */
const FILL_GROUPS = MAP_PATH_GROUPS
  .map(g => ({ ...g, paths: g.paths.filter(p => !isArrayPath(p.path)) }))
  .filter(g => g.paths.length > 0);

const useStyles = makeStyles({
  root: {
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "6px 8px"
  },
  row: { display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px", minWidth: 0 },
  rowFocused: {
    display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px", minWidth: 0,
    backgroundColor: tokens.colorBrandBackground2,
    outline: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: "3px",
    padding: "2px"
  },
  label: { color: tokens.colorNeutralForeground3, flexShrink: 0, maxWidth: "45%", overflowWrap: "anywhere" },
  select: { flex: 1, minWidth: 0 },
  actions: { display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }
});

/** One captured-field target: binds a control to whatever the capture holds
 * under that label - this is how 2nd drivers, extra vehicles, garaging
 * addresses and any other repeated record reach a quote form. */
export interface CapturedTarget { value: string; label: string }

export function capturedTargets(fields: { label: string }[] | undefined): CapturedTarget[] {
  const seen = new Map<string, string>();
  for (const f of fields ?? []) {
    const canon = String(f.label).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
      .replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (canon && canon.length <= 100 && !seen.has(canon)) seen.set(canon, f.label);
  }
  return [...seen.entries()].map(([canon, label]) => ({ value: `label:${canon}`, label }));
}

export function MapEditor({ scan, draft, setDraft, captured, busy, onSave, onCancel, onPick, onPickCancel, onPeek }: {
  scan: PortalScanResult;
  draft: Record<string, string>;
  setDraft: (updater: (d: Record<string, string>) => Record<string, string>) => void;
  captured: CapturedTarget[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Arms the on-page click-to-identify picker for one ~20s round; resolves
   * with the clicked field's row, "timeout" (nothing yet - re-arm), or null
   * (user cancelled on the page with Esc). */
  onPick?: () => Promise<PortalScanRow | "timeout" | null>;
  /** Resolves a pending pick immediately (the Stop button). */
  onPickCancel?: () => Promise<unknown>;
  /** Outlines the mapped fields on the page (null clears). */
  onPeek?: (items: PeekItem[] | null) => Promise<PeekResult>;
}) {
  const styles = useStyles();
  const capturedValues = new Set(captured.map(c => c.value));
  const [picking, setPicking] = useState(false);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // picked controls the scan missed (dynamically added fields, shadow DOM)
  // still get a row so they can be mapped
  const [extraRows, setExtraRows] = useState<PortalScanRow[]>([]);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [catalogNote, setCatalogNote] = useState<string | null>(null);

  const loadCatalog = async (refresh: boolean) => {
    setCatalogNote(refresh ? "Refreshing CRM fields…" : null);
    try {
      const c = await send<FieldCatalog>({ type: "panel/crmFieldCatalog", refresh });
      setCatalog(c);
      setCatalogNote(c.entities.length ? null : "CRM fields unavailable. Showing built-in targets.");
    } catch {
      setCatalogNote("CRM fields unavailable (sign in to the CRM). Showing built-in targets.");
    }
  };
  useEffect(() => { void loadCatalog(false); }, []);
  const groups = useMemo(() => captureGroups(catalog), [catalog]);
  const groupValues = useMemo(() => new Set(groups.flatMap(g => g.paths.map(p => p.path))), [groups]);
  const fillGroups = useMemo<OptionGroup[]>(() => captured.length
    ? [...FILL_GROUPS, { group: "Captured fields (drivers, vehicles, extra records…)", paths: captured.map(c => ({ path: c.value, label: c.label })) }]
    : FILL_GROUPS, [captured]);

  useEffect(() => {
    if (!focusKey) return;
    rowRefs.current.get(focusKey)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusKey]);

  const stopRequested = useRef(false);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const reveal = (key: string) => setRevealed(s => (s.has(key) ? s : new Set(s).add(key)));
  /** Setting a target keeps the row listed even if it's reset to Auto. */
  const setTarget = (key: string, value: string) => {
    reveal(key);
    setDraft(d => ({ ...d, [key]: value }));
  };

  const pick = async () => {
    if (!onPick || picking) return;
    setPicking(true);
    setPickNote(null);
    setFocusKey(null);
    stopRequested.current = false;
    try {
      // each page-side round lasts ~20s (kept under the message timeout);
      // "timeout" means nothing happened yet, so re-arm - up to ~3 minutes
      for (let round = 0; round < 9; round += 1) {
        const row = await onPick();
        if (row === "timeout") {
          if (stopRequested.current) break;
          continue;
        }
        if (!row) break; // Esc on the page, or Stop landed mid-round
        const known = scan.rows.some(r => r.key === row.key) || extraRows.some(r => r.key === row.key);
        if (!known) setExtraRows(x => [...x, row]);
        reveal(row.key);
        setFocusKey(row.key);
        return;
      }
      setPickNote("Nothing picked.");
    } catch (e) {
      setPickNote(String((e as Error).message ?? e));
    } finally {
      setPicking(false);
    }
  };

  const stopPick = () => {
    stopRequested.current = true;
    void onPickCancel?.().catch(() => {});
  };

  const allRows = [...scan.rows, ...extraRows.filter(x => !scan.rows.some(r => r.key === x.key))];
  // Only rows that mean something are listed: auto-matched, already mapped,
  // or picked/edited this session. Unknown page fields stay hidden until the
  // agent clicks them on the page - building a map beats scrolling a list
  // of anonymous "Select Row" checkboxes.
  const rows = allRows.filter(r =>
    showAll || revealed.has(r.key) || Boolean(r.autoPath) || Boolean(r.mapped) || Boolean(draft[r.key]));
  const hiddenCount = allRows.length - rows.length;

  /* peek: what the current (unsaved) draft covers, including hidden rows that
   * auto-match - so the page shows exactly what still needs mapping */
  const targetText = (v: string) =>
    PATH_LABEL.get(v) ?? catalogLabel(catalog, v) ??
    (v.startsWith("label:") ? (captured.find(c => c.value === v)?.label ?? v.slice(6)) : v);
  const peekItems: PeekItem[] = allRows.flatMap<PeekItem>(r => {
    const v = draft[r.key] ?? "";
    if (r.payment) return [];
    if (v === "skip") return [{ key: r.key, label: "Never fill", kind: "skip" }];
    if (v) return [{ key: r.key, label: targetText(v), kind: "mapped", array: isArrayPath(v) }];
    if (r.autoPath) return [{ key: r.key, label: `Auto: ${PATH_LABEL.get(r.autoPath) ?? r.autoPath}`, kind: "auto" }];
    return [];
  });
  const peekSignature = JSON.stringify(peekItems);
  const [peeking, setPeeking] = useState(false);
  const [peekNote, setPeekNote] = useState<string | null>(null);
  useEffect(() => {
    if (!peeking || !onPeek) return;
    let live = true;
    void onPeek(peekItems).then(r => {
      if (!live) return;
      setPeekNote(r.shown || r.missing
        ? `${r.shown} highlighted${r.missing ? `, ${r.missing} not on this page` : ""}.`
        : "Nothing mapped yet.");
    }).catch(e => { if (live) setPeekNote(String((e as Error).message ?? e)); });
    return () => { live = false; };
    // re-highlight whenever the draft's coverage changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peeking, peekSignature]);
  // highlights never outlive the editor (ref: parents pass a fresh closure
  // every render, which must not count as an unmount)
  const peekRef = useRef(onPeek);
  peekRef.current = onPeek;
  useEffect(() => () => { void peekRef.current?.(null).catch(() => {}); }, []);
  const togglePeek = () => {
    if (peeking) { setPeeking(false); setPeekNote(null); void onPeek?.(null).catch(() => {}); }
    else setPeeking(true);
  };
  return (
    <div className={styles.root}>
      <div className={styles.row} style={{ fontWeight: 600 }}>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>Field mapping for {scan.origin}</span>
        {onPick && (
          <Button
            size="small"
            appearance={picking ? "primary" : "subtle"}
            icon={picking ? <StopRegular /> : <CursorClickRegular />}
            disabled={busy}
            onClick={() => (picking ? stopPick() : void pick())}
            title={picking ? "Stop picking" : "Click a field on the page to map it"}
            aria-label={picking ? "Stop picking" : "Click a field on the page to map it"}
          />
        )}
      </div>
      {(picking || pickNote) && (
        <div className={styles.label} style={{ maxWidth: "none", marginBottom: 4 }}>
          {picking ? <><Spinner size="extra-tiny" style={{ display: "inline-flex", verticalAlign: "middle" }} /> Click a field on the page. Esc cancels.</> : pickNote}
        </div>
      )}
      {rows.map(r => {
        const current = draft[r.key] ?? "";
        const orphanLabel = current.startsWith("label:") && !capturedValues.has(current)
          ? current.slice(6) : null;
        return (
          <div
            key={r.key}
            className={focusKey === r.key ? styles.rowFocused : styles.row}
            ref={el => { if (el) rowRefs.current.set(r.key, el); else rowRefs.current.delete(r.key); }}
          >
            <span className={styles.label} title={r.key}>{r.label}</span>
            {r.payment
              ? <span>Payment field, never filled</span>
              : r.key.startsWith("pick:") ? (
                /* read-only text teaching: capture direction, CRM fields only */
                <TargetPicker
                  value={current}
                  onChange={v => setTarget(r.key, v)}
                  groups={groups}
                  specials={[{ value: "", label: "Not captured" }]}
                  currentText={current && !groupValues.has(current)
                    ? `${PATH_LABEL.get(current) ?? catalogLabel(catalog, current) ?? current} (saved)`
                    : undefined}
                  groupPrefix="Capture as: "
                />
              ) : (
                <TargetPicker
                  value={current}
                  onChange={v => setTarget(r.key, v)}
                  groups={fillGroups}
                  specials={[
                    { value: "", label: r.autoPath ? `Auto (${PATH_LABEL.get(r.autoPath) ?? r.autoPath})` : "Auto (no match)" },
                    { value: "skip", label: "Never fill" }
                  ]}
                  currentText={orphanLabel ? `${orphanLabel} (saved; not in current capture)` : undefined}
                />
              )}
          </div>
        );
      })}
      {(hiddenCount > 0 || showAll) && (
        <div className={styles.label} style={{ maxWidth: "none", marginTop: 4 }}>
          {showAll
            ? <a href="#" onClick={e => { e.preventDefault(); setShowAll(false); }}>Show only mapped fields</a>
            : <>
                {hiddenCount} unmapped field{hiddenCount === 1 ? "" : "s"} hidden.{" "}
                <a href="#" onClick={e => { e.preventDefault(); setShowAll(true); }}>Show all</a>
              </>}
        </div>
      )}
      <div className={styles.label} style={{ maxWidth: "none", marginTop: 4 }}>
        {catalogNote ?? (catalog
          ? <a href="#" onClick={e => { e.preventDefault(); void loadCatalog(true); }}>Refresh CRM fields</a>
          : "Loading CRM fields…")}
      </div>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy} onClick={onSave}>
          {busy ? <Spinner size="tiny" /> : "Save mapping"}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel}>Cancel</Button>
        {onPeek && (
          <Button
            size="small"
            appearance="subtle"
            style={{ marginLeft: "auto", color: peeking ? "#13a10e" : tokens.colorBrandForeground1 }}
            icon={peeking ? <EyeFilled /> : <EyeRegular />}
            disabled={busy}
            onClick={togglePeek}
            aria-pressed={peeking}
            aria-label={peeking ? "Hide mapped fields on the page" : "Show mapped fields on the page"}
            title={peeking
              ? `${peekNote ?? "Highlighting mapped fields."} Green: mapped. Blue dashed: auto-match. Grey: never fill.`
              : "Show mapped fields on the page"}
          />
        )}
      </div>
    </div>
  );
}
