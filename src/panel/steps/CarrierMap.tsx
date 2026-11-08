import { useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Option, Text, Spinner } from "@fluentui/react-components";
import { WarningRegular } from "@fluentui/react-icons";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { CarrierRow } from "@/crm/dataverse";

export function CarrierMap({
  state,
  dispatch
}: {
  state: ImportState;
  dispatch: (a: Action) => void;
}) {
  const [carriers, setCarriers] = useState<CarrierRow[] | null>(null);
  const [err, setErr] = useState<PanelError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    (async () => {
      setErr(null);
      try {
        setCarriers(await send<CarrierRow[]>({ type: "panel/getCarriers" }));
      } catch (e) {
        setErr(e as PanelError);
      }
    })();
  }, [reloadNonce]);

  // Distinct carriers across selected (pinned, not skipped) blocks only.
  const distinctCarriers = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of state.captured?.blocks ?? []) {
      if (!state.blockSelections[b.lob]) continue;
      for (const q of b.quotes) map.set(q.carrierEzlynxId, q.carrierName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [state.captured, state.blockSelections]);

  if (err) return <ErrorBar error={err} onRetry={() => setReloadNonce(n => n + 1)} />;
  if (!carriers) return <Spinner label="Loading carriers…" />;

  function choose(ezlynxId: number, carrierId: string) {
    dispatch({ t: "mapCarrier", ezlynxId, carrierId });
    // persist immediately - each carrier is mapped once, ever (spec: Carrier map)
    send({ type: "panel/saveCarrierAlias", ezlynxId, carrierId }).catch(() => {
      /* best-effort persistence; the local mapping already applied for this session */
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {distinctCarriers.length === 0 && <Text>No carriers to map for the pinned LOBs.</Text>}
      {distinctCarriers.map(c => {
        const mapped = state.carrierMap[c.id] ?? null;
        return (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <Text weight="semibold" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {!mapped && <WarningRegular />}
              {c.name}{" "}
              <Text size={200} style={{ fontWeight: 400 }}>
                · EZLynx #{c.id}
              </Text>
            </Text>
            <Dropdown
              placeholder="Map to CRM carrier"
              value={carriers.find(cr => cr.carrierId === mapped)?.name ?? ""}
              selectedOptions={mapped ? [mapped] : []}
              onOptionSelect={(_, d) => choose(c.id, d.optionValue as string)}
              style={{ width: "100%", minWidth: 0 }}
            >
              {carriers.map(cr => (
                <Option key={cr.carrierId} value={cr.carrierId}>
                  {cr.name}
                </Option>
              ))}
            </Dropdown>
            {!mapped && (
              <Text size={200} style={{ fontStyle: "italic" }}>
                Unmapped: will import without a carrier link
              </Text>
            )}
          </div>
        );
      })}
      <Button appearance="primary" onClick={() => dispatch({ t: "goto", step: "review" })}>
        Continue
      </Button>
    </div>
  );
}
