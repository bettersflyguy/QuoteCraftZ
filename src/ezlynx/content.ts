import { fetchRunList, fetchCapturedRun, applicantIdFromUrl, EzlynxSessionError } from "./client";
import { NormalizeError } from "./normalize";
import type { BridgeRequest, Res } from "@/messages";

chrome.runtime.onMessage.addListener((msg: BridgeRequest, _sender, sendResponse: (r: Res<unknown>) => void) => {
  (async () => {
    try {
      switch (msg.type) {
        case "ezlynx/getContext":
          return sendResponse({ ok: true, data: { applicantId: applicantIdFromUrl(location.href) } });
        case "ezlynx/listRuns":
          return sendResponse({ ok: true, data: await fetchRunList(msg.applicantId) });
        case "ezlynx/captureRun":
          return sendResponse({ ok: true, data: await fetchCapturedRun(msg.applicantId, msg.run) });
      }
    } catch (e) {
      if (e instanceof EzlynxSessionError) {
        return sendResponse({ ok: false, error: "EZLynx session expired — sign in on the EZLynx tab and retry.", kind: "session" });
      }
      if (e instanceof NormalizeError) {
        return sendResponse({ ok: false, error: "Couldn't read EZLynx results — the extension needs an update.", kind: "normalize", detail: `${e.message}\n---payload---\n${e.payloadSnippet}` });
      }
      return sendResponse({ ok: false, error: String(e), kind: "unknown" });
    }
  })();
  return true; // async response
});
