import { useEffect, useState } from "react";
import { Button, Spinner, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { AddRegular, ArrowSyncRegular } from "@fluentui/react-icons";
import type { CatalogColumn } from "@/crm/fieldCatalog";
import { autoMatchOption, type ColumnOptionMap } from "@/portal/optionMaps";
import { canonical } from "@/boldpenguin/normalize";

const useStyles = makeStyles({
  root: {
    margin: "2px 0 6px 12px", padding: "4px 6px", fontSize: "12px",
    borderLeft: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorNeutralBackground1
  },
  title: { fontWeight: 600, display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" },
  head: { display: "flex", gap: "6px", color: tokens.colorNeutralForeground3, fontSize: "11px", marginBottom: "2px" },
  row: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" },
  source: { flex: "0 0 45%", minWidth: 0, overflowWrap: "anywhere" },
  current: { fontWeight: 600 },
  select: { flex: 1, minWidth: 0, fontSize: "12px" },
  add: { flex: 1, minWidth: 0, fontSize: "12px" },
  note: { color: tokens.colorNeutralForeground3 }
});

export interface ChoicesRead { current: string; options: string[]; refused?: boolean }

/** One-for-one choice mapping for a CRM choice column: every source value
 * (the page's options, the data service's values) bound to one exact CRM
 * choice. Unbound values show the automatic guess. */
export function OptionMapEditor({ column, sources, value, onChange, onRead }: {
  column: CatalogColumn;
  /** Source values already known for this field. */
  sources: string[];
  value: ColumnOptionMap;
  onChange: (next: ColumnOptionMap) => void;
  /** Reads the field's current value and options from the page. */
  onRead?: () => Promise<ChoicesRead | null>;
}) {
  const styles = useStyles();
  const [extra, setExtra] = useState("");
  const [read, setRead] = useState<ChoicesRead | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const options = column.options ?? [];

  const doRead = async () => {
    if (!onRead) return;
    setReading(true);
    setReadNote(null);
    try {
      const r = await onRead();
      setRead(r);
      if (!r) setReadNote("Field not found on the page.");
      else if (r.refused) setReadNote("Identifier field: not read.");
      else if (!r.options.length) setReadNote("No choices listed on the page. Add source values below.");
    } catch (e) {
      setReadNote(String((e as Error).message ?? e));
    } finally {
      setReading(false);
    }
  };
  // the page is the source of truth for its own choices: read on open
  useEffect(() => { void doRead(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const seen = new Set<string>();
  const list = [...(read?.current ? [read.current] : []), ...(read?.options ?? []), ...sources, ...Object.keys(value)].filter(s => {
    const k = canonical(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const isCurrent = (s: string) => Boolean(read?.current) && canonical(s) === canonical(read!.current);
  const bound = (s: string) => Object.entries(value).find(([k]) => canonical(k) === canonical(s));
  const set = (s: string, v: string) => {
    const next = Object.fromEntries(Object.entries(value).filter(([k]) => canonical(k) !== canonical(s)));
    if (v !== "") next[s] = Number(v);
    onChange(next);
  };
  const add = () => {
    const s = extra.replace(/\s+/g, " ").trim().slice(0, 100);
    if (!s) return;
    const guess = autoMatchOption(s, options);
    if (guess != null) onChange({ ...value, [s]: guess });
    else onChange({ ...value, [s]: options[0]?.value ?? 0 });
    setExtra("");
  };
  const optionText = (o: { value: number; label: string }) =>
    // CRM lists can repeat a label ("Not Specified" twice): show the value too
    options.filter(x => x.label === o.label).length > 1 ? `${o.label} (${o.value})` : o.label;

  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <span style={{ flex: 1 }}>Choices: {column.label}</span>
        {onRead && (
          <Tooltip content="Read the choices from the page again" relationship="label" withArrow>
            <Button size="small" appearance="subtle" icon={reading ? <Spinner size="extra-tiny" /> : <ArrowSyncRegular />} disabled={reading} onClick={() => void doRead()} />
          </Tooltip>
        )}
      </div>
      {list.length > 0 && (
        <div className={styles.head}>
          <span className={styles.source}>Source value</span>
          <span style={{ flex: 1 }}>CRM value</span>
        </div>
      )}
      {list.map(s => {
        const b = bound(s);
        const guess = autoMatchOption(s, options);
        const guessOption = options.find(o => o.value === guess);
        return (
          <div key={s} className={styles.row}>
            <span className={`${styles.source} ${isCurrent(s) ? styles.current : ""}`} title={isCurrent(s) ? `${s} (on the page now)` : s}>
              {s}{isCurrent(s) ? " ●" : ""}
            </span>
            <select
              className={styles.select}
              aria-label={`CRM value for ${s}`}
              value={b ? String(b[1]) : ""}
              onChange={e => set(b ? b[0] : s, e.target.value)}
            >
              <option value="">{guessOption ? `Auto: ${optionText(guessOption)}` : "No match"}</option>
              {options.map(o => <option key={o.value} value={String(o.value)}>{optionText(o)}</option>)}
            </select>
          </div>
        );
      })}
      {readNote && <div className={styles.note}>{readNote}</div>}
      <div className={styles.row}>
        <input
          className={styles.add}
          value={extra}
          placeholder="Add a source value"
          onChange={e => setExtra(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Tooltip content="Add this source value" relationship="label" withArrow>
          <Button size="small" appearance="subtle" icon={<AddRegular />} disabled={!extra.trim()} onClick={add} />
        </Tooltip>
      </div>
    </div>
  );
}
