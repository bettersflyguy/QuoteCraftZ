import type { CapturedRun, RunListItem } from "@/types";
import type { CommitPayload } from "@/crm/mapping";
import type { NewAccountFields } from "@/crm/dataverse";
import type { CapturedApplication, PortalFillResult } from "@/boldpenguin/types";

export type { CommitPayload, CapturedApplication, PortalFillResult };

/** What kind of page the active tab is showing — drives the panel's mode.
 * "crm" (Dynamics / Microsoft sign-in) renders the default wizard, never the
 * portal card. "other" is a candidate carrier portal (ingest/fill). */
export type PageKind = "ezlynx" | "boldpenguin" | "crm" | "other";
export interface PageContext {
  kind: PageKind;
  /** A Bold Penguin application is held in session storage, ready to fill portals. */
  hasCapturedApplication: boolean;
}

export type BridgeRequest =
  | { type: "ezlynx/getContext" }
  | { type: "ezlynx/listRuns"; applicantId: number }
  | { type: "ezlynx/captureRun"; applicantId: number; run: RunListItem };

export type PanelRequest =
  | { type: "panel/getEzlynxContext" }
  | { type: "panel/listRuns"; applicantId: number }
  | { type: "panel/captureRun"; applicantId: number; run: RunListItem }
  | { type: "panel/searchAccounts"; name: string; postalCode: string | null }
  | { type: "panel/getOpportunities"; accountId: string }
  | { type: "panel/getCarriers" }
  | { type: "panel/searchUsers"; query: string }
  | { type: "panel/createAccount"; fields: NewAccountFields }
  | { type: "panel/getLobs" }
  | { type: "panel/createOpportunity"; accountId: string; lobId: string; name: string; pipelineId: string | null; stageId: string | null }
  | { type: "panel/getStagesForLob"; lobId: string | null }
  | { type: "panel/saveCarrierAlias"; ezlynxId: number; carrierId: string }
  | { type: "panel/commit"; payload: CommitPayload }
  | { type: "panel/getPageContext" }
  | { type: "panel/bpCapture" }
  | { type: "panel/bpGetCaptured" }
  | { type: "panel/bpClear" }
  | { type: "panel/portalFill"; tabId: number; overwrite: boolean }
  | { type: "panel/portalIngest"; tabId: number }
  | { type: "env/list" }
  | { type: "env/setActive"; id: string }
  | { type: "auth/signIn" };

export interface CaptureRunResponse { run: CapturedRun; aliases: Record<number, string> }

/** Fire-and-forget broadcast from the EZLynx content script when the SPA
 * navigates to a different applicant. The panel listens; the worker ignores. */
export interface ApplicantChangedBroadcast { type: "ezlynx/applicantChanged"; applicantId: number | null }

export interface BridgeResponse<T = unknown> { ok: true; data: T }
export interface BridgeError {
  ok: false;
  error: string;
  kind: "normalize" | "session" | "auth" | "http" | "unknown";
  detail?: string;
}
export type Res<T> = BridgeResponse<T> | BridgeError;
