import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { CursorClickRegular, NotepadRegular, StopRegular, TextBulletListLtrRegular } from "@fluentui/react-icons";
import { TargetPicker } from "./TargetPicker";
import { captureGroups, securedGroups } from "./MapEditor";
import { OptionMapEditor, type ChoicesRead } from "./OptionMapEditor";
import { send } from "./api";
import type { FieldCatalog } from "@/crm/fieldCatalog";
import type { CapturedApplication, PortalScanRow } from "@/boldpenguin/types";
import { MAP_PATH_GROUPS, NOTE_TARGETS, scopeMatches } from "@/portal/fieldMaps";
import { choiceColumnOf } from "@/portal/choiceRouting";
import {
  OPTIONMAP_STORAGE_KEY, columnKeyOf, dataServiceScope, getOptionMaps, setOptionMaps, type ColumnOptionMap
} from "@/portal/optionMaps";
import { canonical } from "@/boldpenguin/normalize";
import {
  DATA_SERVICE_STORAGE_KEY, EZLYNX_FIELDS, effectiveTargets, getDataServiceMaps, setDataServiceMap,
  type DataServiceField
} from "@/sources/ezlynxSource";

/** Sites whose data arrives through a data service: their Mappings page
 * edits the service's field mappings (what Ingest actually uses). */
export const DATA_SERVICE_ORIGINS: Record<string, { source: string; name: string }> = {
  "https://app.ezlynx.com": { source: "ezlynx", name: "EZLynx" }
};

const useStyles = makeStyles({
  root: { fontSize: "12px" },
  head: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, marginBottom: "4px" },
  section: { fontWeight: 600, marginTop: "8px", color: tokens.colorNeutralForeground2 },
  row: { display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", minWidth: 0 },
  focused: {
    display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", minWidth: 0,
    backgroundColor: tokens.colorBrandBackground2, outline: `1px solid ${tokens.colorBrandStroke1}`, borderRadius: "3px", padding: "2px"
  },
  label: { width: "120px", flexShrink: 0, overflowWrap: "anywhere", color: tokens.colorNeutralForeground3 },
  note: { color: tokens.colorNeutralForeground3, marginTop: "4px" },
  filters: {
    position: "sticky", bottom: 0, display: "flex", gap: "6px", padding: "6px 0", marginTop: "6px",
    backgroundColor: tokens.colorNeutralBackground1, borderTop: `1px solid ${tokens.colorNeutralStroke2}`
  }
});

/** Page hooks when the editor runs beside the source's own page. */
export interface DataServicePageHooks {
  onPick: () => Promise<PortalScanRow | "timeout" | null>;
  onPickCancel: () => Promise<unknown>;
  onRead: (labels: string[]) => Promise<ChoicesRead | null>;
  /** A picked field the service doesn't return: mapped as a page field. */
  onUnmatched?: (row: PortalScanRow) => void;
}

/** The data-service field a field clicked on the page is (scoped labels:
 * the applicant's Gender is not a contact's, the Primary Address City is not
 * the Other Address one), or null when the service doesn't return it. */
export function dataServiceFieldOf(row: PortalScanRow): DataServiceField | null {
  const want = canonical(row.fieldLabel ?? row.label.replace(/:.*$/, ""));
  const scopes = row.scopes ?? [];
  return EZLYNX_FIELDS.find(f => (f.pageLabels ?? []).some(l => {
    const at = l.indexOf(">");
    return canonical(at < 0 ? l : l.slice(at + 1)) === want && scopeMatches(at < 0 ? "" : l.slice(0, at), scopes);
  })) ?? null;
}

/** What a list section's rows are. */
const SECTION_NOTE: Record<string, string> = {
  Contacts: " (row 1 is the applicant, then each contact added with Add contact)",
  Phones: " (one row per phone after the primary)",
  Emails: " (one row per email after the primary)",
  Addresses: " (the applicant's addresses on their contact, primary first)"
};

/** Every field a data service returns, each routed to a CRM target, with
 * one-for-one choice mappings for CRM choice columns. Saves as you go. */
