import { useEffect, useState } from "react";
import { Button, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import type { CapturedApplication, PeekResult, PortalScanResult, PortalScanRow } from "@/boldpenguin/types";
import {
  getAllFieldMaps,
  setAllFieldMaps,
  buildFieldMapExport,
  parseFieldMapImport,
  type FieldMaps,
  type FieldMapImport
} from "@/portal/fieldMaps";
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

/** In-panel manager for the per-site field mappings, reachable from the
 * environment menu so agents handle sharing without leaving their work:
 * list + remove sites, export the share file, import a teammate's. */
export function MappingsManager({ onClose, mapOnOpen = false }: { onClose: () => void; mapOnOpen?: boolean }) {
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
  const [pendingImport, setPendingImport] = useState<FieldMapImport | null>(null);

  useEffect(() => {
    void getAllFieldMaps().then(setMaps);
    void send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
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
  useEffect(() => {
    if (mapOnOpen) void mapThisPage();
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const exportMaps = () => {
    const blob = new Blob([JSON.stringify(buildFieldMapExport(maps), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-connector-field-mappings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote("Share file downloaded.");
    setProblem(null);
  };

  const applyImport = async (parsed: FieldMapImport) => {
    const merged = { ...await getAllFieldMaps() };
    for (const [origin, entries] of Object.entries(parsed.maps)) merged[origin] = entries;
    await setAllFieldMaps(merged);
    setMaps(merged);
    setPendingImport(null);
    setNote(
      `Imported ${parsed.sites} site${parsed.sites === 1 ? "" : "s"} (${parsed.fields} field mapping${parsed.fields === 1 ? "" : "s"})` +
      (parsed.dropped ? `; ${parsed.dropped} invalid entr${parsed.dropped === 1 ? "y" : "ies"} skipped` : "") + "."
    );
  };

  const importMaps = async (file: File) => {
    setNote(null);
    setProblem(null);
    setPendingImport(null);
    try {
      // every import gets a review step: the file decides which sites' fills
      // change, so the user sees each origin (new vs replaced) before it lands
      setPendingImport(parseFieldMapImport(await file.text()));
    } catch (e) {
      setProblem(String((e as Error).message ?? e));
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
      <Text weight="semibold">Carrier field mappings</Text>
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
        <Button size="small" onClick={exportMaps} disabled={origins.length === 0}>Export…</Button>
        <Button size="small" onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "application/json,.json";
          input.onchange = () => { const f = input.files?.[0]; if (f) void importMaps(f); };
          input.click();
        }}>
          Import…
        </Button>
        <Button size="small" appearance="primary" onClick={onClose}>Done</Button>
      </div>
      {pendingImport && (
        <div className={styles.note}>
          <div style={{ fontWeight: 600 }}>Review this import before applying:</div>
          {pendingImport.perOrigin.map(o => (
            <div key={o.origin} style={{ margin: "4px 0", overflowWrap: "anywhere" }}>
              {o.origin}: {o.fields} field{o.fields === 1 ? "" : "s"} ({maps[o.origin] ? "replaces existing" : "new site"})
              {o.labels.length > 0 && <> · fills from captured: {o.labels.join(", ")}</>}
              {o.picks > 0 && <> · {o.picks} taught text capture{o.picks === 1 ? "" : "s"}</>}
            </div>
          ))}
          <div className={styles.row}>
            <Button size="small" appearance="primary" onClick={() => void applyImport(pendingImport)}>Apply import</Button>
            <Button size="small" onClick={() => setPendingImport(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {note && <div className={styles.note}>{note}</div>}
      {problem && <div className={styles.note}>{problem}</div>}
    </div>
  );
}
