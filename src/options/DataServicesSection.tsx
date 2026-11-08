import { useEffect, useMemo, useState } from "react";
import { Button, Text, Tooltip } from "@fluentui/react-components";
import { NotepadRegular, TextBulletListLtrRegular } from "@fluentui/react-icons";
import { OptionMapEditor } from "@/panel/OptionMapEditor";
import { choiceColumnOf } from "@/portal/choiceRouting";
import {
  OPTIONMAP_STORAGE_KEY, columnKeyOf, dataServiceScope, getOptionMaps, setOptionMaps, type ColumnOptionMap
} from "@/portal/optionMaps";
import type { CapturedApplication } from "@/boldpenguin/types";
import { TargetPicker } from "@/panel/TargetPicker";
import { captureGroups } from "@/panel/MapEditor";
import { send } from "@/panel/api";
import type { FieldCatalog } from "@/crm/fieldCatalog";
import { MAP_PATH_GROUPS, NOTE_TARGETS } from "@/portal/fieldMaps";
import {
  DATA_SERVICE_STORAGE_KEY,
  EZLYNX_FIELDS,
  effectiveTargets,
  getDataServiceMaps,
  setDataServiceMap
} from "@/sources/ezlynxSource";

/** Mappings for sources read through a data service (no page to click on):
 * each field the service returns, routed to a CRM target here instead. */
export function DataServicesSection() {
  const [saved, setSaved] = useState<Record<string, string> | undefined>(undefined);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const scope = dataServiceScope("ezlynx");
  const [choices, setChoices] = useState<Record<string, ColumnOptionMap>>({});
  const [open, setOpen] = useState<string | null>(null);
  // values EZLynx returned in the held capture: known wordings to bind
  const [heldValues, setHeldValues] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const load = () => void getDataServiceMaps().then(m => setSaved(m["ezlynx"] ?? {}));
    const loadChoices = () => void getOptionMaps().then(m => setChoices(m[scope] ?? {}));
    load();
    loadChoices();
    void send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(app => {
      const byLabel: Record<string, string[]> = {};
      for (const f of app?.fields ?? []) {
        if (f.source !== "dataservice") continue;
        const k = `${f.section}|${f.label}`;
        byLabel[k] = [...new Set([...(byLabel[k] ?? []), f.value])];
      }
      setHeldValues(byLabel);
    }).catch(() => {});
    void send<FieldCatalog>({ type: "panel/crmFieldCatalog" }).then(setCatalog).catch(() => setCatalog(null));
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && DATA_SERVICE_STORAGE_KEY in changes) load();
      if (area === "local" && OPTIONMAP_STORAGE_KEY in changes) loadChoices();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // built-in targets (the defaults: they also drive identity, dedupe and
  // fill) plus every CRM column by record
  const groups = useMemo(() => {
    const crm = captureGroups(catalog).filter(g => !MAP_PATH_GROUPS.some(m => m.group === g.group));
    return [...MAP_PATH_GROUPS, ...crm];
  }, [catalog]);
  const targets = effectiveTargets(saved);
  const choose = (id: string, value: string) => void setDataServiceMap("ezlynx", { ...(saved ?? {}), [id]: value });
  const specials = [
    { value: "", label: "Not mapped (kept in the capture)" },
    ...NOTE_TARGETS.map(t => ({ value: t.value, label: t.label, icon: <NotepadRegular /> }))
  ];

  return (
    <div style={{ marginTop: 32, maxWidth: 720 }}>
      <Text as="h2" size={500} weight="semibold" block>Data Services</Text>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
        <Text weight="semibold">EZLynx</Text>
        <a href="#" onClick={e => { e.preventDefault(); void setDataServiceMap("ezlynx", {}); }}>Reset to defaults</a>
      </div>
      {(["Applicant", "Co-applicants"] as const).map(section => (
        <div key={section} style={{ marginTop: 8 }}>
          <Text size={200} weight="semibold" block>{section}{section === "Co-applicants" ? " (one row per person)" : ""}</Text>
          {EZLYNX_FIELDS.filter(f => f.section === section).map(f => {
            const target = targets[f.id] ?? "";
            // co-applicant list targets resolve per row; the column is the same
            const concrete = target.replace("crm:contacts[]", "crm:contact2");
            const col = choiceColumnOf(concrete, catalog);
            const key = col ? columnKeyOf(concrete) : null;
            return (
              <div key={f.id}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
                  <span style={{ width: 140, flexShrink: 0, fontSize: 13, paddingTop: 4 }}>{f.label}</span>
                  <TargetPicker
                    value={target}
                    onChange={v => choose(f.id, v)}
                    groups={groups}
                    specials={specials}
                    currentText={target || undefined}
                  />
                  {col && (
                    <Tooltip content="Map each choice to its CRM choice" relationship="label" withArrow>
                      <Button
                        size="small"
                        appearance={open === f.id ? "primary" : "subtle"}
                        icon={<TextBulletListLtrRegular />}
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
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
