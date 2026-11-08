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
import { getAllFieldMaps, setAllFieldMaps, PATH_LABEL, isCrmTarget } from "@/portal/fieldMaps";
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
import { buildSupplementalNote, coverageLinesFromCapture, writeApplicationKnowledge } from "@/crm/appCommit";
import { createLead, createPolicy, createQuote, dvJson, fillIfEmpty, findInsuredMatches, getInsuredSourceRecords, searchInsureds, upsertAccountNote } from "@/crm/dataverse";
import { catalogLabel, coerceGroup, getFieldCatalog, type FieldCatalog } from "@/crm/fieldCatalog";
import { buildCrmCaptureFields } from "@/crm/crmSource";

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
  findInsuredMatches: typeof findInsuredMatches;
  createPolicy: typeof createPolicy;
  createQuote: typeof createQuote;
  fillIfEmpty: typeof fillIfEmpty;
  /** Live CRM column catalog for capture mappings (cached per environment). */
  getFieldCatalog: (env: CrmEnvironment, refresh?: boolean) => Promise<FieldCatalog>;
  dvQuery: typeof dvJson;
  upsertAccountNote: typeof upsertAccountNote;
  searchInsureds: typeof searchInsureds;
  getInsuredSourceRecords: typeof getInsuredSourceRecords;
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
    overwrite: boolean,
    autoAdvance: boolean
  ) => Promise<import("@/boldpenguin/types").PortalFillResult>;
  /** Injects the page harvester into the tab and returns its visible fields. */
  ingestPortalTab: (tabId: number) => Promise<{ fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string }>;
  /** Mapping editor: enumerates the page's fillable controls with auto/saved mappings. */
  scanPortalTab: (tabId: number) => Promise<import("@/boldpenguin/types").PortalScanResult>;
  /** Waits for the user to click one field on the page and returns its identity.
   * "timeout" = nothing happened in this ~20s round (panel re-arms); null = user cancelled. */
  pickPortalTab: (tabId: number) => Promise<import("@/boldpenguin/types").PortalScanRow | "timeout" | null>;
  /** Resolves a pending pick in every frame (the panel's Stop button). */
  cancelPortalPick: (tabId: number) => Promise<void>;
  /** Outlines the mapped fields on the page (null clears). */
  peekPortalTab: (tabId: number, items: import("@/boldpenguin/types").PeekItem[] | null) => Promise<import("@/boldpenguin/types").PeekResult>;
  /** Persists the agent-taught per-site field map (empty map deletes the site). */
  saveFieldMap: (origin: string, map: Record<string, string>) => Promise<void>;
  /** Starts/stops passive auto-capture on the tab (observer scripts, no clicks). */
  setAutoCapture: (tabId: number, enable: boolean) => Promise<void>;
  isAutoCapturing: (tabId: number) => Promise<boolean>;
}

