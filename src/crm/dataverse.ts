import { getAccessToken } from "./auth";
import type { CrmEnvironment } from "./environments";
import type { AccountEnrichmentState, ContactRow, NewContact } from "./enrich";

export class CrmAccessError extends Error {
  orgUrl: string;
  constructor(orgUrl: string, status: number) {
    super(`No access to ${orgUrl} (HTTP ${status})`);
    this.name = "CrmAccessError";
    this.orgUrl = orgUrl;
  }
}

export interface AccountMatch { accountId: string; name: string; city: string | null; postalCode: string | null; openOppCount: number }
export interface OppSummary { opportunityId: string; name: string; lobId: string | null; lobName: string | null; desiredEffectiveDate: string | null }
export interface CarrierRow { carrierId: string; name: string }
export interface UserRow { userId: string; fullName: string }
export interface LobRow { lobId: string; name: string }
export interface StageRow { stageId: string; name: string; order: number }
export interface PipelineStages { pipelineId: string; pipelineName: string; stages: StageRow[] }
export interface NewAccountFields {
  name: string;
  street: string | null; city: string | null; state: string | null; postalCode: string | null;
  phone: string | null; email: string | null;
}
export interface BatchItemResult { key: string; status: number; error: string | null; entityId: string | null }

const API = "/api/data/v9.2/";

async function dv(env: CrmEnvironment, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(env.orgUrl);
  const doFetch = () => fetch(env.orgUrl + API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0", "OData-Version": "4.0", Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
      ...(init.headers as Record<string, string> | undefined)
    }
  });
  let res = await doFetch();
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After") ?? "2");
    await new Promise(r => setTimeout(r, wait * 1000));
    res = await doFetch();
  }
  if (res.status === 401 || res.status === 403) throw new CrmAccessError(env.orgUrl, res.status);
  return res;
}

