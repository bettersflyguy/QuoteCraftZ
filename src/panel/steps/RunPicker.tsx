import { useEffect, useState } from "react";
import { Button, Spinner, Card, CardHeader, Text } from "@fluentui/react-components";
import { ArrowClockwiseRegular } from "@fluentui/react-icons";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { RunListItem } from "@/types";
import type { CaptureRunResponse } from "@/messages";

export function RunPicker({
  state,
  dispatch
}: {
  state: ImportState;
  dispatch: (a: Action) => void;
}) {
  const [err, setErr] = useState<PanelError | null>(null);
  const [loading, setLoading] = useState(false);
  const [capturingId, setCapturingId] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const ctx = await send<{ applicantId: number | null }>({ type: "panel/getEzlynxContext" });
        if (cancelled) return;
        dispatch({ t: "context", applicantId: ctx.applicantId });
        if (ctx.applicantId) {
          const runs = await send<RunListItem[]>({
            type: "panel/listRuns",
            applicantId: ctx.applicantId
          });
          if (cancelled) return;
          dispatch({ t: "runs", runs });
        }
      } catch (e) {
        if (!cancelled) setErr(e as PanelError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  async function pick(run: RunListItem) {
    if (state.ezlynxApplicantId == null) return;
    setCapturingId(run.applicationId);
    setErr(null);
    try {
      const res = await send<CaptureRunResponse>({
        type: "panel/captureRun",
        applicantId: state.ezlynxApplicantId,
        run
      });
      dispatch({ t: "captured", run: res.run, aliases: res.aliases });
    } catch (e) {
      setErr(e as PanelError);
    } finally {
      setCapturingId(null);
    }
  }

  return (
    <div>
      {err && <ErrorBar error={err} onRetry={() => setRefreshNonce(n => n + 1)} />}

      {!loading && state.ezlynxApplicantId == null && (
        <Card>
          <CardHeader header={<Text weight="semibold">No EZLynx applicant in context</Text>} />
          <Text>Open an EZLynx applicant page, then Refresh.</Text>
        </Card>
      )}

      <div style={{ marginTop: 12 }}>
        <Button
          icon={<ArrowClockwiseRegular />}
          onClick={() => setRefreshNonce(n => n + 1)}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {loading && <Spinner label="Loading…" style={{ marginTop: 12 }} />}

      {!loading && state.ezlynxApplicantId != null && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {state.runs.length === 0 && <Text>No recent rate runs found for this applicant.</Text>}
          {state.runs.map(run => (
            <Card key={run.applicationId} onClick={() => pick(run)} style={{ cursor: "pointer" }}>
              <CardHeader
                header={<Text weight="semibold">{run.lobs}</Text>}
                description={
                  <Text size={200}>
                    {new Date(run.created).toLocaleString()} {run.description}
                  </Text>
                }
                action={capturingId === run.applicationId ? <Spinner size="tiny" /> : undefined}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