function pageKindOf(url: string): import("@/messages").PageKind {
  if (/^https:\/\/app\.ezlynx\.com\//i.test(url)) return "ezlynx";
  if (/^https:\/\/([^/]+\.)*boldpenguin\.com\//i.test(url)) return "boldpenguin";
  if (/^https:\/\/[^/]+\.(crm[0-9]*\.)?dynamics\.com\//i.test(url) || /^https:\/\/login\.microsoftonline\.com\//i.test(url)) return "crm";
  if (/^https:/i.test(url)) return "other";
  return "crm"; // chrome://, edge://, file:, http: - never a fillable/ingestable portal
}

/** Raw captured column text for one record -> catalog-coerced values. Any
 * catalog failure yields no extras rather than failing the record. */
async function coercedExtras(deps: Deps, env: CrmEnvironment, entityKey: string, raw: Record<string, string> | undefined): Promise<Record<string, unknown>> {
  if (!raw || !Object.keys(raw).length) return {};
  try {
    const catalog = await deps.getFieldCatalog(env);
    return coerceGroup(catalog.entities.find(e => e.key === entityKey), raw);
  } catch {
    return {};
  }
}

/** Captured columns are optional riders: when a create with them is
 * rejected (a value the column refuses), retry once without them. */
async function withExtrasFallback<T>(extra: Record<string, unknown>, create: (extra: Record<string, unknown>) => Promise<T>): Promise<T> {
  if (!Object.keys(extra).length) return create({});
  try { return await create(extra); } catch { return create({}); }
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
        const extra = await coercedExtras(deps, env, "opportunity", msg.extra);
        return {
          ok: true,
          data: await withExtrasFallback(extra, x =>
            deps.createOpportunity(env, msg.accountId, msg.lobId, msg.name, msg.pipelineId, msg.stageId, msg.leadSource ?? null, x))
        };
      }

      case "panel/crmFieldCatalog": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getFieldCatalog(env, msg.refresh ?? false) };
      }

      case "panel/getStagesForLob": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.getStagesForLob(env, msg.lobId, { insuredType: msg.insuredType ?? null, lobName: msg.lobName ?? null }) };
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
            results.push({ key: `Insured profile: ${bits.join("; ")}`, status: 204, error: null, entityId: null });
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
              results.push({ key: `Servicing: ${bits.join("; ")}`, status: 204, error: null, entityId: null });
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
              results.push({ key: "Coverage detail: waiting on CRM columns (iacrm_quotecoverage); summaries written, structured rows skipped", status: 204, error: null, entityId: null });
            } else if (cov.linesWritten) {
              results.push({ key: `Coverage detail: logged ${cov.linesWritten} lines across ${cov.quotesCovered} quotes`, status: 204, error: null, entityId: null });
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
            executeBatch: deps.executeBatch,
            query: deps.dvQuery
          });
          if (know.skipped === "no-tables") {
            results.push({ key: "Question knowledge: waiting on CRM tables (iacrm_carrierquestion); Q&A kept in rawpayload meanwhile", status: 204, error: null, entityId: null });
          } else if (know.questionsUpserted || know.answersUpserted) {
            results.push({ key: `Question knowledge: ${know.questionsUpserted} questions, ${know.answersUpserted} answers upserted`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Question knowledge", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
        }
        return { ok: true, data: results };
      }

      case "panel/getPageContext": {
        const tab = await deps.getActiveTab();
        const hasCapturedApplication = (await deps.getCapturedApplication()) !== null;
        const autoCapturing = tab ? await deps.isAutoCapturing(tab.id) : false;
        return { ok: true, data: { kind: tab ? pageKindOf(tab.url) : "other", hasCapturedApplication, autoCapturing } };
      }

      case "panel/autoCapture": {
        await deps.setAutoCapture(msg.tabId, msg.enable);
        return { ok: true, data: null };
      }

      case "panel/crmSearch": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.searchInsureds(env, msg.query) };
      }

      case "panel/crmPull": {
        const env = await deps.getActiveEnvironment();
        const records = await deps.getInsuredSourceRecords(env, msg.kind, msg.id);
        const fields = buildCrmCaptureFields(records);
        if (!fields.length) {
          return { ok: false, error: "That record has no usable insured data.", kind: "http" };
        }
        const existing = await deps.getCapturedApplication();
        const outcome = mergeIngestedFields(existing, fields, {
          system: `CRM (${env.name})`, url: env.orgUrl, title: msg.name
        });
        await deps.setCapturedApplication(outcome.app);
        await chrome.storage.session.set({ "bp/crmLink": { kind: msg.kind, id: msg.id, name: msg.name } });
        return { ok: true, data: outcome };
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
        await chrome.storage.session.remove("bp/crmLink");
        return { ok: true, data: null };

      case "panel/getCrmLink": {
        const stored = await chrome.storage.session.get("bp/crmLink");
        return { ok: true, data: (stored["bp/crmLink"] as import("@/messages").CrmLink | undefined) ?? null };
      }

      case "panel/portalFill": {
        const app = await deps.getCapturedApplication();
        if (!app) {
          return { ok: false, error: "The captured application is no longer available. Capture it again in Bold Penguin.", kind: "session" };
        }
        return { ok: true, data: await deps.fillPortalTab(msg.tabId, app, msg.overwrite, msg.autoAdvance) };
      }

      case "panel/portalScan":
        return { ok: true, data: await deps.scanPortalTab(msg.tabId) };

      case "panel/portalPick":
        return { ok: true, data: await deps.pickPortalTab(msg.tabId) };

      case "panel/portalPickCancel":
        await deps.cancelPortalPick(msg.tabId);
        return { ok: true, data: null };

      case "panel/portalPeek":
        return { ok: true, data: await deps.peekPortalTab(msg.tabId, msg.items) };

      case "panel/saveFieldMap":
        await deps.saveFieldMap(msg.origin, msg.map);
        return { ok: true, data: null };

      case "panel/portalIngest": {
        const harvested = await deps.ingestPortalTab(msg.tabId);
        const existing = await deps.getCapturedApplication();
        const outcome = mergeIngestedFields(existing, harvested.fields, {
          system: new URL(harvested.url).hostname,
          url: harvested.url,
          title: harvested.title
        });
        await deps.setCapturedApplication(outcome.app);
        if (outcome.replaced) await chrome.storage.session.remove("bp/crmLink");
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
        // captured CRM-column values, coerced against the live catalog (a
        // missing catalog just means no extra columns - never a failed load)
        let catalog: FieldCatalog | null = null;
        try { catalog = await deps.getFieldCatalog(env); } catch { catalog = null; }
        const entityOf = (key: string) => catalog?.entities.find(e => e.key === key);
        const groupOf = (name: string) => app.normalized[name] as Record<string, unknown> | undefined;
        const applicant = {
          ...msg.applicant,
          coApplicants: msg.applicant.coApplicants.map(co => ({
            ...co,
            extra: coerceGroup(entityOf("contacts"), co.extra as Record<string, unknown> | undefined)
          }))
        };
        try {
          const en = await ensureInsuredData(env, msg.accountId, applicant, {
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
          results.push({ key: `Insured profile: ${bits.length ? bits.join("; ") : "already complete"}`, status: 204, error: null, entityId: null });
          // taught CRM columns, hierarchy order: account, primary contact,
          // then related contacts that matched existing records (created
          // ones received their columns on create). Fill-if-empty: agent-
          // entered CRM data always wins.
          const columnWrites: { label: string; set: string; id: string | null; values: Record<string, unknown> }[] = [
            { label: "Insured", set: "accounts", id: msg.accountId, values: coerceGroup(entityOf("account"), groupOf("crm:account")) },
            { label: "Primary contact", set: "contacts", id: en.applicantContactId, values: coerceGroup(entityOf("primarycontact"), groupOf("crm:primarycontact")) },
            ...en.matchedCoContacts.map(m => ({ label: "Related contact", set: "contacts", id: m.contactId, values: m.extra }))
          ];
          for (const w of columnWrites) {
            if (!w.id || !Object.keys(w.values).length) continue;
            try {
              const written = await deps.fillIfEmpty(env, w.set, w.id, w.values);
              if (written.length) results.push({ key: `${w.label}: filled ${written.length} mapped column${written.length === 1 ? "" : "s"}`, status: 204, error: null, entityId: null });
            } catch (e) {
              results.push({ key: `${w.label} mapped columns`, status: 0, error: String((e as Error).message ?? e), entityId: null });
            }
          }
        } catch (e) {
          results.push({ key: "Insured profile", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        if (msg.insuredType != null) {
          try {
            await deps.updateAccount(env, msg.accountId, { iacrm_insuredtype: msg.insuredType });
            results.push({ key: `Insured type: set to ${msg.insuredType === 2 ? "Commercial" : "Personal"}`, status: 204, error: null, entityId: null });
          } catch (e) {
            results.push({ key: "Insured type", status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
        }
        try {
          const know = await writeApplicationKnowledge(env, app, msg.accountId, {
            getKnowledgeNavProps: deps.getKnowledgeNavProps,
            executeBatch: deps.executeBatch,
            query: deps.dvQuery
          });
          if (know.skipped === "no-tables") {
            results.push({ key: "Application data: waiting on CRM tables (iacrm_carrierquestion); nothing logged", status: 204, error: null, entityId: null });
          } else {
            results.push({ key: `Application data: ${know.answersUpserted} fields logged to the risk-data layer`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Application data", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        await chrome.storage.session.set({ "bp/crmLink": { kind: "account", id: msg.accountId, name: "" } });
        // supplemental data with no CRM column (employment, payment plan,
        // coverage elections…) -> one evergreen timeline note per source
        try {
          const note = buildSupplementalNote(app);
          if (note) {
            const outcome = await deps.upsertAccountNote(env, msg.accountId, note.subject, note.body, note.legacyMatch);
            results.push({ key: `Supplemental data: timeline note ${outcome} with ${note.count} unmapped field${note.count === 1 ? "" : "s"}`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Supplemental data note", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        return { ok: true, data: results };
      }

      case "panel/createLead": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.createLead(env, msg.fields) };
      }

      case "panel/findMatches": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.findInsuredMatches(env, msg.query) };
      }

      case "panel/createPolicy": {
        const env = await deps.getActiveEnvironment();
        const extra = await coercedExtras(deps, env, "policies", msg.fields.extra);
        return { ok: true, data: await withExtrasFallback(extra, x => deps.createPolicy(env, msg.fields, x)) };
      }

      case "panel/createQuote": {
        const env = await deps.getActiveEnvironment();
        // quoting method: resolve-or-create "Carrier Direct" (portal quotes are
        // carrier-direct; the carrier lookup says WHICH carrier)
        let quotingMethodId = await deps.getQuotingMethodId(env, "Carrier Direct");
        if (quotingMethodId == null) quotingMethodId = await deps.createQuotingMethod(env, "Carrier Direct");
        const quoteExtra = await coercedExtras(deps, env, "quote", msg.fields.extra);
        const { quoteId } = await withExtrasFallback(quoteExtra, x => deps.createQuote(env, { ...msg.fields, quotingMethodId }, x));
        // structured coverage rows from the held capture (best-effort,
        // schema-aware like the EZLynx path)
        let linesWritten = 0;
        try {
          const app = await deps.getCapturedApplication();
          if (app) {
            const lines = coverageLinesFromCapture(app);
            if (lines.length) {
              const cov = await writeCoverageLines(env, [{
                quote: { coverageLines: lines } as import("@/types").CapturedQuote,
                quoteId
              }], {
                getCoverageQuoteNavProp: deps.getCoverageQuoteNavProp,
                getCoverageRowIds: deps.getCoverageRowIds,
                executeBatch: deps.executeBatch
              });
              linesWritten = cov.skipped ? 0 : cov.linesWritten;
            }
          }
        } catch { /* coverage depth is best-effort; the quote row stands */ }
        return { ok: true, data: { quoteId, linesWritten } };
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
    const err = e as Error & { orgUrl?: string; status?: number; upn?: string | null };
    if (err.name === "CrmAccessError") {
      let envName = "the active environment";
      try { envName = (await deps.getActiveEnvironment()).name; } catch { /* keep fallback */ }
      const who = err.upn ? `The signed-in account ${err.upn}` : "Your account";
      const why = err.status === 403
        ? "The account exists in CRM but is missing a security role for the connector's tables, or the wrong account was picked at sign-in."
        : "This is usually the wrong account picked at sign-in. Use Sign in and choose your work account.";
      return { ok: false, error: `${who} was rejected by ${envName} (${err.orgUrl}, HTTP ${err.status}). ${why}`, kind: "auth" };
    }
    if (err.name === "AuthRequiredError") return { ok: false, error: "Sign-in required", kind: "auth" };
    return { ok: false, error: String(err.message ?? err), kind: "unknown" };
  }
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** An extension update orphans content scripts in already-open tabs (their
 * listeners go inert). Probe cheaply; when dead, re-inject the DECLARED
 * script for that host from the manifest instead of telling the user to
 * reload the tab. The scripts guard against double registration. */
async function ensureContentScriptAlive(tabId: number, probeType: string, hostFrag: string): Promise<void> {
  try {
    await raceTimeout(chrome.tabs.sendMessage(tabId, { type: probeType }), 3_000);
    return;
  } catch { /* dead or missing - revive below */ }
  const entry = (chrome.runtime.getManifest().content_scripts ?? [])
    .find(c => (c.matches ?? []).some(m => m.includes(hostFrag)));
  if (entry?.js?.length) {
    await chrome.scripting.executeScript({ target: { tabId }, files: entry.js });
    await new Promise(r => setTimeout(r, 300));
  }
}

async function sendToEzlynxTab<T>(req: BridgeRequest): Promise<Res<T>> {
  const tabs = await chrome.tabs.query({ url: "https://app.ezlynx.com/*" });
  const tab = tabs[0];
  if (!tab?.id) {
    return { ok: false, error: "Open an EZLynx applicant page in another tab, then retry.", kind: "session" };
  }
  try {
    await ensureContentScriptAlive(tab.id, "ezlynx/getContext", "ezlynx.com");
    const reply = await raceTimeout(chrome.tabs.sendMessage(tab.id, req) as Promise<Res<T>>, 15_000);
    if (!reply) throw new Error("empty reply");
    return reply;
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the EZLynx tab. Reload that tab, then retry.",
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
    await ensureContentScriptAlive(tab.id, "bp/getContext", "boldpenguin.com");
    // The capture walks every question set (including vehicle editors), so allow
    // minutes - but still bound it so a hung page can't spin the panel forever.
    const reply = await raceTimeout(chrome.tabs.sendMessage(tab.id, req) as Promise<Res<T>>, 180_000);
    if (!reply) throw new Error("empty reply");
    return reply;
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the Bold Penguin tab. Reload that tab, then retry.",
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

/** Agent-taught per-site mappings: { [origin]: { [controlKey]: path | "skip" } }. */
async function fieldMapFor(origin: string): Promise<Record<string, string>> {
  return (await getAllFieldMaps())[origin] ?? {};
}

async function saveFieldMap(origin: string, map: Record<string, string>): Promise<void> {
  const all = await getAllFieldMaps();
  if (Object.keys(map).length) all[origin] = map;
  else delete all[origin];
  await setAllFieldMaps(all);
}

async function tabOrigin(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ? new URL(tab.url).origin : "";
}

async function scanPortalTab(tabId: number): Promise<import("@/boldpenguin/types").PortalScanResult> {
  const origin = await tabOrigin(tabId);
  const overrides = origin ? await fieldMapFor(origin) : {};
  const app = await getCapturedApplication();
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js"] });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (p: unknown, ov: unknown) =>
      (globalThis as { __bettersPortalScan?: (p: unknown, ov: unknown) => unknown }).__bettersPortalScan?.(p, ov) ?? null,
    args: [app, overrides]
  });
  const rows = frames
    .map(f => f.result as import("@/boldpenguin/types").PortalScanRow[] | null)
    .filter((r): r is import("@/boldpenguin/types").PortalScanRow[] => r !== null)
    .flat();
  if (!rows.length) throw new Error("No fillable fields found on this page. Open the quote form, then retry.");
  // dedupe by key; a "pick:" teaching that resolved in SOME frame beats
  // another frame's "not on this page" placeholder for the same key
  const unresolved = (r: import("@/boldpenguin/types").PortalScanRow) => r.label === "(taught text, not on this page)";
  const seen = new Set<string>();
  const deduped: import("@/boldpenguin/types").PortalScanRow[] = [];
  for (const r of [...rows.filter(x => !unresolved(x)), ...rows.filter(unresolved)]) {
    if (!seen.has(r.key)) { seen.add(r.key); deduped.push(r); }
  }
  return { origin, rows: deduped };
}

/** One-shot "click a field to identify it" pick. Every frame arms a picker;
 * the clicked frame returns the control's row and cancels the rest. Each
 * round lasts ~20s: a frame that saw nothing resolves "timeout" and the
 * PANEL re-arms, keeping every worker round trip short. Precedence across
 * frames: a row wins; else any "timeout" (keep going - an Esc broadcast
 * can race one frame's timer); else null (user cancelled). */
async function pickPortalTab(tabId: number): Promise<import("@/boldpenguin/types").PortalScanRow | "timeout" | null> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js"] });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as { __bettersPortalPick?: () => unknown }).__bettersPortalPick?.() ?? null
  });
  const results = frames.map(f => f.result as import("@/boldpenguin/types").PortalScanRow | "timeout" | null | undefined);
  const row = results.find((r): r is import("@/boldpenguin/types").PortalScanRow => r !== null && r !== undefined && r !== "timeout");
  if (row) return row;
  return results.includes("timeout") ? "timeout" : null;
}

/** Stop button: resolves the pending pick (as a cancel) in every frame. */
async function cancelPortalPick(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as { __bettersPortalPickCancel?: () => void }).__bettersPortalPickCancel?.()
  });
}

/** Peek: every frame outlines its own mapped elements; counts aggregate. A
 * key resolved in ANY frame counts as shown (frames that lack it report it
 * missing), so missing = items found nowhere. */
async function peekPortalTab(
  tabId: number,
  items: import("@/boldpenguin/types").PeekItem[] | null
): Promise<import("@/boldpenguin/types").PeekResult> {
  if (items) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["portal/portal-mapper.js", "portal/portal-ingest.js", "portal/portal-fill.js"]
    });
  }
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (it: unknown) =>
      (globalThis as { __bettersPortalPeek?: (it: unknown) => unknown }).__bettersPortalPeek?.(it) ?? null,
    args: [items]
  });
  const results = frames
    .map(f => f.result as import("@/boldpenguin/types").PeekResult | null)
    .filter((r): r is import("@/boldpenguin/types").PeekResult => r !== null);
  const shown = Math.min(items?.length ?? 0, results.reduce((n, r) => n + r.shown, 0));
  return { shown, missing: Math.max(0, (items?.length ?? 0) - shown) };
}

async function fillPortalTab(
  tabId: number,
  payload: import("@/boldpenguin/types").CapturedApplication,
  overwrite: boolean,
  autoAdvance: boolean
): Promise<import("@/boldpenguin/types").PortalFillResult> {
  const origin = await tabOrigin(tabId);
  const overrides = origin ? await fieldMapFor(origin) : {};
  // On-demand injection: the filler ships as plain scripts (public/portal/) so it
  // can run on ANY carrier portal the user granted, without a declared match.
  // allFrames: agent portals (Progressive FAO among them) often render the quote
  // form inside an iframe - every frame fills its own fields.
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js"] });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (p: unknown, o: boolean, a: boolean, ov: unknown) =>
      (globalThis as { __bettersPortalFill?: (p: unknown, o: boolean, a: boolean, ov: unknown) => unknown }).__bettersPortalFill?.(p, o, a, ov) ?? null,
    args: [payload, overwrite, autoAdvance, overrides]
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
  // agent-taught read-only-text extractions for this site: "pick:<selector>"
  // entries resolve to the taught CRM field's display label, which the
  // normalizer recognizes - the page never chooses its own labels
  const origin = await tabOrigin(tabId);
  const siteMap = origin ? await fieldMapFor(origin) : {};
  // CRM-column teachings label themselves from the cached catalog (falling
  // back to the column's logical name when the catalog isn't loaded yet)
  let catalog: FieldCatalog | null = null;
  if (Object.values(siteMap).some(v => isCrmTarget(v))) {
    try { catalog = await getFieldCatalog(await getActiveEnvironment(), { dvJson }); } catch { catalog = null; }
  }
  const taught = Object.entries(siteMap)
    .filter(([k, v]) => k.startsWith("pick:") && v !== "skip" && (PATH_LABEL.has(v) || isCrmTarget(v)))
    .map(([k, v]) => ({
      selector: k.slice(5),
      label: PATH_LABEL.get(v) ?? catalogLabel(catalog, v) ?? v.replace(/^crm:/, "").replace("[]", ""),
      path: v
    }));
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (t: unknown) => (globalThis as { __bettersPortalIngest?: (t: unknown) => unknown }).__bettersPortalIngest?.(t) ?? null,
    args: [taught]
  });
  const results = frames.map(f => f.result as FrameHarvest | null).filter((r): r is FrameHarvest => r !== null);
  const top = results[0];
  if (!top) throw new Error("The page did not respond. Reload it and retry.");
  // the top frame names the capture; every frame (iframed quote forms included)
  // contributes its fields
  return { fields: results.flatMap(r => r.fields), title: top.title, url: top.url };
}

