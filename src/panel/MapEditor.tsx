import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CursorClickRegular, DeleteRegular, EyeFilled, EyeRegular, NotepadRegular, StopRegular, TextBulletListLtrRegular } from "@fluentui/react-icons";
import { OptionMapEditor, type ChoicesRead } from "./OptionMapEditor";
import { choiceColumnOf } from "@/portal/choiceRouting";
import { columnKeyOf, type ColumnOptionMap } from "@/portal/optionMaps";
import { TargetPicker } from "./TargetPicker";
import { Button, Spinner, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import type { PeekItem, PeekResult, PortalScanResult, PortalScanRow } from "@/boldpenguin/types";
import {
  ARRAY_ROW_MAX, MAP_PATH_GROUPS, NOTE_TARGETS, PATH_LABEL, isArrayPath, isNoteTarget, isSecureTarget,
  isSensitiveLabel, rowTargetOf, toRowTarget
} from "@/portal/fieldMaps";
import { catalogLabel, type FieldCatalog } from "@/crm/fieldCatalog";
import { send } from "./api";

type OptionGroup = { group: string; paths: { path: string; label: string }[] };

/** Capture targets: every core column of each CRM entity (live metadata, in
 * hierarchy order) plus the semantic risk-data groups that have no CRM table
 * (building, payroll, vehicles). Without a catalog (not signed in), the
 * built-in semantic vocabulary stands in. */
export function captureGroups(catalog: FieldCatalog | null): OptionGroup[] {
  const riskData = MAP_PATH_GROUPS.filter(g => /risk data/.test(g.group));
  if (!catalog?.entities.length) return MAP_PATH_GROUPS;
  const crm = catalog.entities.map(e => ({
    group: e.label,
    paths: e.columns.map(c => ({ path: `crm:${e.key}${e.array ? "[]" : ""}.${c.name}`, label: c.label }))
  }));
  return [...crm, ...riskData];
}

/** Secured pass-through targets (SSN, license number, field-secured
 * columns): they map only to secured CRM columns or fill quote forms,
 * never a timeline note or the capture. */
export function securedGroups(catalog: FieldCatalog | null): OptionGroup[] {
  return (catalog?.entities ?? [])
    .filter(e => e.secured?.length)
    .map(e => ({
      group: `Secured: ${e.label}`,
      paths: e.secured!.map(c => ({ path: `secure:${e.key}${e.array ? "[]" : ""}.${c.name}`, label: c.label }))
    }));
}

/** Display text for any saved target, row slots and secured ones included. */
export function targetLabel(v: string, catalog: FieldCatalog | null): string | null {
  const direct = PATH_LABEL.get(v) ?? catalogLabel(catalog, v);
  if (direct) return direct;
  const row = rowTargetOf(v);
  if (row) {
    const base = PATH_LABEL.get(row.arrayPath) ?? catalogLabel(catalog, row.arrayPath) ?? row.arrayPath;
    return `${base} (row ${row.row})`;
  }
  return null;
}

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

export function MapEditor({ scan, draft, setDraft, captured, busy, onSave, onCancel, onPick, onPickCancel, onPeek, choices, setChoices, capturedFields, onReadChoices, title, hideAuto, inject, extraPeek }: {
  /** Header text (defaults to "Field mapping for <origin>"). */
  title?: string;
  /** List only mapped/picked rows, not auto-matches (data-service sites). */
  hideAuto?: boolean;
  /** A field picked elsewhere (the data-service editor) to add and focus. */
  inject?: PortalScanRow | null;
  /** On-screen fields another mapping covers (a data service): outlined by
   * the peek with the CRM target they feed. */
  extraPeek?: { key: string; target: string }[];
  scan: PortalScanResult;
  /** This site's one-for-one choice mappings ({table.column: {text: value}}). */
  choices?: Record<string, ColumnOptionMap>;
  setChoices?: (updater: (c: Record<string, ColumnOptionMap>) => Record<string, ColumnOptionMap>) => void;
  /** Held capture fields: their values are known source wordings for a choice. */
  capturedFields?: { value: string; mapped?: string }[];
  /** Reads one field's current value and options from the page. */
  onReadChoices?: (key: string) => Promise<ChoicesRead | null>;
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
  const secured = useMemo(() => securedGroups(catalog), [catalog]);
  const groups = useMemo(() => [...captureGroups(catalog), ...secured], [catalog, secured]);
  const groupValues = useMemo(() => new Set(groups.flatMap(g => g.paths.map(p => p.path))), [groups]);
  // a form control fills from (and captures into) any target; list targets
  // take a row number beside the picker
  const fillGroups = useMemo<OptionGroup[]>(() => captured.length
    ? [...groups, { group: "Captured fields (drivers, vehicles, extra records…)", paths: captured.map(c => ({ path: c.value, label: c.label })) }]
    : groups, [captured, groups]);

  useEffect(() => {
    if (!focusKey) return;
    rowRefs.current.get(focusKey)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusKey]);

  const [choicesOpen, setChoicesOpen] = useState<Set<string>>(() => new Set());
  const toggleChoices = (key: string) => setChoicesOpen(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
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

  useEffect(() => {
    if (!inject) return;
    if (!scan.rows.some(r => r.key === inject.key)) setExtraRows(x => (x.some(r => r.key === inject.key) ? x : [...x, inject]));
    reveal(inject.key);
    setFocusKey(inject.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inject]);
  const allRows = [...scan.rows, ...extraRows.filter(x => !scan.rows.some(r => r.key === x.key))];
  // Only rows that mean something are listed: auto-matched, already mapped,
  // or picked/edited this session. Unknown page fields stay hidden until the
  // agent clicks them on the page - building a map beats scrolling a list
  // of anonymous "Select Row" checkboxes.
  const rows = allRows.filter(r =>
    showAll || revealed.has(r.key) || (!hideAuto && Boolean(r.autoPath)) || Boolean(r.mapped) || Boolean(draft[r.key]));
  const hiddenCount = allRows.length - rows.length;

  /* peek: what the current (unsaved) draft covers, including hidden rows that
   * auto-match - so the page shows exactly what still needs mapping */
  const targetText = (v: string) =>
    targetLabel(v, catalog) ??
    (v.startsWith("label:") ? (captured.find(c => c.value === v)?.label ?? v.slice(6)) : v);
  const peekItems: PeekItem[] = allRows.flatMap<PeekItem>(r => {
    const v = draft[r.key] ?? "";
    if (r.payment) return [];
    if (v === "skip") return [{ key: r.key, label: "Never fill", kind: "skip" }];
    if (isNoteTarget(v)) return [{ key: r.key, label: NOTE_TARGETS.find(t => t.value === v)!.label, kind: "mapped", array: true }];
    if (v) return [{ key: r.key, label: targetText(v), kind: "mapped", array: isArrayPath(v) }];
    if (r.autoPath && !hideAuto) return [{ key: r.key, label: `Auto: ${PATH_LABEL.get(r.autoPath) ?? r.autoPath}`, kind: "auto" }];
    return [];
  }).concat((extraPeek ?? []).map(x => ({ key: x.key, label: targetText(x.target), kind: "mapped" as const })));
  const peekSignature = JSON.stringify(peekItems);
  const [peeking, setPeeking] = useState(false);
  const [peekNote, setPeekNote] = useState<string | null>(null);
  useEffect(() => {
    if (!peeking || !onPeek) return;
    let live = true;
    void onPeek(peekItems).then(r => {
      if (!live) return;
      setPeekNote(`${r.shown} mapped in green${r.unmapped ? `, ${r.unmapped} unmapped in red` : ""}${r.missing ? `, ${r.missing} not on this page` : ""}.`);
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
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{title ?? `Field mapping for ${scan.origin}`}</span>
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
        // identifier fields (SSN, ITIN, passport) map ONLY to secured targets
        const identifier = isSensitiveLabel(r.label) || isSecureTarget(current);
        // picked text and labelled fields are capture teachings
        const isPick = r.key.startsWith("pick:") || r.key.startsWith("field:");
        // a form control names ONE row of a list ("Driver 2" = row 1 of related contacts)
        const slot = !isPick ? rowTargetOf(current) : null;
        const pickerValue = slot ? slot.arrayPath : current;
        const choose = (v: string) => setTarget(r.key, !isPick && isArrayPath(v) ? (toRowTarget(v, 1) ?? v) : v);
        // a CRM choice target: each of this field's options binds to one CRM choice
        const choiceCol = setChoices ? choiceColumnOf(current, catalog) : null;
        const choiceKey = choiceCol ? columnKeyOf(current) : null;
        const choiceSources = choiceCol
          ? [...(r.options ?? []), ...(capturedFields ?? []).filter(f => f.mapped === current).map(f => f.value)]
          : [];
        return (
          <Fragment key={r.key}>
          <div
            key={r.key}
            className={focusKey === r.key ? styles.rowFocused : styles.row}
            // same signal as the page peek: green mapped, red not, grey never fill
            style={{ borderLeft: `3px solid ${r.payment ? "transparent" : current === "skip" ? "#8a8886" : current || r.autoPath ? "#13a10e" : "#d13438"}`, paddingLeft: 4 }}
            ref={el => { if (el) rowRefs.current.set(r.key, el); else rowRefs.current.delete(r.key); }}
          >
            <span className={styles.label} title={r.key}>{r.label}</span>
            {r.payment
              ? <span>Payment field, never filled</span>
              : isPick ? (
                /* read-only text teaching: capture direction, CRM fields only */
                <TargetPicker
                  value={current}
                  onChange={choose}
                  groups={identifier ? secured : groups}
                  specials={[
                    { value: "", label: "Not captured" },
                    // secured data never goes to a timeline note
                    ...(identifier ? [] : NOTE_TARGETS.map(t => ({ value: t.value, label: t.label, icon: <NotepadRegular /> })))
                  ]}
                  currentText={current && !groupValues.has(current)
                    ? `${targetText(current)} (saved)`
                    : undefined}
                  groupPrefix="Capture as: "
                />
              ) : (
                <>
                  <TargetPicker
                    value={pickerValue}
                    onChange={choose}
                    groups={identifier ? secured : fillGroups}
                    specials={[
                      { value: "", label: identifier ? "Not mapped" : r.autoPath ? `Auto (${PATH_LABEL.get(r.autoPath) ?? r.autoPath})` : "Auto (no match)" },
                      { value: "skip", label: "Never fill" },
                      // a form field with no CRM column goes to a timeline note
                      // on Ingest (never a secured/identifier field)
                      ...(identifier ? [] : NOTE_TARGETS.map(t => ({ value: t.value, label: t.label, icon: <NotepadRegular /> })))
                    ]}
                    currentText={orphanLabel ? `${orphanLabel} (saved; not in current capture)`
                      : current && !groupValues.has(pickerValue) ? `${targetText(current)} (saved)` : undefined}
                  />
                  {slot && (
                    <Tooltip content="Which row of the list this field is (row 1 = first related contact)" relationship="label" withArrow>
                      <select
                        aria-label="Row"
                        value={slot.row}
                        onChange={e => setTarget(r.key, toRowTarget(slot.arrayPath, Number(e.target.value)) ?? current)}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >
                        {Array.from({ length: ARRAY_ROW_MAX }, (_, i) => i + 1).map(n => <option key={n} value={n}>Row {n}</option>)}
                      </select>
                    </Tooltip>
                  )}
                </>
              )}
            {choiceCol && (
              <Tooltip content="Map each choice to its CRM choice" relationship="label" withArrow>
                <Button
                  size="small"
                  appearance={choicesOpen.has(r.key) ? "primary" : "subtle"}
                  icon={<TextBulletListLtrRegular />}
                  aria-pressed={choicesOpen.has(r.key)}
                  onClick={() => toggleChoices(r.key)}
                />
              </Tooltip>
            )}
            {!r.payment && current && (
              <Tooltip content="Delete this mapping (saved with Save mapping)" relationship="label" withArrow>
                <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => setTarget(r.key, "")} />
              </Tooltip>
            )}
          </div>
          {choiceCol && choiceKey && choicesOpen.has(r.key) && (
            <OptionMapEditor
              column={choiceCol}
              sources={choiceSources}
              value={choices?.[choiceKey] ?? {}}
              onChange={next => setChoices?.(c => ({ ...c, [choiceKey]: next }))}
              onRead={onReadChoices ? () => onReadChoices(r.key) : undefined}
            />
          )}
          </Fragment>
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
              ? `${peekNote ?? "Highlighting fields."} Green: mapped (dashed: auto-match). Red: not mapped. Grey: never fill.`
              : "Show mapped fields on the page"}
          />
        )}
      </div>
    </div>
  );
}
