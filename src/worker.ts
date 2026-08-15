import { routeMessage, realDeps } from "@/workerRouter";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  routeMessage(msg, realDeps).then(sendResponse);
  return true;
});
