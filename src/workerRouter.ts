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
import { getAllFieldMaps, setAllFieldMaps, PATH_LABEL, NOTE_TARGETS, fieldKeyOf, FIELD_KEY_PARTS, isArrayPath, isCrmTarget, isNoteTarget, isSecureTarget, isConcreteSecureTarget, noteLabelOf, rowTargetOf, securedIfIdentifier } from "@/portal/fieldMaps";
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
import { slotOf, withSlot } from "@/boldpenguin/people";
import { ACCOUNT_ADDRESS_COLUMNS, addressRows, buildRelatedContactNote, noteOutcomeText, primarySlots, relatedNoteSlots, buildSupplementalNote, buildTimelineNote, coverageLinesFromCapture, crmGroup, parseMoney, quoteFromCapture, writeApplicationKnowledge } from "@/crm/appCommit";
import { EZLYNX_FIELDS, coveredPageLabels, dataServicePeekItems, effectiveTargets, ezlynxFields, ezlynxSecure, getDataServiceMaps, mergeHeldQuotes, quotesFromRun, withoutSsn } from "@/sources/ezlynxSource";
import { createLead, createPolicy, createQuote, dvJson, fillIfEmpty, upsertRecordAddress, upsertRecordNote, findInsuredMatches, getInsuredSourceRecords, searchInsureds, upsertAccountNote } from "@/crm/dataverse";
import { catalogLabel, coerceGroup, getFieldCatalog, type FieldCatalog } from "@/crm/fieldCatalog";
import { buildCrmCaptureFields, buildCrmColumnFields } from "@/crm/crmSource";
import { buildFillValues } from "@/portal/fillValues";
import { dataServiceScope, getOptionMaps, setOptionMaps } from "@/portal/optionMaps";
import { translateCapturedChoices, translateFillChoices } from "@/portal/choiceRouting";
import {
  addPendingSecure, clearPendingSecure, getPendingSecure, maskSecure, readSecureValues,
  resolveSecureRecords, secureRecordOf, slotNamesOf, type SecureValues
} from "@/portal/secureFill";

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
  upsertRecordAddress: typeof upsertRecordAddress;
  upsertRecordNote: typeof upsertRecordNote;
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
  ingestPortalTab: (tabId: number) => Promise<{
    fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string;
    /** Values of controls mapped to SECURED targets: held apart, never captured. */
    secure?: { path: string; value: string }[];
  }>;
  /** Mapping editor: enumerates the page's fillable controls with auto/saved mappings. */
  scanPortalTab: (tabId: number) => Promise<import("@/boldpenguin/types").PortalScanResult>;
  /** Waits for the user to click one field on the page and returns its identity.
   * "timeout" = nothing happened in this ~20s round (panel re-arms); null = user cancelled. */
  pickPortalTab: (tabId: number) => Promise<import("@/boldpenguin/types").PortalScanRow | "timeout" | null>;
  /** Resolves a pending pick in every frame (the panel's Stop button). */
  cancelPortalPick: (tabId: number) => Promise<void>;
  /** Outlines the mapped fields on the page (null clears). */
  peekPortalTab: (tabId: number, items: import("@/boldpenguin/types").PeekItem[] | null) => Promise<import("@/boldpenguin/types").PeekResult>;
  /** Outlines in red what the capture reads but no saved mapping covers. */
  peekUnmappedTab: (tabId: number, on: boolean) => Promise<import("@/boldpenguin/types").PeekResult>;
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
  // extension pages (QuoteCraftZ Settings), chrome://, edge://, file:, http:
  // - nothing to ingest or fill, and no EZLynx run to look up
  return "none";
}

type HeldQuote = import("@/boldpenguin/types").HeldQuote;
type BatchRow = import("@/crm/dataverse").BatchItemResult;

/** EZLynx ingest through its data service: the latest rating run (or the
 * applicant alone when none exists), applicant fields routed by the agent's
 * data-service mappings, the run's quotes held for import. */
async function catalogOrNull(deps: Deps): Promise<FieldCatalog | null> {
  try { return await deps.getFieldCatalog(await deps.getActiveEnvironment()); } catch { return null; }
}

