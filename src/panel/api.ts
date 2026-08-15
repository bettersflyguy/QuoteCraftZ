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

/** Wraps chrome.runtime.sendMessage with the PanelRequest/Res<T> contract. */
export async function send<T>(msg: PanelRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Res<T>;
  if (!res.ok) throw new PanelError(res.kind, res.error, res.detail);
  return res.data;
}
