import { routeMessage, realDeps, handleAutoCaptured, registerAutoCapReinjection } from "@/workerRouter";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
registerAutoCapReinjection();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = (msg as { type?: string }).type;
  if (type === "ezlynx/applicantChanged") return false; // panel-bound broadcast
  if (type === "portal/captureUpdated") return false; // panel-bound broadcast

  if (type === "portal/autoCaptured") {
    handleAutoCaptured(msg as { url: string }, sender.tab?.id)
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }

  routeMessage(msg, realDeps).then(sendResponse, e =>
    sendResponse({ ok: false, error: String((e as Error)?.message ?? e), kind: "unknown" })
  );
  return true;
});
