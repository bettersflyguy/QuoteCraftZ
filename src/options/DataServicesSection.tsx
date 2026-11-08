import { Text } from "@fluentui/react-components";
import { DataServiceMapEditor } from "@/panel/DataServiceMapEditor";
import { useSettingsTransfer } from "./SettingsTransfer";

/** Mappings for sources read through a data service. The same editor opens
 * from the Mappings page on the source's own site. */
export function DataServicesSection() {
  const t = useSettingsTransfer({ kind: "dataservice", source: "ezlynx" });
  return (
    <div style={{ marginTop: 32, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text as="h2" size={500} weight="semibold">Data Services</Text>
        {t.icons}
      </div>
      {t.panel}
      <div style={{ marginTop: 8 }}>
        <DataServiceMapEditor source="ezlynx" />
      </div>
    </div>
  );
}