export function DataServiceMapEditor({ source = "ezlynx", page, focusId }: { source?: string; page?: DataServicePageHooks; focusId?: { id: string } | null }) {
  const styles = useStyles();
  const scope = dataServiceScope(source);
  const [saved, setSaved] = useState<Record<string, string> | undefined>(undefined);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [choices, setChoices] = useState<Record<string, ColumnOptionMap>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [heldValues, setHeldValues] = useState<Record<string, string[]>>({});
  const [picking, setPicking] = useState(false);
  // list filter: every field, only mapped ones, or only unmapped ones
  const [show, setShow] = useState<"all" | "mapped" | "unmapped">("all");
  const [pickNote, setPickNote] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // a field picked from the Page fields picker that the service covers
  useEffect(() => { if (focusId) setFocus(focusId.id); }, [focusId]);

  useEffect(() => {
    const load = () => void getDataServiceMaps().then(m => setSaved(m[source] ?? {}));
    const loadChoices = () => void getOptionMaps().then(m => setChoices(m[scope] ?? {}));
    load();
    loadChoices();
    void send<FieldCatalog>({ type: "panel/crmFieldCatalog" }).then(setCatalog).catch(() => setCatalog(null));
    // values the service returned in the held capture: known source wordings
    void send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(app => {
      const byField: Record<string, string[]> = {};
      for (const f of app?.fields ?? []) {
        if (f.source !== "dataservice") continue;
        const k = `${f.section}|${f.label}`;
        byField[k] = [...new Set([...(byField[k] ?? []), f.value])];
      }
      setHeldValues(byField);
    }).catch(() => {});
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== "local") return;
      if (DATA_SERVICE_STORAGE_KEY in changes) load();
      if (OPTIONMAP_STORAGE_KEY in changes) loadChoices();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [source, scope]);

  useEffect(() => {
    if (focus) rowRefs.current.get(focus)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  // built-in targets (they also drive identity, dedupe and fill) plus every CRM column
  const groups = useMemo(() => {
    // groups can share a name ("Contacts (all rows)" is both the
    // built-in list and the CRM table): merge their paths, never drop one
    const merged = new Map<string, { path: string; label: string }[]>();
    for (const g of [...MAP_PATH_GROUPS, ...(catalog ? captureGroups(catalog) : [])]) {
      const paths = merged.get(g.group) ?? [];
      for (const p of g.paths) if (!paths.some(x => x.path === p.path)) paths.push(p);
      merged.set(g.group, paths);
    }
    return [...merged.entries()].map(([group, paths]) => ({ group, paths }));
  }, [catalog]);
  // SSN / DL# map only to secured CRM columns
  const secured = useMemo(() => securedGroups(catalog), [catalog]);
  const targets = effectiveTargets(saved);
  const choose = (id: string, value: string) => void setDataServiceMap(source, { ...(saved ?? {}), [id]: value });
  // a person row goes to THAT person's own timeline (row 1 = the primary
  // contact); account-level fields can still pick the primary contact's
  const specialsFor = (section: string) => [
    { value: "", label: "Not mapped (kept in the capture)" },
    ...NOTE_TARGETS.filter(t => (section === "Contacts" ? t.record !== "contact" : t.record !== "relatedcontact"))
      .map(t => ({ value: t.value, label: t.label, icon: <NotepadRegular /> }))
  ];
  const labelsOf = (f: DataServiceField) => [f.label, ...(f.pageLabels ?? [])];

  /* click a field on the page: the matching service field is focused */
  const pick = async () => {
    if (!page || picking) return;
    setPicking(true);
    setPickNote(null);
    stopRequested.current = false;
    try {
      for (let round = 0; round < 9; round += 1) {
        const row = await page.onPick();
        if (row === "timeout") { if (stopRequested.current) break; continue; }
        if (!row) break;
        // a section-scoped service label ("primary address>city") matches
        // only that section's field: the Other Address City is a page field
        const hit = dataServiceFieldOf(row);
        if (hit) { setFocus(hit.id); setPickNote(null); }
        else if (page.onUnmatched) { page.onUnmatched(row); setPickNote(`${row.label} added to Page fields.`); }
        else setPickNote(`"${row.label}" is not a field the data service returns.`);
        return;
      }
      setPickNote("Nothing picked.");
    } catch (e) {
      setPickNote(String((e as Error).message ?? e));
    } finally {
      setPicking(false);
    }
  };
  const mappedCount = EZLYNX_FIELDS.filter(f => targets[f.id]).length;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span style={{ flex: 1 }}>{DATA_SERVICE_ORIGINS["https://app.ezlynx.com"]!.name} data service: {mappedCount} mapped</span>
        <a href="#" style={{ fontWeight: 400 }} onClick={e => { e.preventDefault(); void setDataServiceMap(source, {}); }}>Reset to defaults</a>
        {page && (
          <Tooltip content={picking ? "Stop picking" : "Click a field on the page to find its mapping"} relationship="label" withArrow>
            <Button
              size="small"
              appearance={picking ? "primary" : "subtle"}
              icon={picking ? <StopRegular /> : <CursorClickRegular />}
              onClick={() => { if (picking) { stopRequested.current = true; void page.onPickCancel().catch(() => {}); } else void pick(); }}
            />
          </Tooltip>
        )}
      </div>
      {(picking || pickNote) && (
        <div className={styles.note}>
          {picking ? <><Spinner size="extra-tiny" style={{ display: "inline-flex", verticalAlign: "middle" }} /> Click a field on the page. Esc cancels.</> : pickNote}
        </div>
      )}
      {(["Insured", "Contacts", "Phones", "Emails", "Addresses"] as const).map(section => {
        // a field picked on the page always shows, whatever the filter
        const listed = EZLYNX_FIELDS.filter(f => f.section === section &&
          (show === "all" || f.id === focus || (show === "mapped" ? Boolean(targets[f.id]) : !targets[f.id])));
        if (!listed.length) return null;
        return (
        <div key={section}>
          <Text size={200} className={styles.section} block>{section === "Insured" ? "Insured (account)" : section}{SECTION_NOTE[section]}</Text>
          {listed.map(f => {
            const target = targets[f.id] ?? "";
            // co-applicant list targets resolve per row; the CRM column is the same
            const concrete = target.replace("crm:contacts[]", "crm:contact2").replace("crm:primarycontact", "crm:contact2").replace("crm:addresses[]", "crm:address1");
            const col = choiceColumnOf(concrete, catalog);
            const key = col ? columnKeyOf(concrete) : null;
            return (
              <Fragment key={f.id}>
                <div
                  className={focus === f.id ? styles.focused : styles.row}
                  // same signal as the page peek: green mapped, red not mapped
                  style={{ borderLeft: `3px solid ${target ? "#13a10e" : "#d13438"}`, paddingLeft: 4 }}
                  ref={el => { if (el) rowRefs.current.set(f.id, el); else rowRefs.current.delete(f.id); }}
                >
                  <span className={styles.label}>{f.label}</span>
                  <TargetPicker
                    value={target}
                    onChange={v => choose(f.id, v)}
                    groups={f.secured ? secured : groups}
                    specials={f.secured ? [{ value: "", label: "Not mapped (never captured)" }] : specialsFor(section)}
                    currentText={target || undefined}
                  />
                  {col && (
                    <Tooltip content="Map each choice to its CRM choice" relationship="label" withArrow>
                      <Button
                        size="small"
                        appearance={open === f.id ? "primary" : "subtle"}
                        icon={<TextBulletListLtrRegular />}
                        aria-pressed={open === f.id}
                        onClick={() => setOpen(o => (o === f.id ? null : f.id))}
                      />
                    </Tooltip>
                  )}
                </div>
                {col && key && open === f.id && (
                  <OptionMapEditor
                    column={col}
                    sources={heldValues[`${section}|${f.label}`] ?? []}
                    value={choices[key] ?? {}}
                    onChange={next => { setChoices(c => ({ ...c, [key]: next })); void setOptionMaps(scope, { [key]: next }); }}
                    onRead={page ? () => page.onRead(labelsOf(f)) : undefined}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
        );
      })}
      <div className={styles.filters}>
        <Button
          size="small"
          appearance={show === "mapped" ? "primary" : "secondary"}
          aria-pressed={show === "mapped"}
          onClick={() => setShow(s => (s === "mapped" ? "all" : "mapped"))}
        >
          Show mapped ({mappedCount})
        </Button>
        <Button
          size="small"
          appearance={show === "unmapped" ? "primary" : "secondary"}
          aria-pressed={show === "unmapped"}
          onClick={() => setShow(s => (s === "unmapped" ? "all" : "unmapped"))}
        >
          Show unmapped ({EZLYNX_FIELDS.length - mappedCount})
        </Button>
      </div>
    </div>
  );
}
