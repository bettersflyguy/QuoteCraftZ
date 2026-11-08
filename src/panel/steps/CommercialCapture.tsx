import { useEffect, useState } from "react";
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import { LoadToCrm } from "./LoadToCrm";
import { exportCaptureToExcel } from "../downloadCapture";
import type { CapturedApplication } from "@/messages";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  title: { fontSize: "14px", fontWeight: 600 },
  hint: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  warn: {
    fontSize: "12px",
    color: tokens.colorStatusWarningForeground1,
    backgroundColor: tokens.colorStatusWarningBackground1,
    borderRadius: "4px",
    padding: "8px"
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: "12px",
    rowGap: "4px",
    fontSize: "12px",
    margin: 0
  },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { margin: 0, overflowWrap: "anywhere" },
  buttons: { display: "flex", gap: "8px", flexWrap: "wrap" }
});

function lookup(app: CapturedApplication, path: string): string {
  const value = path.split(".").reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], app.normalized);
  return typeof value === "string" && value ? value : "-";
}

/** Commercial-lines mode: the active tab is a Bold Penguin application.
 * Capture walks every question set read-only, then holds the application in
 * session storage so any carrier portal tab can be filled from it. */
export function CommercialCapture({ onChanged, onFlowActive }: { onChanged: () => void; onFlowActive?: (active: boolean) => void }) {
  const styles = useStyles();
  const [app, setApp] = useState<CapturedApplication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);

  useEffect(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
  }, []);

  const capture = async () => {
    setBusy(true);
    setError(null);
    try {
      const captured = await send<CapturedApplication>({ type: "panel/bpCapture" });
      setApp(captured);
      onChanged();
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await send({ type: "panel/bpClear" }).catch(() => {});
    setApp(null);
    onChanged();
  };

  const vinCount = app ? app.fields.filter(f => /\bvin\b/i.test(f.label) && f.value).length : 0;

  return (
    <div className={styles.root}>
      <div className={styles.title}>Bold Penguin: commercial application</div>
      {error && <ErrorBar error={error} onRetry={capture} />}
      {!app && (
        <>
          <div className={styles.hint}>
            Open the completed application, then capture it. The scan visits each
            question set (including vehicle editors for VINs) and returns to where
            you were. It reads only, never saves or submits.
          </div>
          <Button appearance="primary" disabled={busy} onClick={capture}>
            {busy ? <Spinner size="tiny" /> : "Capture application"}
          </Button>
          {busy && <div className={styles.hint}>Scanning question sets… leave the Bold Penguin tab open and untouched.</div>}
        </>
      )}
      {app && (
        <>
          {!app.completion.likelyCompleted && (
            <div className={styles.warn}>
              This page did not show a recognized completion message. Confirm the
              application is complete before relying on the capture.
            </div>
          )}
          <dl className={styles.summary}>
            <dt className={styles.dt}>Business</dt><dd className={styles.dd}>{lookup(app, "business.legalName")}</dd>
            <dt className={styles.dt}>Contact</dt><dd className={styles.dd}>{lookup(app, "contact.fullName")}</dd>
            <dt className={styles.dt}>Email</dt><dd className={styles.dd}>{lookup(app, "contact.email")}</dd>
            <dt className={styles.dt}>Phone</dt><dd className={styles.dd}>{lookup(app, "contact.phone")}</dd>
            <dt className={styles.dt}>Application ID</dt><dd className={styles.dd}>{lookup(app, "application.id")}</dd>
            <dt className={styles.dt}>Effective date</dt><dd className={styles.dd}>{lookup(app, "coverage.effectiveDate")}</dd>
            <dt className={styles.dt}>Vehicle VINs</dt><dd className={styles.dd}>{String(vinCount)}</dd>
            <dt className={styles.dt}>Fields</dt><dd className={styles.dd}>{String(app.fields.length)}</dd>
          </dl>
          <div className={styles.hint}>
            Captured {new Date(app.capturedAt).toLocaleString()}. Switch to a carrier
            portal tab; this panel offers "Fill this page" there.
          </div>
          <LoadToCrm key={app.capturedAt} app={app} onFlowActive={onFlowActive} />
          <div className={styles.buttons}>
            <Button disabled={busy} onClick={capture}>{busy ? <Spinner size="tiny" /> : "Re-capture"}</Button>
            <Button onClick={() => exportCaptureToExcel(app)}>Export to Excel</Button>
            <Button onClick={clear}>Clear</Button>
          </div>
        </>
      )}
    </div>
  );
}