async function ingestEzlynx(deps: Deps, url: string, tabId?: number): Promise<Res<unknown>> {
  const ctx = await deps.sendToEzlynxTab<{ applicantId: number | null }>({ type: "ezlynx/getContext" });
  if (!ctx.ok) return ctx;
  const applicantId = ctx.data.applicantId;
  if (applicantId == null) return { ok: false, error: "Open an EZLynx applicant, then ingest.", kind: "session" };
  let run: import("@/types").CapturedRun | null = null;
  const runs = await deps.sendToEzlynxTab<import("@/types").RunListItem[]>({ type: "ezlynx/listRuns", applicantId });
  if (runs.ok && runs.data.length) {
    const latest = [...runs.data].sort((a, b) => b.created.localeCompare(a.created))[0]!;
    const captured = await deps.sendToEzlynxTab<import("@/types").CapturedRun>({ type: "ezlynx/captureRun", applicantId, run: latest });
    if (!captured.ok) return captured;
    run = captured.data;
  }
  let applicant = run?.applicant ?? null;
  if (!applicant) {
    const a = await deps.sendToEzlynxTab<import("@/types").CapturedApplicant>({ type: "ezlynx/getApplicant", applicantId });
    if (!a.ok) return a;
    applicant = a.data;
  }
  const maps = await getDataServiceMaps();
  // EZLynx's wording for choices -> the exact CRM choice (Settings mappings)
  const catalog = await catalogOrNull(deps);
  const optionMaps = await getOptionMaps();
  const fields = translateCapturedChoices(ezlynxFields(applicant, maps["ezlynx"]), optionMaps[dataServiceScope("ezlynx")], catalog);
  // fields the agent mapped ON the page that the service doesn't return
  // (VIN, vehicle details...): read from the page, mapped ones only - the
  // service already covers the rest exactly
  let pageSecure: { path: string; value: string }[] = [];
  const origin = (() => { try { return new URL(url).origin; } catch { return ""; } })();
  if (tabId !== undefined && origin && Object.keys(await fieldMapFor(origin)).length) {
    try {
      const page = await deps.ingestPortalTab(tabId);
      const mapped = page.fields.filter(f => f.mapped).map(f => ({ ...f, section: f.section || "Page fields" }));
      fields.push(...translateCapturedChoices(mapped, optionMaps[origin], catalog));
      pageSecure = page.secure ?? [];
    } catch { /* the data service capture still lands */ }
  }
  const existing = await deps.getCapturedApplication();
  const outcome = mergeIngestedFields(existing, fields, {
    system: "EZLynx",
    url,
    title: `${applicant.firstName} ${applicant.lastName}`.trim()
  });
  if (run) {
    const env = await deps.getActiveEnvironment();
    const aliases = await deps.getCarrierAliases(env.orgUrl);
    outcome.app.quotes = mergeHeldQuotes(outcome.app.quotes, quotesFromRun(run, aliases));
    outcome.app.quoteIssues = run.blocks.flatMap(b => b.errors.map(e => ({ lob: b.lob, carrierName: e.carrierName, message: e.message })));
    // the stored run never carries an SSN (it went to the secured channel)
    outcome.app.dataService = { kind: "ezlynx", run: { ...run, applicant: withoutSsn(run.applicant) } };
  }
  await deps.setCapturedApplication(outcome.app);
  if (outcome.replaced) { await chrome.storage.session.remove("bp/crmLink"); await clearPendingSecure(); }
  // SSN / DL# from the data service: secured pass-through only (page values
  // follow the people they belong to)
  const securedHeld = await addPendingSecure([
    ...remapSecure(ezlynxSecure(applicant, maps["ezlynx"]), outcome.slotMap), ...remapSecure(pageSecure, outcome.slotMap), ...(outcome.secured ?? [])
  ]);
  return { ok: true, data: { ...outcome, securedHeld } };
}

/** Secured values follow the people they belong to: an incoming person
 * matched to another held slot takes their secured values along. */
function remapSecure(list: { path: string; value: string }[], slotMap: Map<number, number> | undefined): { path: string; value: string }[] {
  if (!slotMap?.size) return list;
  return list.map(s => {
    const from = slotOf(s.path);
    const to = from !== null ? slotMap.get(from) : undefined;
    return to !== undefined && to !== from ? { ...s, path: withSlot(s.path, to) } : s;
  });
}

/** A carrier portal page showing a quoted premium (no policy number) as a
 * held quote, one per site. */
function portalHeldQuote(app: import("@/boldpenguin/types").CapturedApplication): HeldQuote | null {
  const draft = quoteFromCapture(app);
  if (!draft.hasQuote) return null;
  const host = (() => { try { return new URL(app.source.url).hostname; } catch { return app.source.system; } })();
  return {
    key: `portal:${host}`,
    provider: "Portal",
    source: host,
    lob: "",
    carrierName: draft.carrierName,
    carrierRef: null,
    carrierId: null,
    kind: "requested",
    quoteNumber: null,
    premium: parseMoney(draft.premiumText),
    termMonths: null,
    premiumStatus: "estimated",
    coverageSummary: draft.coverageSummary,
    coverageLines: coverageLinesFromCapture(app),
    link: app.source.url,
    selected: true
  };
}

export interface QuoteGroup { lob: string; opportunityId: string; lobId: string | null; desiredEffectiveDate: string | null; created: boolean }

/** Writes the held, selected quotes onto their line-of-business
 * opportunities - EZLynx quotes exactly as the dedicated importer did (alt
 * keys, coverage lines, carrier Q&A), portal quotes as carrier-direct
 * quotes - honoring each quote's Firm/Estimated choice. */
