import { PanelError } from "./api";

/** Requests access to the active tab's origin (user gesture required - that's
 * why this lives in the panel) and returns the tab. Portals aren't in the
 * manifest's host list; each site is granted individually at click time. */
export async function grantActiveTab(onAwaitingGrant?: (origin: string | null) => void): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https:/i.test(tab.url)) {
    throw new PanelError("session", "The active tab is not a readable page. Open the page to map, then retry.");
  }
  const origin = new URL(tab.url).origin;
  const already = await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);
  if (already) return { id: tab.id, url: tab.url };
  // first visit to this site: the browser shows a permission prompt (in Edge it
  // hides under the Extensions puzzle-piece icon) and this promise WAITS on it -
  // without the hint + timeout the panel looks dead until the prompt is found
  onAwaitingGrant?.(origin);
  try {
    const granted = await Promise.race([
      chrome.permissions.request({ origins: [`${origin}/*`] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new PanelError(
        "session",
        `The browser is waiting for you to allow access to ${origin}. Click Allow on the permission prompt (in Edge it is under the Extensions puzzle-piece icon next to the address bar), then retry.`
      )), 25000))
    ]);
    if (!granted) {
      throw new PanelError("session", "Access to this site was declined. Nothing was read or filled.");
    }
  } finally {
    onAwaitingGrant?.(null);
  }
  return { id: tab.id, url: tab.url };
}
