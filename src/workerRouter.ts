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
  getStagesForLob,
  executeBatch
} from "@/crm/dataverse";
import { buildQuoteOps } from "@/crm/mapping";
import { ensureInsuredData, ensureServicingAssignment } from "@/crm/enrich";
import { writeCoverageLines } from "@/crm/coverage";
import { writeQuestionKnowledge } from "@/crm/knowledge";
import {
  getCoverageQuoteNavProp,
  getCoverageRowIds,
  getKnowledgeNavProps,
  contactHasDlColumns,
  getAccountEnrichmentState,
  updateAccount,
  getAccountContacts,
  createContact,
  assignOwner,
  hasServicingTeamMember,
  createServicingTeamMember
} from "@/crm/dataverse";
import { getCarrierAliases, saveCarrierAlias } from "@/crm/carrierAliases";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import { writeApplicationKnowledge } from "@/crm/appCommit";
import { createLead } from "@/crm/dataverse";

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
  getStagesForLob: typeof getStagesForLob;
  getAccountEnrichmentState: typeof getAccountEnrichmentState;
  updateAccount: typeof updateAccount;
  getAccountContacts: typeof getAccountContacts;
  createContact: typeof createContact;
  assignOwner: typeof assignOwner;
  hasServicingTeamMember: typeof hasServicingTeamMember;
  createServicingTeamMember: typeof createServicingTeamMember;
  getCoverageQuoteNavProp: typeof getCoverageQuoteNavProp;
  getCoverageRowIds: typeof getCoverageRowIds;
  contactHasDlColumns: typeof contactHasDlColumns;
  getKnowledgeNavProps: typeof getKnowledgeNavProps;
  executeBatch: typeof executeBatch;
  buildQuoteOps: typeof buildQuoteOps;
  createLead: typeof createLead;
  getCarrierAliases: typeof getCarrierAliases;
  saveCarrierAlias: typeof saveCarrierAlias;
  getAccessToken: typeof getAccessToken;
  clearToken: typeof clearToken;
  /** Finds the EZLynx tab, relays a BridgeRequest to its content script, returns its Res. */
  sendToEzlynxTab: <T>(req: BridgeRequest) => Promise<Res<T>>;
  /** Finds the Bold Penguin tab and relays a capture request to its content script.
   * The scan clicks through every question set, so this can legitimately run minutes. */
  sendToBoldPenguinTab: <T>(req: { type: string }) => Promise<Res<T>>;
  /** Active tab in the last focused window (the tab beside the side panel). */
  getActiveTab: () => Promise<{ id: number; url: string } | null>;
  getCapturedApplication: () => Promise<import("@/boldpenguin/types").CapturedApplication | null>;
  setCapturedApplication: (app: import("@/boldpenguin/types").CapturedApplication | null) => Promise<void>;
  /** Injects the portal filler into the tab and runs it against the payload. */
  fillPortalTab: (
    tabId: number,
    payload: import("@/boldpenguin/types").CapturedApplication,
    overwrite: boolean
  ) => Promise<import("@/boldpenguin/types").PortalFillResult>;
  /** Injects the page harvester into the tab and returns its visible fields. */
  ingestPortalTab: (tabId: number) => Promise<{ fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string }>;
}