async function writeHeldQuotes(
  deps: Deps,
  env: CrmEnvironment,
  msg: { accountId: string; recordName: string; accountCreatedByPanel: boolean; ownerId: string | null; ownerName: string | null; groups: QuoteGroup[] }
): Promise<BatchRow[]> {
  const app = await deps.getCapturedApplication();
  const results: BatchRow[] = [];
  if (!app?.quotes?.length) return results;
  const groupOf = new Map(msg.groups.map(g => [g.lob, g]));
  const selected = app.quotes.filter(q => q.selected && groupOf.has(q.lob));

  // EZLynx-sourced: the precise importer path over the held rating run
  const ez = selected.filter(q => q.provider === "EZLynx");
  if (ez.length && app.dataService?.kind === "ezlynx") {
    let quotingMethodId = await deps.getQuotingMethodId(env, "EZLynx");
    if (quotingMethodId == null) quotingMethodId = await deps.createQuotingMethod(env, "EZLynx");
    const blockSelections: Record<string, import("@/crm/mapping").BlockSelection> = {};
    for (const g of msg.groups) blockSelections[g.lob] = { opportunityId: g.opportunityId, lineOfBusinessId: g.lobId, desiredEffectiveDate: g.desiredEffectiveDate };
    const carrierMap: Record<number, string | null> = {};
    for (const q of ez) if (q.carrierRef) carrierMap[Number(q.carrierRef)] = q.carrierId;
    const payload: import("@/crm/mapping").CommitPayload = {
      run: app.dataService.run,
      accountId: msg.accountId,
      quotingMethodId,
      blockSelections,
      carrierMap,
      selectedKeys: ez.map(q => q.key),
      ownerId: msg.ownerId,
      ownerName: msg.ownerName,
      accountCreatedByPanel: msg.accountCreatedByPanel,
      createdOpportunityIds: msg.groups.filter(g => g.created).map(g => g.opportunityId),
      premiumStatusByKey: Object.fromEntries(ez.map(q => [q.key, q.premiumStatus]))
    };
    const existing = await deps.getExistingQuoteStatuses(env, payload.selectedKeys);
    const quoteResults = await deps.executeBatch(env, deps.buildQuoteOps(payload, existing));
    results.push(...quoteResults.map(r => {
      const q = ez.find(x => x.key === r.key);
      return q ? { ...r, key: `Quote: ${q.carrierName} ${q.lob} ${q.premium != null ? `$${q.premium.toFixed(2)}` : ""} (${q.premiumStatus === "firm" ? "Firm" : "Estimated"})` } : r;
    }));
    try {
      const idByKey = new Map(quoteResults.filter(r => r.entityId).map(r => [r.key, r.entityId!]));
      const covTargets = [];
      for (const block of payload.run.blocks) {
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
        if (cov.linesWritten) results.push({ key: `Coverage detail: logged ${cov.linesWritten} lines across ${cov.quotesCovered} quotes`, status: 204, error: null, entityId: null });
      }
    } catch (e) {
      results.push({ key: "Coverage detail", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
    }
    try {
      const know = await writeQuestionKnowledge(env, payload.run, msg.accountId, {
        getKnowledgeNavProps: deps.getKnowledgeNavProps,
        executeBatch: deps.executeBatch,
        query: deps.dvQuery
      });
      if (know.questionsUpserted || know.answersUpserted) {
        results.push({ key: `Question knowledge: ${know.questionsUpserted} questions, ${know.answersUpserted} answers upserted`, status: 204, error: null, entityId: null });
      }
    } catch (e) {
      results.push({ key: "Question knowledge", status: 0, error: `Failed (quotes still imported): ${String((e as Error).message ?? e)}`, entityId: null });
    }
  }

  // portal-sourced: carrier-direct quotes, one per site and opportunity
  for (const q of selected.filter(x => x.provider === "Portal")) {
    const g = groupOf.get(q.lob)!;
    try {
      let quotingMethodId = await deps.getQuotingMethodId(env, "Carrier Direct");
      if (quotingMethodId == null) quotingMethodId = await deps.createQuotingMethod(env, "Carrier Direct");
      const sourceUrl = q.link ?? app.source.url;
      const ext = `${new URL(sourceUrl).hostname}:${g.opportunityId}`;
      const keepFirm = (await deps.getExistingQuoteStatuses(env, [ext], "Portal")).get(ext) === 738590002;
      const extra = await coercedExtras(deps, env, "quote", crmGroup(app, "crm:quote") ?? undefined);
      const { quoteId } = await withExtrasFallback(extra, x => deps.createQuote(env, {
        accountId: msg.accountId,
        opportunityId: g.opportunityId,
        carrierId: q.carrierId,
        lobId: g.lobId,
        name: `${q.carrierName} - ${msg.recordName}`,
        premium: q.premium,
        coverageSummary: q.coverageSummary,
        effectiveDate: g.desiredEffectiveDate,
        sourceUrl,
        quotingMethodId,
        premiumStatus: q.premiumStatus,
        keepFirm
      }, x));
      results.push({ key: `Quote: ${q.carrierName} ${q.premium != null ? `$${q.premium.toFixed(2)}` : ""} (${q.premiumStatus === "firm" ? "Firm" : "Estimated"})`, status: 204, error: null, entityId: quoteId });
      if (q.coverageLines.length) {
        try {
          await writeCoverageLines(env, [{ quote: { coverageLines: q.coverageLines } as import("@/types").CapturedQuote, quoteId }], {
            getCoverageQuoteNavProp: deps.getCoverageQuoteNavProp,
            getCoverageRowIds: deps.getCoverageRowIds,
            executeBatch: deps.executeBatch
          });
        } catch { /* coverage depth is best-effort; the quote row stands */ }
      }
    } catch (e) {
      results.push({ key: `Quote: ${q.carrierName}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
    }
  }

  // servicing agent owns what this load created and joins the team
  if (msg.ownerId && msg.ownerName && selected.length) {
    try {
      const sv = await ensureServicingAssignment(env, {
        accountId: msg.accountId,
        ownerId: msg.ownerId,
        ownerName: msg.ownerName,
        accountCreatedByPanel: msg.accountCreatedByPanel,
        createdOpportunityIds: msg.groups.filter(g => g.created).map(g => g.opportunityId)
      }, {
        assignOwner: deps.assignOwner,
        hasServicingTeamMember: deps.hasServicingTeamMember,
        createServicingTeamMember: deps.createServicingTeamMember
      });
      if (sv.ownersAssigned || sv.teamMemberCreated) {
        results.push({ key: `Servicing: ${msg.ownerName}${sv.ownersAssigned ? ` owns ${sv.ownersAssigned} new record${sv.ownersAssigned === 1 ? "" : "s"}` : ""}${sv.teamMemberCreated ? ", added to the servicing team" : ""}`, status: 204, error: null, entityId: null });
      }
    } catch (e) {
      results.push({ key: "Servicing assignment", status: 0, error: String((e as Error).message ?? e), entityId: null });
    }
  }
  return results;
}

/** The account's captured columns; when the agent picked the account's
 * address on Load (any person's), that address replaces the captured one
 * entirely (never a mix of the two). */
function accountGroup(account: Record<string, unknown> | undefined, picked: Record<string, string> | undefined): Record<string, unknown> | undefined {
  if (!picked) return account;
  const out: Record<string, unknown> = { ...(account ?? {}) };
  for (const c of ACCOUNT_ADDRESS_COLUMNS) { if (picked[c]) out[c] = picked[c]; else delete out[c]; }
  return out;
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

      case "env/setActive": {
        await deps.setActiveEnvironment(msg.id);
        // CRM carrier ids belong to one environment: re-match held quotes
        // against the new org's remembered aliases (others cleared)
        const app = await deps.getCapturedApplication();
        if (app?.quotes?.length) {
          const env = await deps.getActiveEnvironment();
          const aliases = await deps.getCarrierAliases(env.orgUrl);
          app.quotes = app.quotes.map(q => ({
            ...q,
            carrierId: q.provider === "EZLynx" && q.carrierRef ? aliases[Number(q.carrierRef)] ?? null : null
          }));
          await deps.setCapturedApplication(app);
        }
        return { ok: true, data: null };
      }

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
        // the panel never receives an SSN
        return { ok: true, data: { run: { ...res.data, applicant: withoutSsn(res.data.applicant) }, aliases } };
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

      case "panel/upsertNote": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await deps.upsertRecordNote(env, msg.record, msg.id, msg.subject, msg.html) };
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
        let catalog: FieldCatalog | null = null;
        try { catalog = await deps.getFieldCatalog(env); } catch { catalog = null; }
        const fields = [...buildCrmCaptureFields(records), ...buildCrmColumnFields(records, catalog)];
        if (!fields.length) {
          return { ok: false, error: "That record has no usable insured data.", kind: "http" };
        }
        const existing = await deps.getCapturedApplication();
        const outcome = mergeIngestedFields(existing, fields, {
          system: `CRM (${env.name})`, url: env.orgUrl, title: msg.name
        });
        await deps.setCapturedApplication(outcome.app);
        if (outcome.replaced) await clearPendingSecure();
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
        await clearPendingSecure();
        return { ok: true, data: null };

      case "panel/securePending": {
        // masked only: the panel never receives a secured value
        const pending = await getPendingSecure();
        if (!Object.keys(pending).length) return { ok: true, data: [] };
        let catalog: FieldCatalog | null = null;
        try { catalog = await deps.getFieldCatalog(await deps.getActiveEnvironment()); } catch { catalog = null; }
        return {
          ok: true,
          data: Object.entries(pending).map(([path, v]) => ({
            path, label: catalogLabel(catalog, path) ?? path.replace(/^secure:/, ""), masked: maskSecure(v)
          }))
        };
      }

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

      case "panel/portalChoices": {
        // one field's current value and options (styled dropdowns opened,
        // read and closed); the first frame holding the field answers
        await chrome.scripting.executeScript({ target: { tabId: msg.tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js"] });
        const frames = await chrome.scripting.executeScript({
          target: { tabId: msg.tabId, allFrames: true },
          func: (k: string, l: string[]) => (globalThis as { __bettersPortalChoices?: (k: string, l: string[]) => unknown }).__bettersPortalChoices?.(k, l) ?? null,
          args: [msg.key ?? "", msg.labels ?? []]
        });
        const hit = frames.map(fr => fr.result as { current: string; options: string[]; refused?: boolean } | null).find(r => r !== null) ?? null;
        return { ok: true, data: hit };
      }

      case "panel/portalPickCancel":
        await deps.cancelPortalPick(msg.tabId);
        return { ok: true, data: null };

      case "panel/portalPeek":
        return { ok: true, data: await deps.peekPortalTab(msg.tabId, msg.items) };

      case "panel/portalPeekUnmapped":
        return { ok: true, data: await deps.peekUnmappedTab(msg.tabId, msg.on) };

      case "panel/saveFieldMap":
        await deps.saveFieldMap(msg.origin, msg.map);
        if (msg.options) await setOptionMaps(msg.origin, msg.options);
        return { ok: true, data: null };

      case "panel/portalIngest": {
        // EZLynx is a DATA-SERVICE source: same intake, exact data (applicant
        // + rating run from its own service), routed by Settings mappings
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        if (tab?.url && /^https:\/\/app\.ezlynx\.com\//i.test(tab.url)) return await ingestEzlynx(deps, tab.url, msg.tabId);
        const harvested = await deps.ingestPortalTab(msg.tabId);
        const existing = await deps.getCapturedApplication();
        // this site's wording for choices -> the exact CRM choice
        const pageOrigin = (() => { try { return new URL(harvested.url).origin; } catch { return ""; } })();
        harvested.fields = translateCapturedChoices(harvested.fields, (await getOptionMaps())[pageOrigin], await catalogOrNull(deps));
        const outcome = mergeIngestedFields(existing, harvested.fields, {
          system: new URL(harvested.url).hostname,
          url: harvested.url,
          title: harvested.title
        });
        // a portal page showing a quoted premium holds it as a quote too
        const held = portalHeldQuote(outcome.app);
        if (held) outcome.app.quotes = mergeHeldQuotes(outcome.app.quotes, [held]);
        await deps.setCapturedApplication(outcome.app);
        if (outcome.replaced) {
          await chrome.storage.session.remove("bp/crmLink");
          await clearPendingSecure();
        }
        // secured values bypass the capture entirely, and follow their people
        const securedHeld = await addPendingSecure([...remapSecure(harvested.secure ?? [], outcome.slotMap), ...(outcome.secured ?? [])]);
        return { ok: true, data: { ...outcome, securedHeld } };
      }

      case "panel/updateQuote": {
        const app = await deps.getCapturedApplication();
        const quote = app?.quotes?.find(q => q.key === msg.key);
        if (!app || !quote) return { ok: false, error: "That quote is no longer held. Ingest the page again.", kind: "session" };
        Object.assign(quote, msg.patch);
        await deps.setCapturedApplication(app);
        // a carrier chosen for an EZLynx quote is remembered for that carrier
        if (msg.patch.carrierId && quote.provider === "EZLynx" && quote.carrierRef) {
          const env = await deps.getActiveEnvironment();
          await deps.saveCarrierAlias(env.orgUrl, Number(quote.carrierRef), msg.patch.carrierId);
        }
        return { ok: true, data: app };
      }

      case "panel/writeQuotes": {
        const env = await deps.getActiveEnvironment();
        return { ok: true, data: await writeHeldQuotes(deps, env, msg) };
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
        let primaryContactId: string | null = null;
        let coContactIds: { slot: number | null; contactId: string }[] = [];
        try {
          const en = await ensureInsuredData(env, msg.accountId, applicant, {
            getAccountEnrichmentState: deps.getAccountEnrichmentState,
            updateAccount: deps.updateAccount,
            getAccountContacts: deps.getAccountContacts,
            createContact: deps.createContact,
            contactHasDlColumns: deps.contactHasDlColumns
          }, msg.primary ?? { slot: 1, explicit: false });
          const bits = [];
          if (en.filledFields.length) bits.push(`filled ${en.filledFields.length} field${en.filledFields.length === 1 ? "" : "s"}`);
          if (en.contactsCreated.length) bits.push(`created contact${en.contactsCreated.length === 1 ? "" : "s"}: ${en.contactsCreated.join(", ")}`);
          if (en.primaryContactSet) bits.push("set primary contact");
          results.push({ key: `Insured profile: ${bits.length ? bits.join("; ") : "already complete"}`, status: 204, error: null, entityId: null });
          coContactIds = en.coContactIds ?? [];
          // taught CRM columns, hierarchy order: account, primary contact,
          // then related contacts that matched existing records (created
          // ones received their columns on create). Fill-if-empty: agent-
          // entered CRM data always wins.
          const columnWrites: { label: string; set: string; id: string | null; values: Record<string, unknown> }[] = [
            { label: "Insured", set: "accounts", id: msg.accountId, values: coerceGroup(entityOf("account"), accountGroup(groupOf("crm:account"), msg.accountAddress)) },
            { label: "Primary contact", set: "contacts", id: (primaryContactId = en.applicantContactId), values: coerceGroup(entityOf("primarycontact"), groupOf("crm:primarycontact")) },
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
          // the applicant's addresses: captured row N -> address number N on
          // THEIR contact (row 1 = the contact's Address 1; fill-if-empty,
          // missing rows created). Other contacts' one address rides on their
          // own contact's Address 1 columns.
          for (const n of addressRows(app)) {
            const values = coerceGroup(entityOf("addresses"), groupOf(`crm:address${n}`));
            if (!Object.keys(values).length) continue;
            if (!en.applicantContactId) {
              results.push({ key: `Address ${n}: no contact record to attach to`, status: 0, error: "skipped", entityId: null });
              continue;
            }
            try {
              const r = await deps.upsertRecordAddress(env, "contact", en.applicantContactId, n, values);
              if (r.outcome !== "unchanged") results.push({ key: `Address ${n}: ${r.outcome === "created" ? "added" : `filled ${r.columns.length} column${r.columns.length === 1 ? "" : "s"}`}`, status: 204, error: null, entityId: null });
            } catch (e) {
              results.push({ key: `Address ${n}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
            }
          }
          // secured pass-through: held values go ONLY to their secured
          // columns (fill-if-empty), related contacts matched by name
          const pending = await getPendingSecure();
          if (Object.keys(pending).length) {
            results.push(await writePendingSecure(deps, env, msg.accountId, en.applicantContactId, app, pending));
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
            results.push({ key: `Supplemental data: ${noteOutcomeText(outcome)} (${note.count} unmapped field${note.count === 1 ? "" : "s"})`, status: 204, error: null, entityId: null });
          }
        } catch (e) {
          results.push({ key: "Supplemental data note", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
        // values tagged for the insured's / primary contact's timeline: one
        // organized rich-text entry per record and source site (opportunity,
        // quote and policy notes are written by the panel once those exist)
        const noteTargets: { record: "account" | "contact"; id: string | null; label: string }[] = [
          { record: "account", id: msg.accountId, label: "Insured" },
          { record: "contact", id: primaryContactId, label: "Primary contact" }
        ];
        for (const t of noteTargets) {
          const tl = buildTimelineNote(app, t.record);
          if (!tl) continue;
          if (!t.id) {
            results.push({ key: `Notes for ${t.label}: no record to attach to`, status: 0, error: "skipped", entityId: null });
            continue;
          }
          try {
            const outcome = await deps.upsertRecordNote(env, t.record, t.id, tl.subject, tl.html);
            results.push({ key: `Notes for ${t.label}: ${noteOutcomeText(outcome)} (${tl.count} value${tl.count === 1 ? "" : "s"})`, status: 204, error: null, entityId: null });
          } catch (e) {
            results.push({ key: `Notes for ${t.label}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
        }
        // values tagged "Notes: Related contact": each on that person's own
        // timeline (the CRM contact their row matched or created)
        for (const slot of relatedNoteSlots(app)) {
          const tl = buildRelatedContactNote(app, slot);
          if (!tl) continue;
          // a row that restates the primary insured goes on the primary contact
          const id = coContactIds.find(c => c.slot === slot)?.contactId ??
            (primarySlots(app).includes(slot) ? primaryContactId : null);
          const who = `Related contact ${slot - 1}`;
          if (!id) {
            results.push({ key: `Notes for ${who}: no contact record to attach to`, status: 0, error: "skipped", entityId: null });
            continue;
          }
          try {
            const outcome = await deps.upsertRecordNote(env, "contact", id, tl.subject, tl.html);
            results.push({ key: `Notes for ${who}: ${noteOutcomeText(outcome)} (${tl.count} value${tl.count === 1 ? "" : "s"})`, status: 204, error: null, entityId: null });
          } catch (e) {
            results.push({ key: `Notes for ${who}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
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
  // the ingester names labelled-field rows ("field:vehicles|vin")
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-ingest.js", "portal/portal-fill.js"] });
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
  // the ingester supplies form-field labels, so a click inside a labelled
  // field maps it by label (robust on any site's design system)
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-ingest.js", "portal/portal-fill.js"] });
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

/** An array mapping's table: its record type ("Related contacts") and the
 * column name ("First Name"); null for single-record mappings. */
function arrayTableOf(path: string, catalog: FieldCatalog | null): { title: string; column: string } | null {
  const crm = /^crm:([a-z]+)\[\]\.([a-z0-9_]+)$/.exec(path);
  if (crm) {
    const entity = catalog?.entities.find(e => e.key === crm[1]);
    const column = entity?.columns.find(c => c.name === crm[2])?.label ?? crm[2]!;
    const title = (entity?.label ?? crm[1]!).replace(/ \(all rows\)$/, "");
    return { title: title.charAt(0).toUpperCase() + title.slice(1), column };
  }
  const semantic = /^([a-z]+)\[\]\.[a-zA-Z]+$/.exec(path);
  if (semantic) {
    const title = semantic[1] === "contacts" ? "Related contacts" : semantic[1] === "vehicles" ? "Vehicles" : semantic[1]!;
    const label = (PATH_LABEL.get(path) ?? "").replace(/^(Related contact|Vehicle) /i, "");
    return { title, column: label.charAt(0).toUpperCase() + label.slice(1) };
  }
  return null;
}

/** Peek: every frame outlines its own mapped elements; counts aggregate. A
 * key resolved in ANY frame counts as shown (frames that lack it report it
 * missing), so missing = items found nowhere. */
/** A saved target as the peek's badge text. */
function peekLabel(target: string, catalog: FieldCatalog | null): string {
  if (target === "skip") return "Never fill";
  if (isNoteTarget(target)) return noteLabelOf(target);
  if (target.startsWith("label:")) return target.slice(6);
  const direct = PATH_LABEL.get(target) ?? catalogLabel(catalog, target);
  if (direct) return direct;
  const row = rowTargetOf(target);
  if (row) return `${PATH_LABEL.get(row.arrayPath) ?? catalogLabel(catalog, row.arrayPath) ?? row.arrayPath} (row ${row.row})`;
  return target;
}

/** Fields a data service fills on its own site (EZLynx: Gender, DOB...),
 * as labelled-field peek items with the CRM target they feed. */
async function serviceItemsFor(origin: string, catalog: FieldCatalog | null): Promise<import("@/boldpenguin/types").PeekItem[]> {
  if (origin !== "https://app.ezlynx.com") return [];
  return dataServicePeekItems((await getDataServiceMaps())["ezlynx"], t => peekLabel(t, catalog))
    .map(({ key, label, kind, labels }) => ({ key, label, kind, labels }));
}

/** Green for mapped, red for what the capture reads that nothing covers -
 * one view, from the mapping editor (its draft as items) or from intake
 * (the saved mapping). null clears. */
async function peekPortalTab(
  tabId: number,
  items: import("@/boldpenguin/types").PeekItem[] | null
): Promise<import("@/boldpenguin/types").PeekResult> {
  let arg: unknown = null;
  if (items) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["portal/portal-mapper.js", "portal/portal-ingest.js", "portal/portal-fill.js"]
    });
    const origin = await tabOrigin(tabId);
    let catalog: FieldCatalog | null = null;
    try { catalog = await getFieldCatalog(await getActiveEnvironment(), { dvJson }); } catch { catalog = null; }
    const service = origin ? await serviceItemsFor(origin, catalog) : [];
    arg = {
      // the editor's service items only signal a change: the saved
      // data-service mapping is the truth
      items: [...items.filter(i => !i.key.startsWith("service:")), ...service],
      map: {},
      payload: await getCapturedApplication(),
      pageLabels: origin === "https://app.ezlynx.com" ? coveredPageLabels((await getDataServiceMaps())["ezlynx"]) : []
    };
  }
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (a: unknown) =>
      (globalThis as { __bettersPortalPeekAll?: (a: unknown) => unknown }).__bettersPortalPeekAll?.(a) ?? null,
    args: [arg]
  });
  const results = frames
    .map(f => f.result as (import("@/boldpenguin/types").PeekResult & { unmapped?: number }) | null)
    .filter((r): r is import("@/boldpenguin/types").PeekResult & { unmapped?: number } => r !== null);
  const total = items?.length ?? 0;
  const shown = Math.min(total, results.reduce((n, r) => n + r.shown, 0));
  return { shown, missing: Math.max(0, total - shown), unmapped: results.reduce((n, r) => n + (r.unmapped ?? 0), 0) };
}

/** Intake's peek: the SAVED mapping in green, the uncovered in red. */
async function peekUnmappedTab(tabId: number, on: boolean): Promise<import("@/boldpenguin/types").PeekResult> {
  if (!on) return peekPortalTab(tabId, null);
  const origin = await tabOrigin(tabId);
  const saved = origin ? await fieldMapFor(origin) : {};
  let catalog: FieldCatalog | null = null;
  try { catalog = await getFieldCatalog(await getActiveEnvironment(), { dvJson }); } catch { catalog = null; }
  const items: import("@/boldpenguin/types").PeekItem[] = Object.entries(saved).map(([key, target]) => ({
    key,
    label: peekLabel(target, catalog),
    kind: target === "skip" ? "skip" : "mapped",
    array: isArrayPath(target) || isNoteTarget(target) || key.startsWith("field:"),
    family: key.startsWith("field:") && isArrayPath(target)
  }));
  const r = await peekPortalTab(tabId, items);
  // intake's eye reports the red count
  return { shown: r.unmapped ?? 0, missing: 0, mapped: r.shown } as import("@/boldpenguin/types").PeekResult;
}
/** Writes this session's held secured values onto the loaded insured's
 * records. Only columns the live catalog lists as SECURED for that entity
 * are written; a related-contact value lands only on the contact whose name
 * matches the capture's row (never by position). */
async function writePendingSecure(
  deps: Deps, env: CrmEnvironment, accountId: string, primaryContactId: string | null,
  app: import("@/boldpenguin/types").CapturedApplication, pending: SecureValues
): Promise<BatchRow> {
  try {
    const catalog = await deps.getFieldCatalog(env);
    const allowed = (key: string) => new Set((catalog.entities.find(e => e.key === key)?.secured ?? []).map(c => c.name));
    const recs = await resolveSecureRecords(env, { kind: "account", id: accountId }, deps.dvQuery, slotNamesOf(app.normalized));
    if (primaryContactId) recs.primaryContactId = primaryContactId;
    const byRecord = new Map<string, { set: string; id: string; values: Record<string, unknown> }>();
    let skipped = 0;
    for (const [path, value] of Object.entries(pending)) {
      const target = secureRecordOf(path, recs);
      const entityKey = /^secure:(account|primarycontact)\./.test(path) ? path.slice(7).split(".")[0]! : "contacts";
      if (!target || !allowed(entityKey).has(target.column)) { skipped += 1; continue; }
      const k = `${target.set}:${target.id}`;
      const entry = byRecord.get(k) ?? { set: target.set, id: target.id, values: {} };
      entry.values[target.column] = value;
      byRecord.set(k, entry);
    }
    let written = 0;
    for (const r of byRecord.values()) written += (await deps.fillIfEmpty(env, r.set, r.id, r.values)).length;
    return {
      key: `Secured fields: ${written} written${skipped ? `, ${skipped} not matched to a record` : ""}`,
      status: 204, error: null, entityId: null
    };
  } catch (e) {
    return { key: "Secured fields", status: 0, error: String((e as Error).message ?? e), entityId: null };
  }
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
  // every value any mapping target can name (CRM columns, row slots...);
  // secured values are NOT in here
  let catalog: FieldCatalog | null = null;
  try { catalog = await getFieldCatalog(await getActiveEnvironment(), { dvJson }); } catch { catalog = null; }
  // CRM choices go in as the form's own wording where the agent mapped it
  const withValues = {
    ...payload,
    values: translateFillChoices(buildFillValues(payload), overrides, origin ? (await getOptionMaps())[origin] : undefined, catalog)
  };
  type FrameFill = import("@/boldpenguin/types").PortalFillResult & { secure?: { key: string; path: string }[] };
  // pass 1: everything but secured fields, no advance yet
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (p: unknown, o: boolean, a: boolean, ov: unknown) =>
      (globalThis as { __bettersPortalFill?: (p: unknown, o: boolean, a: boolean, ov: unknown) => unknown }).__bettersPortalFill?.(p, o, a, ov) ?? null,
    args: [withValues, overwrite, false, overrides]
  });
  const results = frames
    .map(f => ({ frameId: f.frameId, r: f.result as FrameFill | null }))
    .filter((x): x is { frameId: number; r: FrameFill } => x.r !== null);
  if (!results.length) throw new Error("The portal page did not respond. Reload it and retry.");
  const total: import("@/boldpenguin/types").PortalFillResult = results.map(x => x.r).reduce((a, r) => ({
    filledCount: a.filledCount + r.filledCount,
    existingCount: a.existingCount + r.existingCount,
    optionMismatchCount: a.optionMismatchCount + r.optionMismatchCount,
    controlCount: a.controlCount + r.controlCount,
    filled: [...a.filled, ...r.filled],
    noData: [...(a.noData ?? []), ...(r.noData ?? [])]
  }), { filledCount: 0, existingCount: 0, optionMismatchCount: 0, controlCount: 0, filled: [], noData: [] });

  // pass 2: secured fields, only in the frames that hold them, with only
  // the values those frames' mappings name. Read live from the CRM (field
  // security applies) over any held from this session's captures.
  const secureFrames = results.filter(x => (x.r.secure?.length ?? 0) > 0);
  if (secureFrames.length) {
    const paths = [...new Set(secureFrames.flatMap(x => x.r.secure!.map(s => s.path)))];
    let values: SecureValues = {};
    let note: string | null = null;
    const link = (await chrome.storage.session.get("bp/crmLink"))["bp/crmLink"] as import("@/messages").CrmLink | undefined;
    if (link) {
      try {
        const env = await getActiveEnvironment();
        const recs = await resolveSecureRecords(env, link, dvJson, slotNamesOf(payload.normalized));
        values = await readSecureValues(env, recs, paths, dvJson);
      } catch {
        note = "Could not read secured fields from the CRM.";
      }
    }
    values = { ...values, ...(await getPendingSecure()) };
    let filled = 0;
    let missing = 0;
    for (const x of secureFrames) {
      const subset: SecureValues = {};
      for (const s of x.r.secure!) if (values[s.path]) subset[s.path] = values[s.path]!;
      const [res] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [x.frameId] },
        func: (v: unknown, o: boolean, ov: unknown) =>
          (globalThis as { __bettersPortalFillSecure?: (v: unknown, o: boolean, ov: unknown) => unknown }).__bettersPortalFillSecure?.(v, o, ov) ?? null,
        args: [subset, overwrite, overrides]
      });
      const out = res?.result as { filled: { label: string; path: string }[]; missing: number } | null | undefined;
      if (!out) continue;
      filled += out.filled.length;
      missing += out.missing;
      total.filled.push(...out.filled);
    }
    total.filledCount += filled;
    total.secure = {
      filled, missing,
      note: note ?? (missing && !link ? "Pick the insured with Fill from CRM (or load to CRM) to fill secured fields." : null)
    };
  }
  if (autoAdvance) {
    const adv = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __bettersPortalAdvance?: () => unknown }).__bettersPortalAdvance?.() ?? null
    });
    for (const a of adv) {
      if (typeof a.result === "string") { total.filled.push({ label: a.result, path: "advance" }); total.filledCount += 1; break; }
    }
  }
  return total;
}

