import { useCallback, useEffect, useState } from "react";
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

interface IngestOutcome { added: number; total: number; app: CapturedApplication }

function businessName(app: CapturedApplication | null): string | null {
  const name = app?.normalized["business"]?.["legalName"] ?? app?.normalized["contact"]?.["fullName"];
  return typeof name === "string" && name ? name : null;
}

/** Requests access to the active tab's origin (user gesture required — that's
 * why this lives in the panel) and returns the tab. Portals aren't in the
 * manifest's host list; each site is granted individually at click time. */
async function grantActiveTab(): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https:/i.test(tab.url)) {
    throw new PanelError("session", "The active tab is not a readable page. Open the carrier portal, then retry.");
  }
  const origin = `${new URL(tab.url).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new PanelError("session", "Access to this site was declined — nothing was read or filled.");
  }
  return { id: tab.id, url: tab.url };
}

/** Carrier-portal mode: the active tab is neither EZLynx, Bold Penguin, nor the
 * CRM. Ingest reads the visible insured data on this page into the held
 * application; Fill writes the held application into this page's form. */
export function PortalFill({ onChanged }: { onChanged: () => void }) {
  const styles = useStyles();
  const [app, setApp] = useState<CapturedApplication | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState<"fill" | "ingest" | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [fillResult, setFillResult] = useState<PortalFillResult | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestOutcome | null>(null);

  const refresh = useCallback(() => {
    send<CapturedApplication | null>({ type: "panel/bpGetCaptured" }).then(setApp).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (kind: "fill" | "ingest") => {
    setBusy(kind);
    setError(null);
    setFillResult(null);
    setIngestResult(null);
    try {
      const tab = await grantActiveTab();
      if (kind === "fill") {
        setFillResult(await send<PortalFillResult>({ type: "panel/portalFill", tabId: tab.id, overwrite }));
      } else {
        const outcome = await send<IngestOutcome>({ type: "panel/portalIngest", tabId: tab.id });
        setIngestResult(outcome);
        setApp(outcome.app);
        onChanged();
      }
    } catch (e) {
      setError(e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e)));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    await send({ type: "panel/bpClear" }).catch(() => {});
    setApp(null);
    setFillResult(null);
    setIngestResult(null);
    onChanged();
  };

  const name = businessName(app);

  return (
    <div className={styles.root}>
      <div className={styles.title}>Carrier portal</div>
      {app
        ? <div className={styles.ready}>{name ?? "Application ready"}</div>
        : <div className={styles.hint}>
            Nothing captured yet. Ingest this page to pull the insured data shown
            here, or capture a completed application in Bold Penguin.
          </div>}
      {error && <ErrorBar error={error} />}
      <div className={styles.buttons}>
        <Button appearance={app ? "secondary" : "primary"} disabled={busy !== null} onClick={() => run("ingest")}>
          {busy === "ingest" ? <Spinner size="tiny" /> : "Ingest this page"}
        </Button>
        <Button appearance="primary" disabled={busy !== null || !app} onClick={() => run("fill")}>
          {busy === "fill" ? <Spinner size="tiny" /> : "Fill this page"}
        </Button>
      </div>
      <div className={styles.hint}>
        Ingest reads the insured data visible on this page into the held
        application (existing values are never replaced). Fill populates this
        page's form from it, highlighting what changed — it never clicks Next,
        Save, Get Quote, or Submit. Each site is granted individually.
      </div>
      {app && (
        <Checkbox
          checked={overwrite}
          onChange={(_, d) => setOverwrite(Boolean(d.checked))}
          label="Fill: overwrite fields that already have values"
        />
      )}
      {ingestResult && (
        <div className={styles.result}>
          Ingested {ingestResult.added} new field{ingestResult.added === 1 ? "" : "s"} from this page
          ({ingestResult.total} held in total). Switch to the next portal or rater and fill from it.
        </div>
      )}
      {fillResult && (
        <div className={styles.result}>
          Filled {fillResult.filledCount} of {fillResult.controlCount} form fields
          {fillResult.existingCount ? `; ${fillResult.existingCount} kept their existing values` : ""}
          {fillResult.optionMismatchCount ? `; ${fillResult.optionMismatchCount} had no matching option` : ""}.
          {fillResult.filledCount ? " Review the highlighted values before moving on." : " Move to the portal page that shows the application form and retry."}
        </div>
      )}
      {app && (
        <div className={styles.buttons}>
          <Button onClick={clear}>Clear captured application</Button>
        </div>
      )}
    </div>
  );
}
