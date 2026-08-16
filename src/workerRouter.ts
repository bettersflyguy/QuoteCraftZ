import type { BridgeRequest, PanelRequest, Res } from "@/messages";
import type { CrmEnvironment } from "@/crm/environments";
import { getEnvironments, getActiveEnvironment, setActiveEnvironment } from "@/crm/environments";
import { getAccessToken, clearToken } from "@/crm/auth";
import {
  searchAccounts,
  getOpenOpportunities,
  getCarriers,
  getExistingQuoteStatuses,
  getQuotingMethodId,
  createQuotingMethod,
  searchUsers,
  createAccount,
  getLinesOfBusiness,
  createOpportunity,
  executeBatch
} from "@/crm/dataverse";
import { buildQuoteOps } from "@/crm/mapping";
import { getCarrierAliases, saveCarrierAlias } from "@/crm/carrierAliases";

export interface Deps {
  getEnvironments: () => Promise<CrmEnvironment[]>;
  getActiveEnvironment: () => Promise<CrmEnvironment>;
  setActiveEnvironment: (id: string) => Promise<void>;
  searchAccounts: typeof searchAccounts;
  getOpenOpportunities: typeof getOpenOpportunities;
  getCarriers: typeof getCarriers;
  getExistingQuoteStatuses: typeof getExistingQuoteStatuses;
  getQuotingMethodId: typeof getQuotingMethodId;
  createQuotingMethod: typeof createQuotingMethod;
  searchUsers: typeof searchUsers;
  createAccount: typeof createAccount;
  getLinesOfBusiness: typeof getLinesOfBusiness;
  createOpportunity: typeof createOpportunity;
  executeBatch: typeof executeBatch;
  buildQuoteOps: typeof buildQuoteOps;
  getCarrierAliases: typeof getCarrierAliases;
  saveCarrierAlias: typeof saveCarrierAlias;
  getAccessToken: typeof getAccessToken;
  clearToken: typeof clearToken;
  /** Finds the EZLynx tab, relays a BridgeRequest to its content script, returns its Res. */
  sendToEzlynxTab: <T>(req: BridgeRequest) => Promise<Res<T>>;
}

export async function routeMessage(msg: PanelRequest, deps: Deps): Promise<Res<unknown>> {
  try {
    switch (msg.type) {
      case "env/list":
        return { ok: true, data: await deps.getEnvironments() };

      case "env/setActive":
        await deps.setActiveEnvironment(msg.id);
        return { ok: true, data: null };

      case "panel/getEzlynxContext":
        return deps.sendToEzlynxTab({ type: "ezlynx/getContext" });

      case "panel/listRuns":
        return deps.sendToEzlynxTab({ type: "ezlynx/listRuns", applicantId: msg.applicantId });

      case "panel/captureRun": {
        const res = await deps.sendToEzlynxTab<import("@/types").CapturedRun>({
          type: "ezlynx/captureRun", applicantId: msg.applicantId, run: msg.run
        });
        if (!res.ok) return res;
        const env = await deps.getActiveEnvironment();
        const aliases = await deps.getCarrierAliases(env.orgUrl);
        return { ok: true, data: { run: res.data, aliases } };
      }

      case "panel/searchAccounts": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.searchAccounts(env, msg.name, msg.postalCode) };
      }

      case "panel/getOpportunities": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getOpenOpportunities(env, msg.accountId) };
      }

      case "panel/getCarriers": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getCarriers(env) };
      }

      case "panel/searchUsers": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.searchUsers(env, msg.query) };
      }

      case "panel/createAccount": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.createAccount(env, msg.fields) };
      }

      case "panel/getLobs": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getLinesOfBusiness(env) };
      }

      case "panel/createOpportunity": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.createOpportunity(env, msg.accountId, msg.lobId, msg.name) };
      }

      case "panel/saveCarrierAlias": {
        const env = await deps.getActiveEnvironment();
        await deps.saveCarrierAlias(env.orgUrl, msg.ezlynxId, msg.carrierId);
        return { ok: true, data: null };
      }

      case "panel/commit": {
        const env = await deps.getActiveEnvironment();
        // panel sends quotingMethodId null; the worker owns resolving the EZLynx
        // quoting-method row (spec field-mapping table). Resolve-or-CREATE: prod
        // shipped without an EZLynx row, which silently left the lookup blank.
        let quotingMethodId = msg.payload.quotingMethodId;
        if (quotingMethodId == null) {
          quotingMethodId = await deps.getQuotingMethodId(env, "EZLynx");
          if (quotingMethodId == null) quotingMethodId = await deps.createQuotingMethod(env, "EZLynx");
        }
        const payload = { ...msg.payload, quotingMethodId };
        const existing = await deps.getExistingQuoteStatuses(env, payload.selectedKeys);
        const ops = deps.buildQuoteOps(payload, existing);
        const results = await deps.executeBatch(env, ops);
        return { ok: true, data: results };
      }

      case "auth/signIn": {
        const env = await deps.getActiveEnvironment();
        // force a fresh interactive sign-in: the cached token may be VALID but
        // for an account with no role in this org (the exact failure this button fixes)
        await deps.clearToken(env.orgUrl);
        await deps.getAccessToken(env.orgUrl, { interactive: true });
        return { ok: true, data: null };
      }

      default:
        return { ok: false, error: `unknown message type: ${(msg as { type: string }).type}`, kind: "unknown" };
    }
  } catch (e) {
    const err = e as Error & { orgUrl?: string };
    if (err.name === "CrmAccessError") {
      let envName = "the active environment";
      try { envName = (await deps.getActiveEnvironment()).name; } catch { /* keep fallback */ }
      return { ok: false, error: `Your account has no access to ${envName} (${err.orgUrl}). Check the active environment.`, kind: "auth" };
    }
    if (err.name === "AuthRequiredError") return { ok: false, error: "Sign-in required", kind: "auth" };
    return { ok: false, error: String(err.message ?? err), kind: "unknown" };
  }
}

async function sendToEzlynxTab<T>(req: BridgeRequest): Promise<Res<T>> {
  const tabs = await chrome.tabs.query({ url: "https://app.ezlynx.com/*" });
  const tab = tabs[0];
  if (!tab?.id) {
    return { ok: false, error: "Open an EZLynx applicant page in another tab, then retry.", kind: "session" };
  }
  // An orphaned content script (tab loaded before the extension was updated) can
  // accept the message and never respond - race a timeout so the panel gets an
  // actionable error instead of an infinite spinner.
  try {
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tab.id, req) as Promise<Res<T>>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15_000))
    ]);
    if (!reply) throw new Error("empty reply");
    return reply;
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the EZLynx tab — reload that tab (the extension was updated since it loaded), then retry.",
      kind: "session"
    };
  }
}

export const realDeps: Deps = {
  getEnvironments,
  getActiveEnvironment,
  setActiveEnvironment,
  searchAccounts,
  getOpenOpportunities,
  getCarriers,
  getExistingQuoteStatuses,
  getQuotingMethodId,
  createQuotingMethod,
  searchUsers,
  createAccount,
  getLinesOfBusiness,
  createOpportunity,
  executeBatch,
  buildQuoteOps,
  getCarrierAliases,
  saveCarrierAlias,
  getAccessToken,
  clearToken,
  sendToEzlynxTab
};
