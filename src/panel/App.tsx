import { useCallback, useEffect, useRef, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { HomeRegular } from "@fluentui/react-icons";
import { EnvBadge } from "./EnvBadge";
import { MappingsManager } from "./MappingsManager";
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
  const [page, setPage] = useState<PageContext | null>(null);
  // an environment switch re-matches held quotes' carriers: remount intake
  const [envNonce, setEnvNonce] = useState(0);

  // The panel's mode follows the ACTIVE tab: Bold Penguin -> commercial
  // capture; every other work site (carrier portals, AMS pages, EZLynx via
  // its data service) -> the shared intake. Re-query on tab switches.
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

  // One intake for every source; tabs with nothing to work on (CRM,
  // Settings, edge://) say so.
  const rawMode: "commercial" | "portal" | "idle" =
    page?.kind === "boldpenguin" ? "commercial" :
    page?.kind === "other" || page?.kind === "ezlynx" ? "portal" :
    "idle";

  // While a CRM load / fill flow is active, the mode is PINNED: the
  // interactive sign-in popup (login.microsoftonline.com) briefly becomes the
  // active tab, and following it would unmount the in-flight flow and dump
  // the user onto another screen mid-commit.
  const [flowActive, setFlowActive] = useState(false);
  const [showMappings, setShowMappings] = useState(false);  const lastModeRef = useRef(rawMode);
  const mode = flowActive ? lastModeRef.current : rawMode;
  lastModeRef.current = mode;

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
          <EnvBadge onOpenMappings={() => setShowMappings(true)} onEnvChanged={() => setEnvNonce(n => n + 1)} />
        </div>
      </div>
      <div className={styles.body}>
        {showMappings && <MappingsManager />}
        {!showMappings && <>
        {mode === "idle" && (
          <div style={{ fontSize: "12px", color: tokens.colorNeutralForeground3 }}>Nothing to work on in this tab.</div>
        )}
        {mode === "commercial" && <CommercialCapture onChanged={refreshPage} onFlowActive={setFlowActive} />}
        {mode === "portal" && <PortalFill key={envNonce} onChanged={refreshPage} onFlowActive={setFlowActive} />}
        </>}
      </div>
    </div>
  );
}
