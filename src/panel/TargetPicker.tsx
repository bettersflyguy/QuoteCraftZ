import { useEffect, useMemo, useRef, useState } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";

import { filterTargets, normText as norm, type TargetGroup } from "./targetSearch";

export interface TargetSpecial { value: string; label: string }

const useStyles = makeStyles({
  root: { flex: 1, minWidth: 0 },
  trigger: {
    width: "100%", textAlign: "left", cursor: "pointer", fontSize: "12px",
    padding: "3px 6px", borderRadius: "3px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
  },
  entity: { color: tokens.colorNeutralForeground3 },
  panel: {
    marginTop: "2px", border: `1px solid ${tokens.colorBrandStroke1}`, borderRadius: "3px",
    backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow8
  },
  search: {
    width: "100%", boxSizing: "border-box", fontSize: "12px", padding: "4px 6px",
    border: "none", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, outline: "none",
    backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1
  },
  list: { maxHeight: "240px", overflowY: "auto", fontSize: "12px" },
  header: {
    padding: "4px 6px 2px", fontWeight: 600, color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3, position: "sticky", top: 0
  },
  item: { padding: "3px 8px", cursor: "pointer", display: "flex", flexDirection: "column" },
  active: { backgroundColor: tokens.colorBrandBackground2 },
  chip: { color: tokens.colorNeutralForeground3, fontSize: "11px" },
  empty: { padding: "6px 8px", color: tokens.colorNeutralForeground3 }
});

/** Searchable mapping-target picker. Unfiltered it browses by entity
 * (group headers); while searching it lists flat hits, each still tagged
 * with its entity so the agent always knows which record a mapping lands on. */
export function TargetPicker({ value, onChange, groups, specials, currentText, groupPrefix = "" }: {
  value: string;
  onChange: (value: string) => void;
  groups: TargetGroup[];
  /** Non-target choices listed first (Auto / Never fill / Not captured). */
  specials: TargetSpecial[];
  /** Display text for the current value when it isn't in groups/specials. */
  currentText?: string;
  /** Header prefix in browse mode ("Capture as — "). */
  groupPrefix?: string;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const special = specials.find(s => s.value === value);
  const selected = useMemo(() => {
    for (const g of groups) {
      const p = g.paths.find(x => x.path === value);
      if (p) return { label: p.label, group: g.group };
    }
    return null;
  }, [groups, value]);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (searching ? filterTargets(groups, query) : []), [groups, query, searching]);
  const matchingSpecials = searching
    ? specials.filter(s => norm(s.label).includes(norm(query)))
    : specials;
  // flat keyboard order: specials, then hits (search) or every option (browse)
  const flat: { value: string }[] = useMemo(() => [
    ...matchingSpecials.map(s => ({ value: s.value })),
    ...(searching ? hits.map(h => ({ value: h.path })) : groups.flatMap(g => g.paths.map(p => ({ value: p.path }))))
  ], [matchingSpecials, searching, hits, groups]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(""); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const pick = flat[active]; if (pick) choose(pick.value); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); }
  };

  let idx = 0;
  const item = (v: string, label: string, entity: string | null) => {
    const i = idx++;
    return (
      <div
        key={`${v}|${i}`}
        data-idx={i}
        className={`${styles.item} ${i === active ? styles.active : ""}`}
        onMouseEnter={() => setActive(i)}
        onMouseDown={e => { e.preventDefault(); choose(v); }}
        role="option"
        aria-selected={v === value}
      >
        <span>{v === value ? "✓ " : ""}{label}</span>
        {entity && <span className={styles.chip}>in {entity}</span>}
      </div>
    );
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)} title={selected ? `${selected.label} — ${selected.group}` : undefined}>
        {special ? special.label
          : selected ? <>{selected.label} <span className={styles.entity}>· {selected.group}</span></>
          : currentText ?? value}
      </button>
      {open && (
        <div className={styles.panel}>
          <input
            className={styles.search}
            autoFocus
            placeholder="Search fields or entities (e.g. contact city)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <div className={styles.list} ref={listRef} role="listbox">
            {matchingSpecials.map(s => item(s.value, s.label, null))}
            {searching
              ? (hits.length
                ? hits.map(h => item(h.path, h.label, h.group))
                : !matchingSpecials.length && <div className={styles.empty}>No fields match “{query}”.</div>)
              : groups.map(g => (
                <div key={g.group}>
                  <div className={styles.header}>{groupPrefix}{g.group}</div>
                  {g.paths.map(p => item(p.path, p.label, null))}
                </div>
              ))}
            {searching && hits.length >= 200 && <div className={styles.empty}>Showing the first 200 — keep typing to narrow.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
