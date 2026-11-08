import { useCallback, useEffect, useRef, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { HomeRegular } from "@fluentui/react-icons";
import { useImportState } from "./state";
import { EnvBadge } from "./EnvBadge";
import { MappingsManager } from "./MappingsManager";
import { RunPicker } from "./steps/RunPicker";
import { AccountMatch } from "./steps/AccountMatch";
import { OpportunityPin } from "./steps/OpportunityPin";
import { CarrierMap } from "./steps/CarrierMap";
import { ReviewCommit } from "./steps/ReviewCommit";
import { CommercialCapture } from "./steps/CommercialCapture";
import { PortalFill } from "./steps/PortalFill";
import { send } from "./api";
import type { PageContext } from "@/messages";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: tokens.fontFamilyBase
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "2px 12px",
    borderBottom: "2px solid #002f87",
    flexShrink: 0
  },
  logo: { width: "20px", height: "20px", flexShrink: 0 },
  body: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "12px"
  }
});

export function App() {
  const styles = useStyles();
  const [state, dispatch] = useImportState();
  const [page, setPage] = useState<PageContext | null>(null);

  // The panel's mode follows the ACTIVE tab: EZLynx -> personal-lines wizard,
  // Bold Penguin -> commercial capture, anything else with a captured
  // application -> portal fill. Re-query on tab switches and navigations.
  const refreshPage = useCallback(() => {
    send<PageContext>({ type: "panel/getPageContext" })
      .then(setPage)
      .catch(() => setPage({ kind: "other", hasCapturedApplication: false, autoCapturing: false }));
  }, []);

  useEffect(() => {
    refreshPage();
    const onActivated = () => refreshPage();
    const onUpdated = (_id: number, info: { status?: string; url?: string }) => {
      if (info.status === "complete" || info.url) refreshPage();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refreshPage]);

  // The portal card (ingest/fill) only offers itself while the personal-lines
  // wizard is idle - glancing at another tab mid-import must not hide the
  // in-progress wizard. CRM and sign-in tabs never present as portals.
  const wizardIdle = state.step === "run" && !state.captured;
  const rawMode: "commercial" | "portal" | "personal" =
    page?.kind === "boldpenguin" ? "commercial" :
    page?.kind === "other" && wizardIdle ? "portal" :
    "personal";

  // While a CRM load / fill flow is active, the mode is PINNED: the
  // interactive sign-in popup (login.microsoftonline.com) briefly becomes the
  // active tab, and following it would unmount the in-flight flow and dump
  // the user into the EZLynx wizard mid-commit.
  const [flowActive, setFlowActive] = useState(false);
  const [showMappings, setShowMappings] = useState(false);  const lastModeRef = useRef(rawMode);
  const mode = flowActive ? lastModeRef.current : rawMode;
  lastModeRef.current = mode;

  // The EZLynx content script broadcasts SPA navigations to a different
  // applicant; restart the wizard against them (stale captures cross-wire
  // customers). Key on RunPicker below forces a remount + fresh run list.
  useEffect(() => {
    const onMessage = (msg: unknown) => {
      const m = msg as { type?: string; applicantId?: number | null };
      if (m.type === "ezlynx/applicantChanged") {
        dispatch({ t: "applicantChanged", applicantId: m.applicantId ?? null });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {/* the browser's own side-panel header already shows the name
            (manifest), so this strip carries only the logo and controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <img className={styles.logo} src="/icons/32.png" alt="QuoteCraftZ" title="QuoteCraftZ" />
          <span style={{ fontSize: "13px", fontWeight: 600 }}>{showMappings ? "Mappings" : "Intake"}</span>
        </div>
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
          <Button
            appearance="subtle"
            icon={<HomeRegular />}
            title="Home"
            aria-label="Home"
            onClick={() => { setShowMappings(false); refreshPage(); }}
          />
          <EnvBadge dispatch={dispatch} onOpenMappings={() => setShowMappings(true)} />
        </div>
      </div>
      <div className={styles.body}>
        {showMappings && <MappingsManager />}
        {!showMappings && <>
        {mode === "commercial" && <CommercialCapture onChanged={refreshPage} onFlowActive={setFlowActive} />}
        {mode === "portal" && <PortalFill onChanged={refreshPage} onFlowActive={setFlowActive} />}
        {mode === "personal" && <>
        {state.step === "run" && (
          <RunPicker key={state.ezlynxApplicantId ?? "none"} state={state} dispatch={dispatch} />
        )}
        {state.step === "account" && <AccountMatch state={state} dispatch={dispatch} />}
        {state.step === "opportunities" && <OpportunityPin state={state} dispatch={dispatch} />}
        {state.step === "carriers" && <CarrierMap state={state} dispatch={dispatch} />}
        {(state.step === "review" || state.step === "done") && (
          <ReviewCommit state={state} dispatch={dispatch} />
        )}
        </>}
        </>}
      </div>
    </div>
  );
}
