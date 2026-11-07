import { useEffect, useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import {
  getAllFieldMaps,
  setAllFieldMaps,
  buildFieldMapExport,
  parseFieldMapImport,
  type FieldMaps
} from "@/portal/fieldMaps";

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
export function MappingsManager({ onClose }: { onClose: () => void }) {
  const styles = useStyles();
  const [maps, setMaps] = useState<FieldMaps>({});
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { void getAllFieldMaps().then(setMaps); }, []);
  const origins = Object.keys(maps).sort();

  const exportMaps = () => {
    const blob = new Blob([JSON.stringify(buildFieldMapExport(maps), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-connector-field-mappings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote("Share file downloaded — send it to the other user; they use Import here.");
    setProblem(null);
  };

  const importMaps = async (file: File) => {
    setNote(null);
    setProblem(null);
    try {
      const parsed = parseFieldMapImport(await file.text());
      const merged = { ...await getAllFieldMaps() };
      for (const [origin, entries] of Object.entries(parsed.maps)) merged[origin] = entries;
      await setAllFieldMaps(merged);
      setMaps(merged);
      setNote(
        `Imported ${parsed.sites} site${parsed.sites === 1 ? "" : "s"} (${parsed.fields} field mapping${parsed.fields === 1 ? "" : "s"})` +
        (parsed.dropped ? `; ${parsed.dropped} invalid entr${parsed.dropped === 1 ? "y" : "ies"} skipped` : "") + "."
      );
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
      <Text size={200}>
        Taught with "Map fields…" on a carrier page, saved per site. Export to share with other
        users; importing a file adds its sites (same-site mappings are replaced).
      </Text>
      {origins.length === 0
        ? <Text size={200}>No saved mappings yet — open a carrier page and use Map fields….</Text>
        : origins.map(origin => (
            <div key={origin} className={styles.row}>
              <Text size={200} className={styles.origin}>
                {origin} — {Object.keys(maps[origin]!).length} field{Object.keys(maps[origin]!).length === 1 ? "" : "s"}
              </Text>
              <Button size="small" icon={<DeleteRegular />} onClick={() => removeSite(origin)} title="Remove this site's mapping" />
            </div>
          ))}
      <div className={styles.row}>
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
      {note && <div className={styles.note}>{note}</div>}
      {problem && <div className={styles.note}>{problem}</div>}
    </div>
  );
}
