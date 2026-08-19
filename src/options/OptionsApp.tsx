import { useEffect, useState } from "react";
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
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
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

const URL_PATTERN = /^https:\/\/[a-z0-9-]+\.crm\d*\.dynamics\.com$/;
const COLORS: CrmEnvironment["color"][] = ["green", "blue", "orange", "red"];

function makeId(): string {
  return `env_${Math.random().toString(36).slice(2, 10)}`;
}

const useStyles = makeStyles({
  root: {
    padding: "24px",
    maxWidth: "900px",
    fontFamily: tokens.fontFamilyBase
  },
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
      <Text size={600} weight="semibold">
        D365 Insurance Quote Connector — Environments
      </Text>

      <RadioGroup value={activeId} onChange={(_, d) => makeActive(d.value)} layout="vertical">
        <Table style={{ marginTop: 16 }}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Active</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Org URL</TableHeaderCell>
              <TableHeaderCell>App ID (optional, for deep links)</TableHeaderCell>
              <TableHeaderCell>Color</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {envs.map(e => (
              <TableRow key={e.id}>
                <TableCell>
                  <Radio value={e.id} />
                </TableCell>
                <TableCell>
                  <Input value={e.name} onChange={(_, d) => update(e.id, { name: d.value })} />
                </TableCell>
                <TableCell>
                  <Input
                    value={e.orgUrl}
                    onChange={(_, d) => update(e.id, { orgUrl: d.value })}
                    placeholder="https://org.crm.dynamics.com"
                  />
                  {urlInvalid.get(e.id) && (
                    <Text size={200} style={{ color: tokens.colorPaletteRedForeground1, display: "block" }}>
                      Must match https://org.crm[N].dynamics.com
                    </Text>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    value={e.appId ?? ""}
                    placeholder="model-driven app id (guid)"
                    onChange={(_, d) => update(e.id, { appId: d.value.trim() || undefined })}
                  />
                </TableCell>
                <TableCell>
                  <Dropdown
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
                </TableCell>
                <TableCell>
                  <Button
                    icon={<DeleteRegular />}
                    disabled={e.id === activeId}
                    onClick={() => removeRow(e.id)}
                    title={e.id === activeId ? "Cannot delete the active environment" : "Delete"}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    </div>
  );
}
