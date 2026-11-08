import { useEffect, useState } from "react";
import { Button, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import type { CapturedApplication, PeekResult, PortalScanResult, PortalScanRow } from "@/boldpenguin/types";
import { FIELDMAP_STORAGE_KEY, getAllFieldMaps, setAllFieldMaps, type FieldMaps } from "@/portal/fieldMaps";
import { grantActiveTab } from "./portalAccess";
import { MapEditor, capturedTargets } from "./MapEditor";
import { send } from "./api";

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

/** In-panel "Pages Mapped": list/remove mapped sites and teach the current
 * page. Sharing (export/import) lives on the Settings page. */
export function MappingsManager({ onClose }: { onClose: () => void }) {
  const styles = useStyles();
  const [maps, setMaps] = useState<FieldMaps>({});
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [scan, setScan] = useState<PortalScanResult | null>(null);
  const [scanTabId, setScanTabId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
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
  const origins = Object.keys(maps).sort();

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
      for (const r of s.rows) d[r.key] = r.mapped ?? "";
      setDraft(d);
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
      await send({ type: "panel/saveFieldMap", origin: scan.origin, map });
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
      <Text weight="semibold">Pages Mapped</Text>
      {origins.map(origin => (
            <div key={origin} className={styles.row}>
              <Text size={200} className={styles.origin}>
                {origin}: {Object.keys(maps[origin]!).length} field{Object.keys(maps[origin]!).length === 1 ? "" : "s"}
              </Text>
              <Button size="small" icon={<DeleteRegular />} onClick={() => removeSite(origin)} title="Remove this site's mapping" />
            </div>
          ))}
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
      <div className={styles.row}>
        <Button size="small" appearance="primary" disabled={busy !== null} onClick={mapThisPage}>
          {busy === "scan" ? <Spinner size="tiny" /> : "Map this page…"}
        </Button>
        <Button size="small" appearance="primary" onClick={onClose}>Done</Button>
      </div>
      {note && <div className={styles.note}>{note}</div>}
      {problem && <div className={styles.note}>{problem}</div>}
    </div>
  );
}
