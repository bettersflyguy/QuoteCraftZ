import { useEffect, useMemo, useState } from "react";
import { Text } from "@fluentui/react-components";
import { NotepadRegular } from "@fluentui/react-icons";
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

  useEffect(() => {
    const load = () => void getDataServiceMaps().then(m => setSaved(m["ezlynx"] ?? {}));
    load();
    void send<FieldCatalog>({ type: "panel/crmFieldCatalog" }).then(setCatalog).catch(() => setCatalog(null));
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && DATA_SERVICE_STORAGE_KEY in changes) load();
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
          {EZLYNX_FIELDS.filter(f => f.section === section).map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
              <span style={{ width: 140, flexShrink: 0, fontSize: 13, paddingTop: 4 }}>{f.label}</span>
              <TargetPicker
                value={targets[f.id] ?? ""}
                onChange={v => choose(f.id, v)}
                groups={groups}
                specials={specials}
                currentText={targets[f.id] || undefined}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
