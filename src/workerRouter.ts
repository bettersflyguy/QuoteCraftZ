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
  searchUsers,
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
  searchUsers: typeof searchUsers;
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

      case "panel/saveCarrierAlias": {
        const env = await deps.getActiveEnvironment();
        await deps.saveCarrierAlias(env.orgUrl, msg.ezlynxId, msg.carrierId);
        return { ok: true, data: null };
      }

      case "panel/commit": {
        const env = await deps.getActiveEnvironment();
        // panel sends quotingMethodId null; the worker owns resolving the EZLynx
        // quoting-method row (spec field-mapping table) - one lookup per commit
        const payload = msg.payload.quotingMethodId == null
          ? { ...msg.payload, quotingMethodId: await deps.getQuotingMethodId(env, "EZLynx") }
          : msg.payload;
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
      const env = await deps.getActiveEnvironment();
      return { ok: false, error: `Your account has no access to ${env.name} (${err.orgUrl}). Check the active environment.`, kind: "auth" };
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
  return (await chrome.tabs.sendMessage(tab.id, req)) as Res<T>;
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
  searchUsers,
  executeBatch,
  buildQuoteOps,
  getCarrierAliases,
  saveCarrierAlias,
  getAccessToken,
  clearToken,
  sendToEzlynxTab
};
