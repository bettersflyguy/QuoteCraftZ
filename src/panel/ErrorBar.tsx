import { Button, MessageBar, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import { send, PanelError } from "./api";

/**
 * Renders a PanelError per its Res `kind` (spec: Error handling):
 * - "session"   -> warning bar with the message
 * - "normalize" -> error bar + "Copy payload" button (writes `detail` to the clipboard)
 * - "auth"      -> sign-in button that sends auth/signIn then retries the failed call
 * - "http" / "unknown" -> plain error bar
 */
export function ErrorBar({ error, onRetry }: { error: PanelError; onRetry?: () => void }) {
  if (error.kind === "session") {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Site session</MessageBarTitle>
          {error.message}
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (error.kind === "normalize") {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>Couldn&apos;t read this page&apos;s results</MessageBarTitle>
          {error.message} (the extension may need an update)
          <div style={{ marginTop: 4 }}>
            <Button size="small" onClick={() => navigator.clipboard.writeText(error.detail ?? "")}>
              Copy payload
            </Button>
          </div>
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (error.kind === "auth") {
    const signIn = async () => {
      try {
        await send({ type: "auth/signIn" });
        onRetry?.();
      } catch {
        /* sign-in itself failed; the bar stays up for another attempt */
      }
    };
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>Sign-in required</MessageBarTitle>
          {error.message}
          <div style={{ marginTop: 4 }}>
            <Button size="small" appearance="primary" onClick={signIn}>
              Sign in
            </Button>
          </div>
        </MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <MessageBar intent="error">
      <MessageBarBody>{error.message}</MessageBarBody>
    </MessageBar>
  );
}
