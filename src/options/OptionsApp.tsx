import { Fragment, useEffect, useState } from "react";
import { DataServicesSection } from "./DataServicesSection";
import { useSettingsTransfer } from "./SettingsTransfer";
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
  Tooltip,
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
  FIELDMAP_STORAGE_KEY,
  getAllFieldMaps,
  setAllFieldMaps,
  type FieldMaps
} from "@/portal/fieldMaps";

/** One mapped site: its field count, import/export for just this site,
 * and removal. */
function SiteRow({ origin, count, onRemove }: { origin: string; count: number; onRemove: () => void }) {
  const t = useSettingsTransfer({ kind: "site", origin });
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {origin}: {count} field{count === 1 ? "" : "s"}
        </Text>
        {t.icons}
        <Tooltip content="Remove this site's mapping" relationship="label" withArrow>
          <Button size="small" icon={<DeleteRegular />} onClick={onRemove} />
        </Tooltip>
      </div>
      {t.panel}
    </div>
  );
}

/** Carrier field mappings taught in the panel, per site. Whole-settings
 * import/export sits beside the page title. */
function FieldMapsSection() {
  const [maps, setMaps] = useState<FieldMaps>({});
  const refresh = () => { void getAllFieldMaps().then(setMaps); };
  useEffect(refresh, []);
  // the panel (and imports) teach/remove sites while this page is open
  useEffect(() => {
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && FIELDMAP_STORAGE_KEY in changes) refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  const origins = Object.keys(maps).sort();
  const removeSite = async (origin: string) => {
    const next = { ...maps };
    delete next[origin];
    await setAllFieldMaps(next);
    setMaps(next);
  };
  return (
    <div style={{ marginTop: 32 }}>
      <Text as="h2" size={500} weight="semibold">Pages Mapped</Text>
      {origins.length === 0
        ? <Text block style={{ marginTop: 12 }}>No saved mappings yet.</Text>
        : origins.map(origin => (
            <SiteRow key={origin} origin={origin} count={Object.keys(maps[origin]!).length} onRemove={() => void removeSite(origin)} />
          ))}
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
   * every field owns its own track - no intrinsic-width overlap */
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
  // every setting in one file; the page reloads to show what was imported
  const allTransfer = useSettingsTransfer({ kind: "all" }, () => window.setTimeout(() => location.reload(), 1200));
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/icons/32.png" alt="" style={{ width: 28, height: 28, marginRight: 2 }} />
        <Text size={600} weight="semibold">QuoteCraftZ Settings</Text>
        {allTransfer.icons}
      </div>
      {allTransfer.panel}
      <Text as="h2" size={500} weight="semibold" block style={{ marginTop: 24 }}>Environments</Text>

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
      <DataServicesSection />
    </div>
  );
}