const AUTOCAP_KEY = "autocap/tabs";

async function autoCapTabs(): Promise<number[]> {
  const s = await chrome.storage.session.get(AUTOCAP_KEY);
  return (s[AUTOCAP_KEY] as number[] | undefined) ?? [];
}

async function injectAutoCapture(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["portal/portal-ingest.js", "portal/portal-autocap.js"]
  });
  await chrome.tabs.sendMessage(tabId, { type: "portal/autoCaptureStart" }).catch(() => {});
}

async function setAutoCapture(tabId: number, enable: boolean): Promise<void> {
  const tabs = await autoCapTabs();
  const next = enable ? [...new Set([...tabs, tabId])] : tabs.filter(t => t !== tabId);
  await chrome.storage.session.set({ [AUTOCAP_KEY]: next });
  if (enable) await injectAutoCapture(tabId);
  else await chrome.tabs.sendMessage(tabId, { type: "portal/autoCaptureStop" }).catch(() => {});
}

async function isAutoCapturing(tabId: number): Promise<boolean> {
  return (await autoCapTabs()).includes(tabId);
}

/** Handles a page harvest sent by the auto-capture driver: merges it into the
 * held application (identity guard included) and tells the panel. Called by
 * the worker's message listener with the SENDER'S tab id - a tab that is not
 * auto-capture-enabled is ignored. */
