import { Text } from "@fluentui/react-components";
import { DataServiceMapEditor } from "@/panel/DataServiceMapEditor";

/** Mappings for sources read through a data service. The same editor opens
 * from the Mappings page on the source's own site. */
export function DataServicesSection() {
  return (
    <div style={{ marginTop: 32, maxWidth: 720 }}>
      <Text as="h2" size={500} weight="semibold" block>Data Services</Text>
      <div style={{ marginTop: 8 }}>
        <DataServiceMapEditor source="ezlynx" />
      </div>
    </div>
  );
}