async function dvJson<T>(env: CrmEnvironment, path: string): Promise<T> {
  const res = await dv(env, path);
  if (!res.ok) throw new Error(`Dataverse ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

function esc(v: string): string { return v.replace(/'/g, "''"); }

async function dvPost<T>(env: CrmEnvironment, path: string, body: unknown): Promise<T> {
  const res = await dv(env, path, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dataverse ${res.status} creating ${path}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export function altKeyUrl(key: string): string {
  return `iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='${esc(key)}')`;
}

export async function searchAccounts(env: CrmEnvironment, name: string, postalCode: string | null): Promise<AccountMatch[]> {
  const q = `accounts?$select=name,accountid,address1_city,address1_postalcode&$filter=contains(name,'${esc(name)}')&$top=10`;
  const { value } = await dvJson<{ value: Record<string, string | null>[] }>(env, q);
  const accounts = value.map(a => ({
    accountId: a["accountid"]!, name: a["name"] ?? "", city: a["address1_city"] ?? null, postalCode: a["address1_postalcode"] ?? null, openOppCount: 0
  }));
  if (accounts.length) {
    const ors = accounts.map(a => `_customerid_value eq ${a.accountId}`).join(" or ");
    const { value: opps } = await dvJson<{ value: Record<string, string>[] }>(
      env, `opportunities?$select=opportunityid,_customerid_value&$filter=statecode eq 0 and (${ors})`
    );
    for (const a of accounts) a.openOppCount = opps.filter(o => o["_customerid_value"] === a.accountId).length;
  }
  if (postalCode) accounts.sort((a, b) => Number(b.postalCode === postalCode) - Number(a.postalCode === postalCode));
  return accounts;
}

export async function getOpenOpportunities(env: CrmEnvironment, accountId: string): Promise<OppSummary[]> {
  const q = `opportunities?$select=name,opportunityid,_iacrm_lineofbusinessid_value,iacrm_desiredeffectivedate` +
    `&$filter=statecode eq 0 and (_customerid_value eq ${accountId} or _parentaccountid_value eq ${accountId})`;
  const { value } = await dvJson<{ value: Record<string, string | null>[] }>(env, q);
  return value.map(o => ({
    opportunityId: o["opportunityid"]!,
    name: o["name"] ?? "",
    lobId: o["_iacrm_lineofbusinessid_value"] ?? null,
    lobName: o["_iacrm_lineofbusinessid_value@OData.Community.Display.V1.FormattedValue"] ?? null,
    desiredEffectiveDate: o["iacrm_desiredeffectivedate"] ?? null
  }));
}

export async function getCarriers(env: CrmEnvironment): Promise<CarrierRow[]> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env, `iacrm_carriers?$select=iacrm_name,iacrm_carrierid&$filter=statecode eq 0&$orderby=iacrm_name`
  );
  return value.map(c => ({ carrierId: c["iacrm_carrierid"]!, name: c["iacrm_name"] ?? "" }));
}

export async function createAccount(env: CrmEnvironment, f: NewAccountFields): Promise<{ accountId: string; name: string }> {
  const body: Record<string, unknown> = { name: f.name };
  if (f.street) body["address1_line1"] = f.street;
  if (f.city) body["address1_city"] = f.city;
  if (f.state) body["address1_stateorprovince"] = f.state;
  if (f.postalCode) body["address1_postalcode"] = f.postalCode;
  if (f.phone) body["telephone1"] = f.phone;
  if (f.email) body["emailaddress1"] = f.email;
  const r = await dvPost<Record<string, string>>(env, "accounts?$select=accountid,name", body);
  return { accountId: r["accountid"]!, name: r["name"] ?? f.name };
}

export async function getLinesOfBusiness(env: CrmEnvironment): Promise<LobRow[]> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env, `iacrm_lineofbusinesses?$select=iacrm_lineofbusinessid,iacrm_lineofbusiness_name&$filter=statecode eq 0&$orderby=iacrm_lineofbusiness_name`
  );
  return value.map(l => ({ lobId: l["iacrm_lineofbusinessid"]!, name: l["iacrm_lineofbusiness_name"] ?? "" }));
}

/** Resolves the pipeline for a LOB (iacrm_DefaultForLob match, else first
 * active) and its ordered stages. Null when the org has no active pipelines. */
export async function getStagesForLob(env: CrmEnvironment, lobId: string | null): Promise<PipelineStages | null> {
  let pipeline: Record<string, string> | undefined;
  if (lobId) {
    const { value } = await dvJson<{ value: Record<string, string>[] }>(
      env, `iacrm_pipelines?$select=iacrm_pipelineid,iacrm_pipeline_name&$filter=statecode eq 0 and _iacrm_defaultforlob_value eq ${lobId}&$top=1`
    );
    pipeline = value[0];
  }
  if (!pipeline) {
    const { value } = await dvJson<{ value: Record<string, string>[] }>(
      env, `iacrm_pipelines?$select=iacrm_pipelineid,iacrm_pipeline_name&$filter=statecode eq 0&$top=1`
    );
    pipeline = value[0];
  }
  if (!pipeline) return null;
  const pipelineId = pipeline["iacrm_pipelineid"]!;
  const { value: stages } = await dvJson<{ value: Record<string, string | number | null>[] }>(
    env, `iacrm_pipelinestages?$select=iacrm_pipelinestageid,iacrm_pipelinestage_name,iacrm_displayorder&$filter=statecode eq 0 and _iacrm_pipelineid_value eq ${pipelineId}&$orderby=iacrm_displayorder asc`
  );
  return {
    pipelineId,
    pipelineName: (pipeline["iacrm_pipeline_name"] as string) ?? "",
    stages: stages.map(s => ({
      stageId: s["iacrm_pipelinestageid"] as string,
      name: (s["iacrm_pipelinestage_name"] as string) ?? "",
      order: (s["iacrm_displayorder"] as number) ?? 0
    }))
  };
}

export async function createOpportunity(
  env: CrmEnvironment, accountId: string, lobId: string, name: string,
  pipelineId?: string | null, stageId?: string | null
): Promise<OppSummary> {
  const body: Record<string, unknown> = {
    name,
    "customerid_account@odata.bind": `/accounts(${accountId})`,
    // nav property is SCHEMA-cased - iacrm_lineofbusinessid (logical case) is
    // rejected with "undeclared property". Verified live against DEV 2026-08-15.
    "iacrm_LineOfBusinessId@odata.bind": `/iacrm_lineofbusinesses(${lobId})`
  };
  // default pipeline + chosen stage so panel-created opps land on the Kanban
  if (pipelineId) body["iacrm_PipelineId@odata.bind"] = `/iacrm_pipelines(${pipelineId})`;
  if (stageId) body["iacrm_PipelineStageId@odata.bind"] = `/iacrm_pipelinestages(${stageId})`;
  const r = await dvPost<Record<string, string | null>>(
    env, "opportunities?$select=opportunityid,name,_iacrm_lineofbusinessid_value,iacrm_desiredeffectivedate", body
  );
  return {
    opportunityId: r["opportunityid"]!,
    name: r["name"] ?? name,
    lobId: r["_iacrm_lineofbusinessid_value"] ?? lobId,
    lobName: null,
    desiredEffectiveDate: r["iacrm_desiredeffectivedate"] ?? null
  };
}

export async function searchUsers(env: CrmEnvironment, query: string): Promise<UserRow[]> {
  const q = `systemusers?$select=systemuserid,fullname&$filter=isdisabled eq false and contains(fullname,'${esc(query)}')&$orderby=fullname&$top=10`;
  const { value } = await dvJson<{ value: Record<string, string>[] }>(env, q);
  return value.map(u => ({ userId: u["systemuserid"]!, fullName: u["fullname"] ?? "" }));
}

export async function getQuotingMethodId(env: CrmEnvironment, nameContains: string): Promise<string | null> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    // primary name is iacrm_quotingmethod_name, NOT iacrm_name (lesson S2-81; verified live against DEV 2026-08-15).
    // iacrm_carrier above genuinely uses iacrm_name - it predates the convention.
    env, `iacrm_quotingmethods?$select=iacrm_quotingmethodid&$filter=contains(iacrm_quotingmethod_name,'${esc(nameContains)}')&$top=1`
  );
  return value[0]?.["iacrm_quotingmethodid"] ?? null;
}

export async function getAccountEnrichmentState(env: CrmEnvironment, accountId: string): Promise<AccountEnrichmentState> {
  const q = `accounts(${accountId})?$select=telephone1,emailaddress1,address1_line1,address1_city,address1_stateorprovince,address1_postalcode,iacrm_mobilephone,iacrm_insuredfirstname,iacrm_insuredlastname,_primarycontactid_value`;
  const r = await dvJson<Record<string, string | null>>(env, q);
  return {
    telephone1: r["telephone1"] ?? null,
    emailaddress1: r["emailaddress1"] ?? null,
    address1_line1: r["address1_line1"] ?? null,
    address1_city: r["address1_city"] ?? null,
    address1_stateorprovince: r["address1_stateorprovince"] ?? null,
    address1_postalcode: r["address1_postalcode"] ?? null,
    iacrm_mobilephone: r["iacrm_mobilephone"] ?? null,
    iacrm_insuredfirstname: r["iacrm_insuredfirstname"] ?? null,
    iacrm_insuredlastname: r["iacrm_insuredlastname"] ?? null,
    primaryContactId: r["_primarycontactid_value"] ?? null
  };
}

export async function updateAccount(env: CrmEnvironment, accountId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await dv(env, `accounts(${accountId})`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dataverse ${res.status} updating account: ${detail.slice(0, 300)}`);
  }
}

