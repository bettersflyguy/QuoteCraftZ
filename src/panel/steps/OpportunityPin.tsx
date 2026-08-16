import { useEffect, useState } from "react";
import { Button, Dropdown, Option, Card, CardHeader, Text, Spinner, Field } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { OppSummary, LobRow } from "@/crm/dataverse";

const SKIP = "__skip__";
const CREATE = "__create__";

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
  // create-new-opportunity flow (a brand-new insured has no opps to pin)
  const [lobs, setLobs] = useState<LobRow[] | null>(null);
  const [creatingLob, setCreatingLob] = useState<string | null>(null); // which block's card shows the form
  const [chosenLobId, setChosenLobId] = useState<string | null>(null);
  const [savingLob, setSavingLob] = useState(false);

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
      setCreatingLob(null);
      dispatch({ t: "pinBlock", lob, sel: null });
      return;
    }
    if (value === CREATE) {
      void openCreate(lob);
      return;
    }
    setCreatingLob(null);
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

  async function openCreate(lob: string) {
    setCreatingLob(lob);
    setChosenLobId(null);
    try {
      const list = lobs ?? (await send<LobRow[]>({ type: "panel/getLobs" }));
      setLobs(list);
      // preselect the best LOB-name match for this block ("Auto" -> "Personal Auto")
      const match = list.find(l => l.name.toLowerCase().includes(lob.toLowerCase()));
      setChosenLobId(match?.lobId ?? null);
    } catch (e) {
      setErr(e as PanelError);
      setCreatingLob(null);
    }
  }

  async function createOpp(lob: string) {
    if (!state.accountId || !chosenLobId) return;
    setSavingLob(true);
    try {
      const lobName = lobs?.find(l => l.lobId === chosenLobId)?.name ?? lob;
      const created = await send<OppSummary>({
        type: "panel/createOpportunity",
        accountId: state.accountId,
        lobId: chosenLobId,
        name: `${state.accountName ?? "New insured"} — ${lobName}`
      });
      setOpps(prev => [...(prev ?? []), created]);
      dispatch({ t: "oppCreated", opportunityId: created.opportunityId });
      setCreatingLob(null);
      dispatch({
        t: "pinBlock",
        lob,
        sel: { opportunityId: created.opportunityId, lineOfBusinessId: created.lobId, desiredEffectiveDate: null }
      });
    } catch (e) {
      setErr(e as PanelError);
    } finally {
      setSavingLob(false);
    }
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
              <Option value={CREATE}>➕ New opportunity for this LOB…</Option>
              <Option value={SKIP}>Skip this LOB</Option>
            </Dropdown>

            {creatingLob === b.lob && (
              <div style={{ marginTop: 8 }}>
                {!lobs ? (
                  <Spinner size="tiny" label="Loading lines of business…" />
                ) : (
                  <>
                    <Field label="Line of business" required>
                      <Dropdown
                        value={lobs.find(l => l.lobId === chosenLobId)?.name ?? ""}
                        selectedOptions={chosenLobId ? [chosenLobId] : []}
                        onOptionSelect={(_, d) => setChosenLobId(d.optionValue as string)}
                      >
                        {[...lobs]
                          .sort((a, z) => {
                            const am = a.name.toLowerCase().includes(b.lob.toLowerCase()) ? 0 : 1;
                            const zm = z.name.toLowerCase().includes(b.lob.toLowerCase()) ? 0 : 1;
                            return am - zm;
                          })
                          .map(l => (
                            <Option key={l.lobId} value={l.lobId}>
                              {l.name}
                            </Option>
                          ))}
                      </Dropdown>
                    </Field>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button
                        appearance="primary"
                        disabled={savingLob || !chosenLobId}
                        onClick={() => createOpp(b.lob)}
                      >
                        {savingLob ? <Spinner size="tiny" /> : "Create & pin"}
                      </Button>
                      <Button disabled={savingLob} onClick={() => setCreatingLob(null)}>
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
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
