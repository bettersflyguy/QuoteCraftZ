import { fetchApplicant, fetchRunList, fetchCapturedRun, applicantIdFromUrl, EzlynxSessionError } from "./client";
import { NormalizeError } from "./normalize";
import type { ApplicantChangedBroadcast, BridgeRequest, Res } from "@/messages";

// the worker re-injects this script to revive orphaned tabs after an
// extension update - never register the listener or poll twice in one world
const ezGuard = globalThis as { __bettersEzLoaded?: boolean };
const ezAlreadyLoaded = ezGuard.__bettersEzLoaded === true;
ezGuard.__bettersEzLoaded = true;

if (!ezAlreadyLoaded) chrome.runtime.onMessage.addListener((msg: BridgeRequest, _sender, sendResponse: (r: Res<unknown>) => void) => {
  // only bridge requests: other scripts in this tab (auto-capture) answer their own
  if (!String((msg as { type?: string })?.type ?? "").startsWith("ezlynx/")) return false;
  (async () => {
    try {
      switch (msg.type) {
        case "ezlynx/getContext":
          return sendResponse({ ok: true, data: { applicantId: applicantIdFromUrl(location.href) } });
        case "ezlynx/listRuns":
          return sendResponse({ ok: true, data: await fetchRunList(msg.applicantId) });
        case "ezlynx/captureRun":
          return sendResponse({ ok: true, data: await fetchCapturedRun(msg.applicantId, msg.run) });
        case "ezlynx/getApplicant":
          return sendResponse({ ok: true, data: await fetchApplicant(msg.applicantId) });
        default:
          return sendResponse({ ok: false, error: `unknown bridge message: ${(msg as { type: string }).type}`, kind: "unknown" });
      }
    } catch (e) {
      if (e instanceof EzlynxSessionError) {
        return sendResponse({ ok: false, error: "EZLynx session expired. Sign in on the EZLynx tab and retry.", kind: "session" });
      }
      if (e instanceof NormalizeError) {
        return sendResponse({ ok: false, error: "Couldn't read EZLynx results. The extension needs an update.", kind: "normalize", detail: `${e.message}\n---payload---\n${e.payloadSnippet}` });
      }
      return sendResponse({ ok: false, error: String(e), kind: "unknown" });
    }
  })();
  return true; // async response
});

// EZLynx is an SPA - full navigations are rare, so poll the URL for applicant
// changes and broadcast them. The panel resets its wizard on a change; a stale
// capture otherwise lets an agent pin one customer's opportunity against
// another customer's quotes.
let lastApplicantId = applicantIdFromUrl(location.href);
if (!ezAlreadyLoaded) setInterval(() => {
  const current = applicantIdFromUrl(location.href);
  if (current !== lastApplicantId) {
    lastApplicantId = current;
    const msg: ApplicantChangedBroadcast = { type: "ezlynx/applicantChanged", applicantId: current };
    chrome.runtime.sendMessage(msg).catch(() => {
      /* no listener (panel closed) - fine */
    });
  }
}, 1500);
