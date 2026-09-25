import { useEffect, useState } from "react";
import { Button, Checkbox, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { CapturedApplication, PortalFillResult } from "@/messages";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  title: { fontSize: "14px", fontWeight: 600 },
  hint: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  ready: { fontSize: "13px", fontWeight: 600 },
  result: {
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "8px"
  },
  buttons: { display: "flex", gap: "8px", flexWrap: "wrap" }
});

/** Portal-fill mode: a Bold Penguin application is captured and the active tab
 * is some other site (a carrier portal). Fills the visible form fields from the
 * capture — highlights what it changed and never clicks Next/Save/Submit. */
export function PortalFill({ onCleared }: { onCleared: () => void }) {
  const styles = useStyles();
  const [business, setBusiness] = useState<string>("Application ready");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);
  const [result, setResult] = useState<PortalFillResult | null>(null);

  useEffect(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" })
      .then(app => {
        const name = app?.normalized["business"]?.["legalName"];
        if (typeof name === "string" && name) setBusiness(name);
      })
      .catch(() => {});
  }, []);

  const fill = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url || !/^https:/i.test(tab.url)) {
        throw new PanelError("session", "The active tab is not a fillable page. Open the carrier portal's form, then retry.");
      }
      // Carrier portals aren't in the manifest's host list; ask for this origin
      // now (user gesture required, which is why this runs in the panel).
      const origin = `${new URL(tab.url).origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        throw new PanelError("session", "Access to this site was declined — the filler can't run without it.");
      }
      setResult(await send<PortalFillResult>({ type: "panel/portalFill", tabId: tab.id, overwrite }));
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await send({ type: "panel/bpClear" }).catch(() => {});
    onCleared();
  };

  return (
    <div className={styles.root}>
      <div className={styles.title}>Fill carrier portal</div>
      <div className={styles.ready}>{business}</div>
      <div className={styles.hint}>
        Populate matching fields on this page from the captured Bold Penguin
        application. Filled values are highlighted — review everything before
        continuing. It never clicks Next, Save, Get Quote, or Submit.
      </div>
      {error && <ErrorBar error={error} onRetry={fill} />}
      <Checkbox
        checked={overwrite}
        onChange={(_, d) => setOverwrite(Boolean(d.checked))}
        label="Overwrite fields that already have values"
      />
      <Button appearance="primary" disabled={busy} onClick={fill}>
        {busy ? <Spinner size="tiny" /> : "Fill this page"}
      </Button>
      {result && (
        <div className={styles.result}>
          Filled {result.filledCount} of {result.controlCount} form fields
          {result.existingCount ? `; ${result.existingCount} kept their existing values` : ""}
          {result.optionMismatchCount ? `; ${result.optionMismatchCount} had no matching option` : ""}.
          {result.filledCount ? " Review the highlighted values before moving on." : " Move to the portal page that shows the application form and retry."}
        </div>
      )}
      <div className={styles.buttons}>
        <Button onClick={clear}>Clear captured application</Button>
      </div>
    </div>
  );
}