function pageKindOf(url: string): import("@/messages").PageKind {
  if (/^https:\/\/app\.ezlynx\.com\//i.test(url)) return "ezlynx";
  if (/^https:\/\/([^/]+\.)*boldpenguin\.com\//i.test(url)) return "boldpenguin";
  if (/^https:\/\/[^/]+\.(crm[0-9]*\.)?dynamics\.com\//i.test(url) || /^https:\/\/login\.microsoftonline\.com\//i.test(url)) return "crm";
  if (/^https:/i.test(url)) return "other";
  return "crm"; // chrome://, edge://, file:, http: — never a fillable/ingestable portal
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
        return { ok: true, data: await deps.createOpportunity(env, msg.accountId, msg.lobId, msg.name, msg.pipelineId, msg.stageId) };
      }

      case "panel/getStagesForLob": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getStagesForLob(env, msg.lobId) };
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
        // enrich the insured before the quote batch: fill-if-empty account
        // fields + find-or-create contacts. Best-effort - an enrichment failure
        // must not block the quotes; it surfaces as its own result row.
        const results: import("@/crm/dataverse").BatchItemResult[] = [];
        try {
          const en = await ensureInsuredData(env, payload.accountId, payload.run.applicant, {
            getAccountEnrichmentState: deps.getAccountEnrichmentState,
            updateAccount: deps.updateAccount,
            getAccountContacts: deps.getAccountContacts,
            createContact: deps.createContact,
            contactHasDlColumns: deps.contactHasDlColumns
          });
          if (en.filledFields.length || en.contactsCreated.length || en.primaryContactSet) {
            const bits = [];
            if (en.filledFields.length) bits.push(`filled ${en.filledFields.length} field${en.filledFields.length === 1 ? "" : "s"}`);
            if (en.contactsCreated.length) bits.push(`created contact${en.contactsCreated.length === 1 ? "" : "s"}: ${en.contactsCreated.join(", ")}`);
            if (en.primaryContactSet) bits.push("set primary contact");
            results.push({ key: `Insured profile — ${bits.join("; ")}`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Insured profile", status: 0, error: `Enrichment failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
        }
        if (payload.ownerId && payload.ownerName) {
          try {
            const sv = await ensureServicingAssignment(env, {
              accountId: payload.accountId,
              ownerId: payload.ownerId,
              ownerName: payload.ownerName,
              accountCreatedByPanel: payload.accountCreatedByPanel,
              createdOpportunityIds: payload.createdOpportunityIds
            }, {
              assignOwner: deps.assignOwner,
              hasServicingTeamMember: deps.hasServicingTeamMember,
              createServicingTeamMember: deps.createServicingTeamMember
            });
            if (sv.ownersAssigned || sv.teamMemberCreated) {
              const bits = [];
              if (sv.ownersAssigned) bits.push(`assigned ${payload.ownerName} as owner of ${sv.ownersAssigned} record${sv.ownersAssigned === 1 ? "" : "s"}`);
              if (sv.teamMemberCreated) bits.push(`added ${payload.ownerName} to the servicing team`);
              results.push({ key: `Servicing — ${bits.join("; ")}`, status: 204, error: null, entityId: null });
            }
          } catch (e) {
            results.push({ key: "Servicing assignment", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
          }
        }
        const existing = await deps.getExistingQuoteStatuses(env, payload.selectedKeys);
        const ops = deps.buildQuoteOps(payload, existing);
        const quoteResults = await deps.executeBatch(env, ops);
        results.push(...quoteResults);

        // structured coverage lines for data analysis - schema-aware: no-ops
        // with a note until the CRM-side iacrm_quotecoverage columns deploy
        try {
          const idByKey = new Map(quoteResults.filter(r => r.entityId).map(r => [r.key, r.entityId!]));
          const covTargets = [];
          for (const block of payload.run.blocks) {
            if (!payload.blockSelections[block.lob]) continue;
            for (const q of block.quotes) {
              const quoteId = idByKey.get(q.key);
              if (quoteId) covTargets.push({ quote: q, quoteId });
            }
          }
          if (covTargets.length) {
            const cov = await writeCoverageLines(env, covTargets, {
              getCoverageQuoteNavProp: deps.getCoverageQuoteNavProp,
              getCoverageRowIds: deps.getCoverageRowIds,
              executeBatch: deps.executeBatch
            });
            if (cov.skipped === "no-columns") {
              results.push({ key: "Coverage detail — waiting on CRM columns (iacrm_quotecoverage); summaries written, structured rows skipped", status: 204, error: null, entityId: null });
            } else if (cov.linesWritten) {
              results.push({ key: `Coverage detail — logged ${cov.linesWritten} lines across ${cov.quotesCovered} quotes`, status: 204, error: null, entityId: null });
            }
          }
        } catch (e) {
          results.push({ key: "Coverage detail", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
        }

        // question-knowledge layer: dictionary + answers. Dormant until the
        // Phase 1 tables deploy; best-effort like the rest.
        try {
          const know = await writeQuestionKnowledge(env, payload.run, payload.accountId, {
            getKnowledgeNavProps: deps.getKnowledgeNavProps,
            executeBatch: deps.executeBatch
          });
          if (know.skipped === "no-tables") {
            results.push({ key: "Question knowledge — waiting on CRM tables (iacrm_carrierquestion); Q&A kept in rawpayload meanwhile", status: 204, error: null, entityId: null });
          } else if (know.questionsUpserted || know.answersUpserted) {
            results.push({ key: `Question knowledge — ${know.questionsUpserted} questions, ${know.answersUpserted} answers upserted`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Question knowledge", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
        }
        return { ok: true, data: results };
      }

      case "panel/getPageContext": {
        const tab = await deps.getActiveTab();
        const hasCapturedApplication = (await deps.getCapturedApplication()) !== null;
        return { ok: true, data: { kind: tab ? pageKindOf(tab.url) : "other", hasCapturedApplication } };
      }

      case "panel/bpCapture": {
        const res = await deps.sendToBoldPenguinTab<import("@/boldpenguin/types").CapturedApplication>({ type: "bp/capture" });
        if (!res.ok) return res;
        await deps.setCapturedApplication(res.data);
        return res;
      }

      case "panel/bpGetCaptured":
        return { ok: true, data: await deps.getCapturedApplication() };

      case "panel/bpClear":
        await deps.setCapturedApplication(null);
        return { ok: true, data: null };

      case "panel/portalFill": {
        const app = await deps.getCapturedApplication();
        if (!app) {
          return { ok: false, error: "The captured application is no longer available. Capture it again in Bold Penguin.", kind: "session" };
        }
        return { ok: true, data: await deps.fillPortalTab(msg.tabId, app, msg.overwrite) };
      }

      case "panel/portalIngest": {
        const harvested = await deps.ingestPortalTab(msg.tabId);
        const existing = await deps.getCapturedApplication();
        const outcome = mergeIngestedFields(existing, harvested.fields, {
          system: new URL(harvested.url).hostname,
          url: harvested.url,
          title: harvested.title
        });
        await deps.setCapturedApplication(outcome.app);
        return { ok: true, data: outcome };
      }

      case "panel/appCommit": {
        const app = await deps.getCapturedApplication();
        if (!app) {
          return { ok: false, error: "The captured application is no longer available. Capture or ingest it again.", kind: "session" };
        }
        const env = await deps.getActiveEnvironment();
        const results: import("@/crm/dataverse").BatchItemResult[] = [];
        // same best-effort structure as the EZLynx commit: enrichment first,
        // then the knowledge write, each surfacing its own result row.
        try {
          const en = await ensureInsuredData(env, msg.accountId, msg.applicant, {
            getAccountEnrichmentState: deps.getAccountEnrichmentState,
            updateAccount: deps.updateAccount,
            getAccountContacts: deps.getAccountContacts,
            createContact: deps.createContact,
            contactHasDlColumns: deps.contactHasDlColumns
          });
          const bits = [];
          if (en.filledFields.length) bits.push(`filled ${en.filledFields.length} field${en.filledFields.length === 1 ? "" : "s"}`);
          if (en.contactsCreated.length) bits.push(`created contact${en.contactsCreated.length === 1 ? "" : "s"}: ${en.contactsCreated.join(", ")}`);
          if (en.primaryContactSet) bits.push("set primary contact");
          results.push({ key: `Insured profile — ${bits.length ? bits.join("; ") : "already complete"}`, status: 204, error: null, entityId: null });
        } catch (e) {
          results.push({ key: "Insured profile", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        if (msg.insuredType != null) {
          try {
            await deps.updateAccount(env, msg.accountId, { iacrm_insuredtype: msg.insuredType });
            results.push({ key: `Insured type — set to ${msg.insuredType === 2 ? "Commercial" : "Personal"}`, status: 204, error: null, entityId: null });
          } catch (e) {
            results.push({ key: "Insured type", status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
        }
        try {
          const know = await writeApplicationKnowledge(env, app, msg.accountId, {
            getKnowledgeNavProps: deps.getKnowledgeNavProps,
            executeBatch: deps.executeBatch
          });
          if (know.skipped === "no-tables") {
            results.push({ key: "Application data — waiting on CRM tables (iacrm_carrierquestion); nothing logged", status: 204, error: null, entityId: null });
          } else {
            results.push({ key: `Application data — ${know.answersUpserted} fields logged to the risk-data layer`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Application data", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        return { ok: true, data: results };
      }

      case "panel/createLead": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.createLead(env, msg.fields) };
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

async function sendToBoldPenguinTab<T>(req: { type: string }): Promise<Res<T>> {
  const tabs = await chrome.tabs.query({ url: "https://*.boldpenguin.com/*" });
  const tab = tabs[0];
  if (!tab?.id) {
    return { ok: false, error: "Open the completed Bold Penguin application in another tab, then retry.", kind: "session" };
  }
  try {
    // The capture walks every question set (including vehicle editors), so allow
    // minutes — but still bound it so an orphaned content script can't hang the panel.
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tab.id, req) as Promise<Res<T>>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 180_000))
    ]);
    if (!reply) throw new Error("empty reply");
    return reply;
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the Bold Penguin tab — reload that tab (the extension was updated since it loaded), then retry.",
      kind: "session"
    };
  }
}

async function getActiveTab(): Promise<{ id: number; url: string } | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id && tab.url ? { id: tab.id, url: tab.url } : null;
}

const BP_STORAGE_KEY = "bp/capturedApplication";

async function getCapturedApplication(): Promise<import("@/boldpenguin/types").CapturedApplication | null> {
  const stored = await chrome.storage.session.get(BP_STORAGE_KEY);
  return (stored[BP_STORAGE_KEY] as import("@/boldpenguin/types").CapturedApplication | undefined) ?? null;
}

async function setCapturedApplication(app: import("@/boldpenguin/types").CapturedApplication | null): Promise<void> {
  if (app === null) await chrome.storage.session.remove(BP_STORAGE_KEY);
  else await chrome.storage.session.set({ [BP_STORAGE_KEY]: app });
}

async function fillPortalTab(
  tabId: number,
  payload: import("@/boldpenguin/types").CapturedApplication,
  overwrite: boolean
): Promise<import("@/boldpenguin/types").PortalFillResult> {
  // On-demand injection: the filler ships as plain scripts (public/portal/) so it
  // can run on ANY carrier portal the user granted, without a declared match.
  // allFrames: agent portals (Progressive FAO among them) often render the quote
  // form inside an iframe — every frame fills its own fields.
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js"] });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (p: unknown, o: boolean) =>
      (globalThis as { __bettersPortalFill?: (p: unknown, o: boolean) => unknown }).__bettersPortalFill?.(p, o) ?? null,
    args: [payload, overwrite]
  });
  const results = frames
    .map(f => f.result as import("@/boldpenguin/types").PortalFillResult | null)
    .filter((r): r is import("@/boldpenguin/types").PortalFillResult => r !== null);
  if (!results.length) throw new Error("The portal page did not respond. Reload it and retry.");
  return results.reduce((a, r) => ({
    filledCount: a.filledCount + r.filledCount,
    existingCount: a.existingCount + r.existingCount,
    optionMismatchCount: a.optionMismatchCount + r.optionMismatchCount,
    controlCount: a.controlCount + r.controlCount,
    filled: [...a.filled, ...r.filled]
  }));
}

async function ingestPortalTab(tabId: number): Promise<{ fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string }> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-ingest.js"] });
  type FrameHarvest = { fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string };
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as { __bettersPortalIngest?: () => unknown }).__bettersPortalIngest?.() ?? null
  });
  const results = frames.map(f => f.result as FrameHarvest | null).filter((r): r is FrameHarvest => r !== null);
  const top = results[0];
  if (!top) throw new Error("The page did not respond. Reload it and retry.");
  // the top frame names the capture; every frame (iframed quote forms included)
  // contributes its fields
  return { fields: results.flatMap(r => r.fields), title: top.title, url: top.url };
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
  getStagesForLob,
  getAccountEnrichmentState,
  updateAccount,
  getAccountContacts,
  createContact,
  assignOwner,
  hasServicingTeamMember,
  createServicingTeamMember,
  getCoverageQuoteNavProp,
  getCoverageRowIds,
  contactHasDlColumns,
  getKnowledgeNavProps,
  executeBatch,
  buildQuoteOps,
  createLead,
  getCarrierAliases,
  saveCarrierAlias,
  getAccessToken,
  clearToken,
  sendToEzlynxTab,
  sendToBoldPenguinTab,
  getActiveTab,
  getCapturedApplication,
  setCapturedApplication,
  fillPortalTab,
  ingestPortalTab
};
