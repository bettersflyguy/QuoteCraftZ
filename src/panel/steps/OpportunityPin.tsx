import { useEffect, useState } from "react";
import { Button, Dropdown, Option, Card, CardHeader, Text, Spinner } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { OppSummary } from "@/crm/dataverse";

const SKIP = "__skip__";

export function OpportunityPin({
  state,
  dispatch
}: {
  state: ImportState;
  dispatch: (a: Action) => void;
}) {
  const [opps, setOpps] = useState<OppSummary[] | null>(null);
  const [err, setErr] = useState<PanelError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!state.accountId) return;
    (async () => {
      setErr(null);
      try {
        const rows = await send<OppSummary[]>({
          type: "panel/getOpportunities",
          accountId: state.accountId!
        });
        setOpps(rows);
      } catch (e) {
        setErr(e as PanelError);
      }
    })();
  }, [state.accountId, reloadNonce]);

  if (err) return <ErrorBar error={err} onRetry={() => setReloadNonce(n => n + 1)} />;
  if (!opps) return <Spinner label="Loading opportunities…" />;

  const blocks = state.captured?.blocks ?? [];
  const allDecided = blocks.every(b => b.lob in state.blockSelections);

  function sortedOpps(lob: string): OppSummary[] {
    return [...opps!].sort((a, b) => {
      const am = a.lobName?.toLowerCase().includes(lob.toLowerCase()) ? 0 : 1;
      const bm = b.lobName?.toLowerCase().includes(lob.toLowerCase()) ? 0 : 1;
      return am - bm;
    });
  }

  function choose(lob: string, value: string) {
    if (value === SKIP) {
      dispatch({ t: "pinBlock", lob, sel: null });
      return;
    }
    const opp = opps!.find(o => o.opportunityId === value);
    if (!opp) return;
    dispatch({
      t: "pinBlock",
      lob,
      sel: {
        opportunityId: opp.opportunityId,
        lineOfBusinessId: opp.lobId,
        desiredEffectiveDate: opp.desiredEffectiveDate ? opp.desiredEffectiveDate.slice(0, 10) : null
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {blocks.map(b => {
        const decided = b.lob in state.blockSelections;
        const sel = state.blockSelections[b.lob];
        const value = decided ? (sel ? sel.opportunityId : SKIP) : undefined;
        const label = decided
          ? sel
            ? opps!.find(o => o.opportunityId === sel.opportunityId)?.name ?? sel.opportunityId
            : "Skipped"
          : "Choose an opportunity or skip";
        return (
          <Card key={b.lob}>
            <CardHeader
              header={
                <Text weight="semibold">
                  {b.lob} — {b.quotes.length} quotes
                </Text>
              }
            />
            <Dropdown
              placeholder="Choose an opportunity or skip"
              value={label}
              selectedOptions={value ? [value] : []}
              onOptionSelect={(_, d) => choose(b.lob, d.optionValue as string)}
            >
              {sortedOpps(b.lob).map(o => (
                <Option key={o.opportunityId} value={o.opportunityId}>
                  {o.name}
                </Option>
              ))}
              <Option value={SKIP}>Skip this LOB</Option>
            </Dropdown>
          </Card>
        );
      })}

      <Text size={200}>
        {blocks
          .map(
            b =>
              `${b.lob} ${
                b.lob in state.blockSelections
                  ? state.blockSelections[b.lob]
                    ? "pinned"
                    : "skipped"
                  : "pending"
              }`
          )
          .join(", ")}
      </Text>

      <Button
        appearance="primary"
        disabled={!allDecided}
        onClick={() => dispatch({ t: "goto", step: "carriers" })}
      >
        Continue
      </Button>
    </div>
  );
}
