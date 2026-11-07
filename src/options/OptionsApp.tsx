import { Fragment, useEffect, useState } from "react";
import {
  Button,
  Input,
  Dropdown,
  Option,
  RadioGroup,
  Radio,
  Text,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens
} from "@fluentui/react-components";
import { DeleteRegular, AddRegular } from "@fluentui/react-icons";
import {
  getEnvironments,
  saveEnvironments,
  getActiveEnvironment,
  setActiveEnvironment,
  type CrmEnvironment
} from "@/crm/environments";
import {
  getAllFieldMaps,
  setAllFieldMaps,
  buildFieldMapExport,
  parseFieldMapImport,
  type FieldMaps,
  type FieldMapImport
} from "@/portal/fieldMaps";

/** Carrier field mappings taught in the panel: list, share-file export, import
 * from a teammate's export, and per-site removal. */
function FieldMapsSection() {
  const [maps, setMaps] = useState<FieldMaps>({});
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<FieldMapImport | null>(null);

  const refresh = () => { void getAllFieldMaps().then(setMaps); };
  useEffect(refresh, []);

  const origins = Object.keys(maps).sort();

  const exportMaps = () => {
    const blob = new Blob([JSON.stringify(buildFieldMapExport(maps), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-connector-field-mappings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyImport = async (parsed: FieldMapImport) => {
    const merged = { ...await getAllFieldMaps() };
    for (const [origin, entries] of Object.entries(parsed.maps)) merged[origin] = entries;
    await setAllFieldMaps(merged);
    setMaps(merged);
    setPendingImport(null);
    setNote(
      `Imported ${parsed.sites} site${parsed.sites === 1 ? "" : "s"} (${parsed.fields} field mapping${parsed.fields === 1 ? "" : "s"})` +
      (parsed.dropped ? `; ${parsed.dropped} invalid entr${parsed.dropped === 1 ? "y" : "ies"} skipped` : "") +
      ". Imported sites replace any existing mapping for the same site."
    );
  };

  const importMaps = async (file: File) => {
    setNote(null);
    setProblem(null);
    setPendingImport(null);
    try {
      const parsed = parseFieldMapImport(await file.text());
      // files that redirect CAPTURED values get a human look before applying
      if (parsed.labelTargets.length) setPendingImport(parsed);
      else await applyImport(parsed);
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
    <div style={{ marginTop: 32 }}>
      <Text as="h2" size={500} weight="semibold" block>Carrier field mappings</Text>
      <Text block style={{ marginTop: 4 }}>
        Mappings taught with "Map fields…" in the panel, saved per carrier site. Export them to a
        file to share with other users; importing a file adds its sites to this extension.
      </Text>
      {origins.length === 0
        ? <Text block style={{ marginTop: 12 }}>No saved mappings yet.</Text>
        : origins.map(origin => (
            <div key={origin} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <Text style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {origin} — {Object.keys(maps[origin]!).length} field{Object.keys(maps[origin]!).length === 1 ? "" : "s"}
              </Text>
              <Button size="small" icon={<DeleteRegular />} onClick={() => removeSite(origin)} title="Remove this site's mapping" />
            </div>
          ))}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <Button onClick={exportMaps} disabled={origins.length === 0}>Export mappings…</Button>
        <Button onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "application/json,.json";
          input.onchange = () => { const f = input.files?.[0]; if (f) void importMaps(f); };
          input.click();
        }}>
          Import mappings…
        </Button>
      </div>
      {pendingImport && (
        <MessageBar intent="warning" style={{ marginTop: 12 }}>
          <MessageBarBody>
            This file maps fields to CAPTURED data ({pendingImport.labelTargets.join(", ")}) —
            review the targets, then{" "}
            <Button size="small" appearance="primary" onClick={() => void applyImport(pendingImport)}>Apply import</Button>{" "}
            <Button size="small" onClick={() => setPendingImport(null)}>Cancel</Button>
          </MessageBarBody>
        </MessageBar>
      )}
      {note && (
        <MessageBar intent="success" style={{ marginTop: 12 }}>
          <MessageBarBody>{note}</MessageBarBody>
        </MessageBar>
      )}
      {problem && (
        <MessageBar intent="error" style={{ marginTop: 12 }}>
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}

const URL_PATTERN = /^https:\/\/[a-z0-9-]+\.crm\d*\.dynamics\.com$/;
const COLORS: CrmEnvironment["color"][] = ["green", "blue", "orange", "red"];

function makeId(): string {
  return `env_${Math.random().toString(36).slice(2, 10)}`;
}

const useStyles = makeStyles({
  root: {
    padding: "24px",
    maxWidth: "1040px",
    fontFamily: tokens.fontFamilyBase
  },
  /* one shared grid for header + rows so the columns always line up and
   * every field owns its own track — no intrinsic-width overlap */
  grid: {
    marginTop: "16px",
    display: "grid",
    gridTemplateColumns: "56px minmax(120px, 1fr) minmax(240px, 1.8fr) minmax(220px, 1.6fr) 130px 40px",
    columnGap: "12px",
    rowGap: "10px",
    alignItems: "center"
  },
  headerCell: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    paddingBottom: "4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    alignSelf: "end"
  },
  cellStack: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  fullWidth: { width: "100%", minWidth: 0 },
  footer: {
    marginTop: "16px",
    color: tokens.colorNeutralForeground3
  },
  actions: {
    marginTop: "12px",
    display: "flex",
    alignItems: "center",
    gap: "8px"
  }
});

export function OptionsApp() {
  const styles = useStyles();
  const [envs, setEnvs] = useState<CrmEnvironment[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [list, active] = await Promise.all([getEnvironments(), getActiveEnvironment()]);
      setEnvs(list);
      setActiveId(active.id);
      setLoaded(true);
    })();
  }, []);

  function update(id: string, patch: Partial<CrmEnvironment>) {
    setEnvs(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    setSaved(false);
  }

  function addRow() {
    setEnvs(prev => [...prev, { id: makeId(), name: "", orgUrl: "", color: "blue", appId: "" }]);
    setSaved(false);
  }

  function removeRow(id: string) {
    setEnvs(prev => prev.filter(e => e.id !== id));
    setSaved(false);
  }

  async function save() {
    await saveEnvironments(envs);
    setSaved(true);
  }

  async function makeActive(id: string) {
    await setActiveEnvironment(id);
    setActiveId(id);
  }

  const urlInvalid = new Map(envs.map(e => [e.id, e.orgUrl !== "" && !URL_PATTERN.test(e.orgUrl)]));
  const hasInvalid =
    [...urlInvalid.values()].some(Boolean) || envs.some(e => !e.name.trim() || !e.orgUrl.trim());

  if (!loaded) return null;

  return (
    <div className={styles.root}>
      <img src="/icons/32.png" alt="" style={{ width: 28, height: 28, verticalAlign: "-6px", marginRight: 10 }} />
      <Text size={600} weight="semibold">
        D365 Insurance Quote Connector — Environments
      </Text>

      <RadioGroup value={activeId} onChange={(_, d) => makeActive(d.value)} layout="vertical">
        <div className={styles.grid}>
          <div className={styles.headerCell}>Active</div>
          <div className={styles.headerCell}>Name</div>
          <div className={styles.headerCell}>Org URL</div>
          <div className={styles.headerCell}>App ID (optional, for deep links)</div>
          <div className={styles.headerCell}>Color</div>
          <div className={styles.headerCell} />
          {envs.map(e => (
            <Fragment key={e.id}>
              <Radio value={e.id} />
              <Input
                className={styles.fullWidth}
                value={e.name}
                onChange={(_, d) => update(e.id, { name: d.value })}
              />
              <div className={styles.cellStack}>
                <Input
                  className={styles.fullWidth}
                  value={e.orgUrl}
                  onChange={(_, d) => update(e.id, { orgUrl: d.value })}
                  placeholder="https://org.crm.dynamics.com"
                />
                {urlInvalid.get(e.id) && (
                  <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                    Must match https://org.crm[N].dynamics.com
                  </Text>
                )}
              </div>
              <Input
                className={styles.fullWidth}
                value={e.appId ?? ""}
                placeholder="model-driven app id (guid)"
                onChange={(_, d) => update(e.id, { appId: d.value.trim() || undefined })}
              />
              <Dropdown
                className={styles.fullWidth}
                style={{ minWidth: 0 }}
                value={e.color}
                selectedOptions={[e.color]}
                onOptionSelect={(_, d) =>
                  update(e.id, { color: d.optionValue as CrmEnvironment["color"] })
                }
              >
                {COLORS.map(c => (
                  <Option key={c} value={c}>
                    {c}
                  </Option>
                ))}
              </Dropdown>
              <Button
                icon={<DeleteRegular />}
                disabled={e.id === activeId}
                onClick={() => removeRow(e.id)}
                title={e.id === activeId ? "Cannot delete the active environment" : "Delete"}
              />
            </Fragment>
          ))}
        </div>
      </RadioGroup>

      <div className={styles.actions}>
        <Button icon={<AddRegular />} onClick={addRow}>
          Add environment
        </Button>
        <Button appearance="primary" onClick={save} disabled={hasInvalid}>
          Save
        </Button>
        {saved && <Text>Saved.</Text>}
      </div>

      {hasInvalid && (
        <MessageBar intent="warning" style={{ marginTop: 12 }}>
          <MessageBarBody>
            Every environment needs a name and a valid org URL before saving.
          </MessageBarBody>
        </MessageBar>
      )}

      <Text block className={styles.footer}>
        Each environment requires your account to have a Dataverse security role in that org.
      </Text>

      <FieldMapsSection />
    </div>
  );
}
