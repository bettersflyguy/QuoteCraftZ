import { useEffect } from "react";
import { makeStyles, tokens, Title3 } from "@fluentui/react-components";
import { useImportState } from "./state";
import { EnvBadge } from "./EnvBadge";
import { RunPicker } from "./steps/RunPicker";
import { AccountMatch } from "./steps/AccountMatch";
import { OpportunityPin } from "./steps/OpportunityPin";
import { CarrierMap } from "./steps/CarrierMap";
import { ReviewCommit } from "./steps/ReviewCommit";

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
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0
  },
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
        <Title3>D365 Insurance Quote Connector</Title3>
        <EnvBadge dispatch={dispatch} />
      </div>
      <div className={styles.body}>
        {state.step === "run" && (
          <RunPicker key={state.ezlynxApplicantId ?? "none"} state={state} dispatch={dispatch} />
        )}
        {state.step === "account" && <AccountMatch state={state} dispatch={dispatch} />}
        {state.step === "opportunities" && <OpportunityPin state={state} dispatch={dispatch} />}
        {state.step === "carriers" && <CarrierMap state={state} dispatch={dispatch} />}
        {(state.step === "review" || state.step === "done") && (
          <ReviewCommit state={state} dispatch={dispatch} />
        )}
      </div>
    </div>
  );
}