async function ingestPortalTab(tabId: number): Promise<{ fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string; secure: { path: string; value: string }[] }> {
  // the filler supplies controlKey, so saved control mappings route on capture
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["portal/portal-mapper.js", "portal/portal-fill.js", "portal/portal-ingest.js"] });
  type FrameHarvest = { fields: import("@/boldpenguin/types").CapturedAppField[]; title: string; url: string; secure?: { path: string; value: string }[] };
  // agent-taught read-only-text extractions for this site: "pick:<selector>"
  // entries resolve to the taught CRM field's display label, which the
  // normalizer recognizes - the page never chooses its own labels
  const origin = await tabOrigin(tabId);
  const siteMap = Object.fromEntries(Object.entries(origin ? await fieldMapFor(origin) : {}).map(([k, v]) => [k, securedIfIdentifier(v)]));
  // CRM-column teachings label themselves from the cached catalog (falling
  // back to the column's logical name when the catalog isn't loaded yet)
  let catalog: FieldCatalog | null = null;
  if (Object.values(siteMap).some(v => isCrmTarget(v))) {
    try { catalog = await getFieldCatalog(await getActiveEnvironment(), { dvJson }); } catch { catalog = null; }
  }
  const taught = Object.entries(siteMap)
    .filter(([k, v]) => k.startsWith("pick:") && v !== "skip" && (PATH_LABEL.has(v) || isCrmTarget(v) || isNoteTarget(v) || isSecureTarget(v)))
    .map(([k, v]) => {
      // note teachings are labeled on the page (column header / field label)
      if (isNoteTarget(v)) return { selector: k.slice(5), label: "", path: v };
      if (isSecureTarget(v)) return { selector: k.slice(5), label: "Secured", path: v };
      const full = PATH_LABEL.get(v) ?? catalogLabel(catalog, v) ?? v.replace(/^crm:/, "").replace("[]", "");
      // arrays render as their own table: record type = table, column = label
      const table = arrayTableOf(v, catalog);
      return table
        ? { selector: k.slice(5), label: table.column || full, section: table.title, path: v }
        : { selector: k.slice(5), label: full, path: v };
    });
  // labelled-field teachings ("field:vehicles|vin"): every card's field
  // with that label on that step, routed like a pick
  const labelled = Object.entries(siteMap)
    .filter(([k, v]) => k.startsWith("field:") && v !== "skip" && (PATH_LABEL.has(v) || isCrmTarget(v) || isNoteTarget(v)))
    .map(([k, v]) => {
      const m = FIELD_KEY_PARTS.exec(k);
      if (!m) return null;
      const table = arrayTableOf(v, catalog);
      return { byLabel: m[2]!, page: m[1] ?? "", label: "", path: v, ...(table ? { section: table.title } : {}) };
    })
    .filter(Boolean);
  taught.push(...(labelled as never[]));
  // control mappings (form inputs) route their values on capture as on fill
  const controls = Object.fromEntries(Object.entries(siteMap).filter(([k, v]) => !k.startsWith("pick:") && !k.startsWith("field:") && v !== "skip"));
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (t: unknown, c: unknown) => (globalThis as { __bettersPortalIngest?: (t: unknown, c: unknown) => unknown }).__bettersPortalIngest?.(t, c) ?? null,
    args: [taught, controls]
  });
  const results = frames.map(f => f.result as FrameHarvest | null).filter((r): r is FrameHarvest => r !== null);
  const top = results[0];
  if (!top) throw new Error("The page did not respond. Reload it and retry.");
  // the top frame names the capture; every frame (iframed quote forms included)
  // contributes its fields
  return {
    fields: results.flatMap(r => r.fields),
    secure: results.flatMap(r => r.secure ?? []).filter(s => isConcreteSecureTarget(s.path)),
    title: top.title, url: top.url
  };
}

const AUTOCAP_KEY = "autocap/tabs";

async function autoCapTabs(): Promise<number[]> {
  const s = await chrome.storage.session.get(AUTOCAP_KEY);
  return (s[AUTOCAP_KEY] as number[] | undefined) ?? [];
}

async function injectAutoCapture(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["portal/portal-mapper.js", "portal/portal-ingest.js", "portal/portal-autocap.js"]
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
  if (outcome.replaced) { await chrome.storage.session.remove("bp/crmLink"); await clearPendingSecure(); }
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
  upsertRecordAddress,
  upsertRecordNote,
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
  peekUnmappedTab,
  saveFieldMap,
  setAutoCapture,
  isAutoCapturing
};