export async function handleAutoCaptured(
  msg: { fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string },
  senderTabId: number | undefined
): Promise<void> {
  if (senderTabId == null || !(await isAutoCapturing(senderTabId))) return;
  const existing = await getCapturedApplication();
  const outcome = mergeIngestedFields(existing, msg.fields, {
    system: new URL(msg.url).hostname, url: msg.url, title: msg.title
  });
  // only persist + announce when something actually changed
  if (!outcome.replaced && existing !== null && outcome.added === 0) return;
  await setCapturedApplication(outcome.app);
  if (outcome.replaced) await chrome.storage.session.remove("bp/crmLink");
  chrome.runtime.sendMessage({
    type: "portal/captureUpdated", added: outcome.added, total: outcome.total, replaced: outcome.replaced
  } satisfies import("@/messages").CaptureUpdatedBroadcast).catch(() => {});
}

/** Full page loads kill content scripts - re-arm auto-capture on enabled tabs
 * (the per-origin permission the user granted persists across navigations). */
export function registerAutoCapReinjection(): void {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== "complete") return;
    void (async () => {
      if (!(await isAutoCapturing(tabId))) return;
      try { await injectAutoCapture(tabId); } catch { await setAutoCapture(tabId, false); }
    })();
  });
  chrome.tabs.onRemoved.addListener(tabId => { void setAutoCapture(tabId, false); });
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
  findInsuredMatches,
  createPolicy,
  createQuote,
  fillIfEmpty,
  getFieldCatalog: (env, refresh) => getFieldCatalog(env, { dvJson }, refresh),
  dvQuery: dvJson,
  upsertAccountNote,
  searchInsureds,
  getInsuredSourceRecords,
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
  ingestPortalTab,
  scanPortalTab,
  pickPortalTab,
  cancelPortalPick,
  peekPortalTab,
  saveFieldMap,
  setAutoCapture,
  isAutoCapturing
};
