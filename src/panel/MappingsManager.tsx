import { useEffect, useState } from "react";
import { Button, Spinner, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { DeleteRegular, EditRegular } from "@fluentui/react-icons";
import type { CapturedApplication, PeekResult, PortalScanResult, PortalScanRow } from "@/boldpenguin/types";
import { FIELDMAP_STORAGE_KEY, getAllFieldMaps, setAllFieldMaps, type FieldMaps } from "@/portal/fieldMaps";
import { grantActiveTab } from "./portalAccess";
import { MapEditor, capturedTargets } from "./MapEditor";
import { send } from "./api";
import { getOptionMaps, type ColumnOptionMap } from "@/portal/optionMaps";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "8px" },
  row: { display: "flex", alignItems: "center", gap: "8px" },
  origin: { minWidth: 0, overflowWrap: "anywhere", flex: 1 },
  note: {
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "6px 8px"
  }
});

/** In-panel Mappings view: the current page plus every mapped site, each
 * with its actions inline. Sharing (export/import) lives on Settings; the
 * header's Home button returns to intake. */
export function MappingsManager() {
  const styles = useStyles();
  const [maps, setMaps] = useState<FieldMaps>({});
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [scan, setScan] = useState<PortalScanResult | null>(null);
  const [scanTabId, setScanTabId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // this site's one-for-one choice mappings, saved with the field mapping
  const [choices, setChoices] = useState<Record<string, ColumnOptionMap>>({});
  const [app, setApp] = useState<CapturedApplication | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<string | null>(null);

  useEffect(() => {
    void getAllFieldMaps().then(setMaps);
    void send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
    // imports/removals on the Settings page show up here live
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && FIELDMAP_STORAGE_KEY in changes) void getAllFieldMaps().then(setMaps);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  // the page the agent is on always gets a row (mapped or not), first
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        const url = tab?.url ?? "";
        setCurrentOrigin(/^https:\/\//i.test(url) ? new URL(url).origin : null);
      }).catch(() => setCurrentOrigin(null));
    };
    read();
    const onActivated = () => read();
    const onUpdated = (_id: number, info: { url?: string }) => { if (info.url) read(); };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  const rowOrigins = [
    ...(currentOrigin ? [currentOrigin] : []),
    ...Object.keys(maps).sort().filter(o => o !== currentOrigin)
  ];

  // works from ANY tab (EZLynx, CRM, carrier portals alike): scans whatever
  // page is open and teaches its fields
  const mapThisPage = async () => {
    setBusy("scan");
    setNote(null);
    setProblem(null);
    try {
      const tab = await grantActiveTab(setAwaiting);
      const s = await send<PortalScanResult>({ type: "panel/portalScan", tabId: tab.id });
      const d: Record<string, string> = {};
      // auto-matches become real, visible entries: the agent confirms (or
      // corrects) which CRM field each one feeds, and Save stores them
      for (const r of s.rows) d[r.key] = r.mapped ?? (r.payment ? "" : r.autoPath ?? "");
      setDraft(d);
      setChoices((await getOptionMaps())[s.origin] ?? {});
      setScan(s);
      setScanTabId(tab.id);
    } catch (e) {
      setProblem(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const saveScan = async () => {
    if (!scan) return;
    setBusy("save");
    try {
      const map: Record<string, string> = {};
      for (const [key, v] of Object.entries(draft)) if (v) map[key] = v;
      await send({ type: "panel/saveFieldMap", origin: scan.origin, map, options: choices });
      setMaps(await getAllFieldMaps());
      const n = Object.keys(map).length;
      setNote(n
        ? `Saved ${n} mapping${n === 1 ? "" : "s"} for ${scan.origin}.`
        : `Cleared the saved mappings for ${scan.origin}.`);
      setScan(null);
    } catch (e) {
      setProblem(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const removeSite = async (origin: string) => {
    const next = { ...maps };
    delete next[origin];
    await setAllFieldMaps(next);
    setMaps(next);
  };

  return (
    <div className={styles.root}>
      {rowOrigins.map(origin => {
        const count = maps[origin] ? Object.keys(maps[origin]!).length : 0;
        const here = origin === currentOrigin;
        return (
          <div key={origin} className={styles.row}>
            <Text size={200} className={styles.origin} weight={here ? "semibold" : "regular"}>
              {origin}: {count ? `${count} field${count === 1 ? "" : "s"}` : "not mapped"}
            </Text>
            {here && (
              <Tooltip content={count ? "Edit this page's mapping" : "Map this page"} relationship="label" withArrow>
                <Button
                  size="small"
                  appearance={scan ? "primary" : "secondary"}
                  icon={busy === "scan" ? <Spinner size="tiny" /> : <EditRegular />}
                  disabledFocusable={busy !== null}
                  onClick={busy !== null ? undefined : mapThisPage}
                />
              </Tooltip>
            )}
            {count > 0 && (
              <Tooltip content="Remove this site's mapping" relationship="label" withArrow>
                <Button size="small" icon={<DeleteRegular />} onClick={() => removeSite(origin)} />
              </Tooltip>
            )}
          </div>
        );
      })}
      {awaiting && (
        <Text size={200} weight="semibold">
          Waiting for browser approval to access {awaiting}. Click Allow on the permission prompt
          (in Edge it is under the Extensions puzzle-piece icon next to the address bar).
        </Text>
      )}
      {scan && (
        <MapEditor
          scan={scan}
          draft={draft}
          setDraft={u => setDraft(u)}
          captured={capturedTargets(app?.fields)}
          choices={choices}
          setChoices={u => setChoices(u)}
          capturedFields={app?.fields}
          busy={busy === "save"}
          onSave={saveScan}
          onCancel={() => setScan(null)}
          onPick={scanTabId === null
            ? undefined
            : () => send<PortalScanRow | "timeout" | null>({ type: "panel/portalPick", tabId: scanTabId })}
          onPickCancel={scanTabId === null
            ? undefined
            : () => send<null>({ type: "panel/portalPickCancel", tabId: scanTabId })}
          onPeek={scanTabId === null
            ? undefined
            : items => send<PeekResult>({ type: "panel/portalPeek", tabId: scanTabId, items })}
        />
      )}
      {note && <div className={styles.note}>{note}</div>}
      {problem && <div className={styles.note}>{problem}</div>}
    </div>
  );
}
