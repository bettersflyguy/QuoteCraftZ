/* Auto-capture driver: while enabled, watches the page (SPA mutations + URL
 * changes), lets it settle, and tells the worker the page changed; the
 * worker runs the real Ingest with the agent's mappings (mapped, filled-in
 * values only; EZLynx through its data service). Pure observer - it never
 * clicks, types, or navigates. Injected on demand next to
 * portal-ingest.js after the user enables auto-capture for this site. */
(function () {
  "use strict";

  if (globalThis.__bettersAutoCapLoaded) {
    globalThis.__bettersAutoCapEnabled = true;
    return;
  }
  globalThis.__bettersAutoCapLoaded = true;
  globalThis.__bettersAutoCapEnabled = true;

  let lastSignature = "";
  let timer = null;

  function fire() {
    if (!globalThis.__bettersAutoCapEnabled || !globalThis.__bettersPortalIngest) return;
    try {
      const res = globalThis.__bettersPortalIngest();
      const signature = location.href + "#" + res.fields.map((f) => f.label + "=" + f.value).sort().join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;
      chrome.runtime.sendMessage({ type: "portal/autoCaptured", url: location.href }).catch(() => {});
    } catch (_e) { /* page mid-transition - the next settle retries */ }
  }

  function settleSoon() {
    clearTimeout(timer);
    timer = setTimeout(fire, 1500);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "portal/autoCaptureStop") {
      globalThis.__bettersAutoCapEnabled = false;
      sendResponse({ ok: true });
    }
    if (message && message.type === "portal/autoCaptureStart") {
      globalThis.__bettersAutoCapEnabled = true;
      settleSoon();
      sendResponse({ ok: true });
    }
  });

  new MutationObserver(settleSoon).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  let href = location.href;
  setInterval(() => {
    if (location.href !== href) { href = location.href; settleSoon(); }
  }, 1000);
  settleSoon();
})();
