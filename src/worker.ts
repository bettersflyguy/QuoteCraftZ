import { clearFieldCatalogCache } from "@/crm/fieldCatalog";
import { routeMessage, realDeps, handleAutoCaptured, registerAutoCapReinjection } from "@/workerRouter";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
registerAutoCapReinjection();

// AB#3745: after an extension update the cached CRM field list (read by the
// old build) is dropped, so the next read is live. A failure is logged, never
// swallowed; getFieldCatalog also ignores a catalog from another build.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "update" || details.reason === "install") {
    clearFieldCatalogCache().catch(e => console.warn("QuoteCraftZ: could not clear the CRM field cache after update", e));
  }
});

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
