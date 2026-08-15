import { makeStyles, tokens, Title3 } from "@fluentui/react-components";
import { useImportState } from "./state";
import { EnvBadge } from "./EnvBadge";
import { RunPicker } from "./steps/RunPicker";
import { AccountMatch } from "./steps/AccountMatch";

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
    overflow: "auto",
    padding: "12px"
  }
});

export function App() {
  const styles = useStyles();
  const [state, dispatch] = useImportState();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title3>EZLynx Quote Bridge</Title3>
        <EnvBadge dispatch={dispatch} />
      </div>
      <div className={styles.body}>
        {state.step === "run" && <RunPicker state={state} dispatch={dispatch} />}
        {state.step === "account" && <AccountMatch state={state} dispatch={dispatch} />}
        {state.step !== "run" && state.step !== "account" && <div>TODO {state.step}</div>}
      </div>
    </div>
  );
}
