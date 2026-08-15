import { routeMessage, realDeps } from "@/workerRouter";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  routeMessage(msg, realDeps).then(sendResponse, e =>
    sendResponse({ ok: false, error: String((e as Error)?.message ?? e), kind: "unknown" })
  );
  return true;
});