export async function getAccountContacts(env: CrmEnvironment, accountId: string): Promise<ContactRow[]> {
  const q = `contacts?$select=contactid,firstname,lastname,emailaddress1,mobilephone,telephone1&$filter=_parentcustomerid_value eq ${accountId} and statecode eq 0`;
  const { value } = await dvJson<{ value: Record<string, string | null>[] }>(env, q);
  return value.map(c => ({
    contactId: c["contactid"]!,
    firstName: c["firstname"] ?? "",
    lastName: c["lastname"] ?? "",
    email: c["emailaddress1"] ?? null,
    mobilePhone: c["mobilephone"] ?? null,
    telephone1: c["telephone1"] ?? null
  }));
}

export async function createContact(env: CrmEnvironment, c: NewContact): Promise<string> {
  const body: Record<string, unknown> = {
    firstname: c.firstName,
    lastname: c.lastName,
    "parentcustomerid_account@odata.bind": `/accounts(${c.accountId})`
  };
  if (c.mobilePhone) body["mobilephone"] = c.mobilePhone;
  if (c.email) body["emailaddress1"] = c.email;
  if (c.birthdate) body["birthdate"] = c.birthdate;
  // field-secured columns - caller includes these only when the org has them
  if (c.dlNumber) body["iacrm_driverslicensenumber"] = c.dlNumber;
  if (c.dlState) body["iacrm_driverslicensestate"] = c.dlState;
  const r = await dvPost<Record<string, string>>(env, "contacts?$select=contactid", body);
  return r["contactid"]!;
}

