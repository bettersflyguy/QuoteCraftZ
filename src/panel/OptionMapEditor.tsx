import { useState } from "react";
import { Button, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import type { CatalogColumn } from "@/crm/fieldCatalog";
import { autoMatchOption, type ColumnOptionMap } from "@/portal/optionMaps";
import { canonical } from "@/boldpenguin/normalize";

const useStyles = makeStyles({
  root: {
    margin: "2px 0 6px 12px", padding: "4px 6px", fontSize: "12px",
    borderLeft: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorNeutralBackground1
  },
  title: { fontWeight: 600, marginBottom: "2px" },
  row: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" },
  source: { flex: "0 0 45%", minWidth: 0, overflowWrap: "anywhere" },
  select: { flex: 1, minWidth: 0, fontSize: "12px" },
  add: { flex: 1, minWidth: 0, fontSize: "12px" }
});

/** One-for-one choice mapping for a CRM choice column: every source option
 * (the page's or the data service's wording) bound to one exact CRM choice.
 * Unbound options show the automatic guess. */
export function OptionMapEditor({ column, sources, value, onChange }: {
  column: CatalogColumn;
  /** Source wordings known for this field (page options, captured values). */
  sources: string[];
  value: ColumnOptionMap;
  onChange: (next: ColumnOptionMap) => void;
}) {
  const styles = useStyles();
  const [extra, setExtra] = useState("");
  const options = column.options ?? [];
  const seen = new Set<string>();
  const list = [...sources, ...Object.keys(value)].filter(s => {
    const k = canonical(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
    onChange({ ...value, [s]: guess ?? options[0]?.value ?? 0 });
    setExtra("");
  };

  return (
    <div className={styles.root}>
      <div className={styles.title}>Choices: {column.label}</div>
      {list.map(s => {
        const b = bound(s);
        const guess = autoMatchOption(s, options);
        const guessLabel = options.find(o => o.value === guess)?.label;
        return (
          <div key={s} className={styles.row}>
            <span className={styles.source} title={s}>{s}</span>
            <select
              className={styles.select}
              aria-label={`CRM choice for ${s}`}
              value={b ? String(b[1]) : ""}
              onChange={e => set(b ? b[0] : s, e.target.value)}
            >
              <option value="">{guessLabel ? `Auto: ${guessLabel}` : "No match"}</option>
              {options.map(o => (
                <option key={o.value} value={String(o.value)}>
                  {/* CRM lists can repeat a label ("Not Specified" twice): show the value too */}
                  {options.filter(x => x.label === o.label).length > 1 ? `${o.label} (${o.value})` : o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
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
