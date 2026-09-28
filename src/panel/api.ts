import type { PanelRequest, Res, BridgeError } from "@/messages";

/** Thrown by send() when the worker responds ok:false. Carries the Res error kind so
 * step components can branch on it (session/normalize/auth/http/unknown - spec: Error handling). */
export class PanelError extends Error {
  kind: BridgeError["kind"];
  detail?: string;
  constructor(kind: BridgeError["kind"], message: string, detail?: string) {
    super(message);
    this.name = "PanelError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** Longer than any legitimate round-trip (interactive sign-in excepted - see below). */
const TIMEOUT_MS = 25_000;
/** Interactive sign-in legitimately waits on a human at the account picker. */
const AUTH_TIMEOUT_MS = 180_000;
/** Bold Penguin capture walks every question set in the application — minutes, not seconds. */
const BP_CAPTURE_TIMEOUT_MS = 240_000;

/** Wraps chrome.runtime.sendMessage with the PanelRequest/Res<T> contract.
 * A message that never gets a response (dead worker, orphaned content script
 * holding the port open) surfaces as a diagnosable error instead of an
 * infinite spinner. */
export async function send<T>(msg: PanelRequest): Promise<T> {
  // any first CRM call of a browser session can trigger the INTERACTIVE
  // sign-in inside the worker — those must wait on a human, not 25s
  const CRM_WRITE_TYPES = new Set([
    "auth/signIn", "panel/appCommit", "panel/createLead", "panel/createPolicy",
    "panel/crmPull", "panel/findMatches", "panel/createAccount", "panel/createOpportunity"
  ]);
  const timeoutMs =
    CRM_WRITE_TYPES.has(msg.type) ? AUTH_TIMEOUT_MS :
    msg.type === "panel/bpCapture" ? BP_CAPTURE_TIMEOUT_MS :
    TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new PanelError(
            "unknown",
            `No response to ${msg.type} after ${timeoutMs / 1000}s. If the extension was just updated, reload the EZLynx tab and reopen this panel.`
          )
        ),
      timeoutMs
    );
  });
  try {
    const res = (await Promise.race([chrome.runtime.sendMessage(msg), timeout])) as Res<T> | undefined;
    if (!res) throw new PanelError("unknown", `Empty response to ${msg.type} — reload the EZLynx tab and retry.`);
    if (!res.ok) throw new PanelError(res.kind, res.error, res.detail);
    return res.data;
  } finally {
    clearTimeout(timer);
  }
}