export async function assignOwner(env: CrmEnvironment, entitySet: string, id: string, ownerId: string): Promise<void> {
  const res = await dv(env, `${entitySet}(${id})`, {
    method: "PATCH",
    body: JSON.stringify({ "ownerid@odata.bind": `/systemusers(${ownerId})` })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dataverse ${res.status} assigning owner on ${entitySet}: ${detail.slice(0, 300)}`);
  }
}

export async function hasServicingTeamMember(env: CrmEnvironment, accountId: string, userId: string): Promise<boolean> {
  const q = `iacrm_servicingteammembers?$select=iacrm_servicingteammemberid&$filter=_iacrm_regardingid_value eq ${accountId} and _iacrm_partyid_value eq ${userId}&$top=1`;
  const { value } = await dvJson<{ value: unknown[] }>(env, q);
  return value.length > 0;
}

const SERVICING_ROLE_PRODUCER = 738590002;
const SERVICING_SCOPE_ACCOUNT = 738590001;

export async function createServicingTeamMember(
  env: CrmEnvironment, m: { accountId: string; userId: string; name: string }
): Promise<void> {
  // polymorphic lookups need their per-target nav property (from DEV metadata):
  // party -> iacrm_partyid_systemuser, regarding -> iacrm_regardingid_Account_account
  await dvPost<Record<string, string>>(env, "iacrm_servicingteammembers?$select=iacrm_servicingteammemberid", {
    iacrm_name: m.name,
    iacrm_role: SERVICING_ROLE_PRODUCER,
    iacrm_scope: SERVICING_SCOPE_ACCOUNT,
    "iacrm_partyid_systemuser@odata.bind": `/systemusers(${m.userId})`,
    "iacrm_regardingid_Account_account@odata.bind": `/accounts(${m.accountId})`
  });
}

export async function createQuotingMethod(env: CrmEnvironment, name: string): Promise<string> {
  const r = await dvPost<Record<string, string>>(env, "iacrm_quotingmethods?$select=iacrm_quotingmethodid", {
    iacrm_quotingmethod_name: name
  });
  return r["iacrm_quotingmethodid"]!;
}

export async function getExistingQuoteStatuses(env: CrmEnvironment, keys: string[]): Promise<Map<string, number>> {
  if (!keys.length) return new Map();
  const ors = keys.map(k => `iacrm_amsexternalid eq '${esc(k)}'`).join(" or ");
  const q = `iacrm_quotes?$select=iacrm_amsexternalid,iacrm_premium_status&$filter=iacrm_provider eq 'EZLynx' and (${ors})`;
  const { value } = await dvJson<{ value: { iacrm_amsexternalid: string; iacrm_premium_status: number | null }[] }>(env, q);
  return new Map(value.filter(v => v.iacrm_premium_status != null).map(v => [v.iacrm_amsexternalid, v.iacrm_premium_status!]));
}

export async function executeBatch(
  env: CrmEnvironment,
  ops: { key: string; method: "PATCH" | "POST" | "DELETE"; url: string; body?: unknown }[]
): Promise<BatchItemResult[]> {
  if (!ops.length) return [];
  const boundary = `batch_${crypto.randomUUID()}`;
  const parts = ops.map(op => {
    const lines = [
      `--${boundary}`,
      "Content-Type: application/http",
      "Content-Transfer-Encoding: binary",
      "",
      `${op.method} ${env.orgUrl}${API}${op.url} HTTP/1.1`
    ];
    if (op.body !== undefined) {
      lines.push("Content-Type: application/json", "", JSON.stringify(op.body));
    } else {
      lines.push("");
    }
    return lines.join("\r\n");
  });
  const body = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;

  const res = await dv(env, "$batch", {
    method: "POST",
    headers: { "Content-Type": `multipart/mixed;boundary=${boundary}`, Prefer: "odata.continue-on-error" },
    body
  });
  if (!res.ok) throw new Error(`$batch failed: ${res.status}`);
  const text = await res.text();

  // chunk per response part so status, error, and OData-EntityId stay aligned
  const chunks = text.split(/--batchresponse[^\r\n-]*/).filter(c => /HTTP\/1\.1 \d{3}/.test(c));
  return ops.map((op, i) => {
    const chunk = chunks[i] ?? "";
    const status = Number(/HTTP\/1\.1 (\d{3})/.exec(chunk)?.[1] ?? 0);
    const entityId = /OData-EntityId:[^(\r\n]*\(([0-9a-fA-F-]{36})\)/.exec(chunk)?.[1] ?? null;
    const failed = status >= 400 || status === 0;
    const error = failed ? (/\{"error":\{[^\n]*/.exec(chunk)?.[0] ?? `HTTP ${status}`) : null;
    return { key: op.key, status, error, entityId };
  });
}

/** Runtime probe: does this org's iacrm_quotecoverage carry the quote lookup
 * yet? Returns the SCHEMA-cased nav property for @odata.bind, or null while the
 * CRM-side columns are undeployed. Cached per org. */
/** Probe: are the field-secured DL columns deployed on contact yet? Cached
 * positive-only per org (they may deploy later). */
export async function contactHasDlColumns(env: CrmEnvironment): Promise<boolean> {
  const cacheKey = `dlCols:${env.orgUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] === true) return true;
  try {
    const { value } = await dvJson<{ value: unknown[] }>(
      env,
      `EntityDefinitions(LogicalName='contact')/Attributes?$select=LogicalName&$filter=LogicalName eq 'iacrm_driverslicensenumber'`
    );
    const has = value.length > 0;
    if (has) await chrome.storage.local.set({ [cacheKey]: true });
    return has;
  } catch {
    return false;
  }
}

export interface KnowledgeNavProps {
  /** riskanswer -> account bind nav property (schema-cased) */
  accountNav: string;
  /** riskanswer -> carrierquestion bind nav property (schema-cased) */
  questionNav: string;
}

/** Probe: are the question-knowledge tables (iacrm_carrierquestion /
 * iacrm_riskanswer) deployed in this org? Returns the schema-cased nav
 * properties needed for riskanswer binds, or null while undeployed.
 * Cached positive-only per org. */
export async function getKnowledgeNavProps(env: CrmEnvironment): Promise<KnowledgeNavProps | null> {
  const cacheKey = `knowNav:${env.orgUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] && typeof cached[cacheKey] === "object") return cached[cacheKey] as KnowledgeNavProps;
  try {
    const { value } = await dvJson<{ value: { ReferencedEntity: string; ReferencingEntityNavigationPropertyName: string }[] }>(
      env,
      `EntityDefinitions(LogicalName='iacrm_riskanswer')/ManyToOneRelationships?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity`
    );
    const accountNav = value.find(r => r.ReferencedEntity === "account")?.ReferencingEntityNavigationPropertyName;
    const questionNav = value.find(r => r.ReferencedEntity === "iacrm_carrierquestion")?.ReferencingEntityNavigationPropertyName;
    if (!accountNav || !questionNav) return null;
    const navs = { accountNav, questionNav };
    await chrome.storage.local.set({ [cacheKey]: navs });
    return navs;
  } catch {
    return null;
  }
}

export async function getCoverageQuoteNavProp(env: CrmEnvironment): Promise<string | null> {
  const cacheKey = `covNav:${env.orgUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (typeof cached[cacheKey] === "string") return cached[cacheKey] as string;
  try {
    const { value } = await dvJson<{ value: { ReferencedEntity: string; ReferencingEntityNavigationPropertyName: string }[] }>(
      env,
      `EntityDefinitions(LogicalName='iacrm_quotecoverage')/ManyToOneRelationships?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity`
    );
    const nav = value.find(r => r.ReferencedEntity === "iacrm_quote")?.ReferencingEntityNavigationPropertyName ?? null;
    if (nav) await chrome.storage.local.set({ [cacheKey]: nav }); // only cache positive - columns may deploy later
    return nav;
  } catch {
    return null;
  }
}

export async function getCoverageRowIds(env: CrmEnvironment, quoteId: string): Promise<string[]> {
  const q = `iacrm_quotecoverages?$select=iacrm_quotecoverageid&$filter=_iacrm_quoteid_value eq ${quoteId}`;
  const { value } = await dvJson<{ value: { iacrm_quotecoverageid: string }[] }>(env, q);
  return value.map(v => v.iacrm_quotecoverageid);
}
