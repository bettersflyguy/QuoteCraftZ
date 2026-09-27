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

export interface NewLeadFields extends NewAccountFields {
  firstName: string | null;
  lastName: string | null;
  /** Fills mobilephone instead of telephone1 when the number is a cell. */
  phoneIsMobile: boolean;
  /** Lead subject, e.g. "Progressive Auto Quote — Dearris Thomas". */
  topic: string;
  /** Intake source name ("Tivly", ...) — resolved-or-created in iacrm_leadsource. */
  leadSource: string | null;
}

/** Find-or-create an iacrm_leadsource row by name (e.g. "Tivly"). */
export async function getLeadSourceId(env: CrmEnvironment, name: string): Promise<string> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env, `iacrm_leadsources?$select=iacrm_leadsourceid&$filter=iacrm_leadsource_name eq '${name.replace(/'/g, "''")}'&$top=1`
  );
  if (value[0]) return value[0]["iacrm_leadsourceid"]!;
  const r = await dvPost<Record<string, string>>(env, "iacrm_leadsources?$select=iacrm_leadsourceid", { iacrm_leadsource_name: name });
  return r["iacrm_leadsourceid"]!;
}

export async function createLead(env: CrmEnvironment, f: NewLeadFields): Promise<{ leadId: string; name: string }> {
  const body: Record<string, unknown> = { subject: f.topic };
  if (f.leadSource) {
    // schema-cased nav prop (metadata-verified: iacrm_LeadSourceId)
    body["iacrm_LeadSourceId@odata.bind"] = `/iacrm_leadsources(${await getLeadSourceId(env, f.leadSource)})`;
  }
  if (f.firstName) body["firstname"] = f.firstName;
  if (f.lastName) body["lastname"] = f.lastName;
  // companyname: the business name for commercial leads only
  if (f.name && f.name !== `${f.firstName ?? ""} ${f.lastName ?? ""}`.trim()) body["companyname"] = f.name;
  if (f.street) body["address1_line1"] = f.street;
  if (f.city) body["address1_city"] = f.city;
  if (f.state) body["address1_stateorprovince"] = f.state;
  if (f.postalCode) body["address1_postalcode"] = f.postalCode;
  if (f.phone) body[f.phoneIsMobile ? "mobilephone" : "telephone1"] = f.phone;
  if (f.email) body["emailaddress1"] = f.email;
  const r = await dvPost<Record<string, string>>(env, "leads?$select=leadid,fullname", body);
  return { leadId: r["leadid"]!, name: r["fullname"] ?? f.topic };
}

export interface NewPolicyFields {
  name: string;
  policyNumber: string;
  premium: number | null;
  /** ISO dates (yyyy-mm-dd) or null. */
  effectiveDate: string | null;
  expirationDate: string | null;
  accountId: string;
  carrierId: string | null;
  lobId: string | null;
  opportunityId: string | null;
}

/** Creates an ACTIVE policy from a carrier sale screen: bound today, tied to
 * the insured and (when known) carrier / LOB / originating opportunity.
 * Schema-cased nav props verified against live metadata. */
export async function createPolicy(env: CrmEnvironment, f: NewPolicyFields): Promise<{ policyId: string }> {
  const body: Record<string, unknown> = {
    iacrm_policy_name: f.name,
    iacrm_policynumber: f.policyNumber,
    iacrm_binddate: new Date().toISOString().slice(0, 10),
    iacrm_status: 738590000, // Active
    "iacrm_InsuredId@odata.bind": `/accounts(${f.accountId})`
  };
  if (f.premium != null) body["iacrm_premium"] = f.premium;
  if (f.effectiveDate) body["iacrm_effectivedate"] = f.effectiveDate;
  if (f.expirationDate) body["iacrm_expirationdate"] = f.expirationDate;
  if (f.carrierId) body["iacrm_CarrierId@odata.bind"] = `/iacrm_carriers(${f.carrierId})`;
  if (f.lobId) body["iacrm_LineOfBusinessId@odata.bind"] = `/iacrm_lineofbusinesses(${f.lobId})`;
  if (f.opportunityId) body["iacrm_OpportunityId@odata.bind"] = `/opportunities(${f.opportunityId})`;
  const r = await dvPost<Record<string, string>>(env, "iacrm_policies?$select=iacrm_policyid", body);
  return { policyId: r["iacrm_policyid"]! };
}

/** One evergreen note per subject per account: found by subject -> PATCH,
 * else POST bound to the account. Returns "created" | "updated". */
export async function upsertAccountNote(env: CrmEnvironment, accountId: string, subject: string, text: string): Promise<"created" | "updated"> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env,
    `annotations?$select=annotationid&$filter=_objectid_value eq ${accountId} and subject eq '${subject.replace(/'/g, "''")}'&$top=1`
  );
  if (value[0]) {
    await dv(env, `annotations(${value[0]["annotationid"]})`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notetext: text })
    });
    return "updated";
  }
  await dvPost(env, "annotations?$select=annotationid", {
    subject,
    notetext: text,
    "objectid_account@odata.bind": `/accounts(${accountId})`
  });
  return "created";
}

export interface ExistingMatch {
  kind: "account" | "lead";
  id: string;
  name: string;
  matchedBy: "email" | "phone" | "name";
  city: string | null;
  postalCode: string | null;
}

export interface MatchQuery {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
}

const oesc = (v: string) => v.replace(/'/g, "''");

/** Duplicate gate before any create: existing Accounts AND open Leads matched
 * by email first, then phone, then name (business name when commercial).
 * Ordered by match strength; each record reports WHY it matched. */
/** Dataverse cannot normalize a phone inside a filter, so the only way to match a number
 * that was stored in a different shape is to ask for every shape it is plausibly in.
 * "8133457954" is one string to us and at least six to the people who typed it. */
export function phoneFilterVariants(phone: string | null): string[] {
  const d = (phone ?? "").replace(/\D/g, "");
  const ten = d.length > 10 && d.startsWith("1") ? d.slice(1) : d;
  const out = new Set<string>();
  if (phone && phone.trim()) out.add(phone.trim());
  if (d.length >= 7) out.add(d);
  if (ten.length === 10) {
    const [a, b, c] = [ten.slice(0, 3), ten.slice(3, 6), ten.slice(6)];
    out.add(ten);
    out.add(`(${a}) ${b}-${c}`);
    out.add(`(${a})${b}-${c}`);
    out.add(`${a}-${b}-${c}`);
    out.add(`${a}.${b}.${c}`);
    out.add(`${a} ${b} ${c}`);
    out.add(`+1${ten}`);
    out.add(`1${ten}`);
  }
  return [...out];
}

/** Account primary names arrive from several places and do not agree on word order:
 * this extension writes "Mathew Downing", an AMS sync commonly writes "Downing, Mathew". */
export function personNameVariants(firstName: string | null, lastName: string | null): string[] {
  const f = (firstName ?? "").trim(), l = (lastName ?? "").trim();
  if (!f || !l) return [f || l].filter(Boolean);
  return [`${f} ${l}`, `${l}, ${f}`, `${l} ${f}`];
}

export async function findInsuredMatches(env: CrmEnvironment, q: MatchQuery): Promise<ExistingMatch[]> {
  const digits = (q.phone ?? "").replace(/\D/g, "");
  const phoneVariants = phoneFilterVariants(q.phone);
  const nameTerms = q.businessName ? [q.businessName] : personNameVariants(q.firstName, q.lastName);

  const accFilters: string[] = [];
  const accMobileFilters: string[] = [];
  const leadFilters: string[] = [];
  if (q.email) {
    accFilters.push(`emailaddress1 eq '${oesc(q.email)}'`);
    leadFilters.push(`emailaddress1 eq '${oesc(q.email)}'`);
  }
  for (const p of phoneVariants) {
    accFilters.push(`telephone1 eq '${oesc(p)}'`);
    // iacrm_mobilephone is a CUSTOM column on a SYSTEM table, so it is exactly the kind of
    // component that can be missing from an environment's solution. Kept separate so a 400
    // over that one column costs us the mobile clause, not the whole account search.
    accMobileFilters.push(`iacrm_mobilephone eq '${oesc(p)}'`);
    leadFilters.push(`telephone1 eq '${oesc(p)}'`, `mobilephone eq '${oesc(p)}'`);
  }
  for (const t of nameTerms) accFilters.push(`contains(name,'${oesc(t)}')`);
  if (!q.businessName && q.firstName && q.lastName) {
    // catches accounts whose display name doesn't carry the person's name at all
    // ("Downing Household"); custom columns, so guarded like iacrm_mobilephone
    accMobileFilters.push(`(iacrm_insuredfirstname eq '${oesc(q.firstName)}' and iacrm_insuredlastname eq '${oesc(q.lastName)}')`);
  }
  if (q.businessName) leadFilters.push(`contains(companyname,'${oesc(q.businessName)}')`);
  if (q.firstName && q.lastName) leadFilters.push(`(firstname eq '${oesc(q.firstName)}' and lastname eq '${oesc(q.lastName)}')`);
  if (!accFilters.length && !accMobileFilters.length && !leadFilters.length) return [];

  const emailNorm = (q.email ?? "").toLowerCase();
  const phoneDigits = digits.length >= 7 ? digits.slice(-10) : "";
  const why = (email: string | null | undefined, phones: (string | null | undefined)[]): ExistingMatch["matchedBy"] => {
    if (emailNorm && (email ?? "").toLowerCase() === emailNorm) return "email";
    if (phoneDigits && phones.some(p => (p ?? "").replace(/\D/g, "").slice(-10) === phoneDigits)) return "phone";
    return "name";
  };

  const accountQuery = (withMobile: boolean) => {
    const filters = withMobile ? [...accFilters, ...accMobileFilters] : accFilters;
    const select = `accountid,name,address1_city,address1_postalcode,emailaddress1,telephone1${withMobile ? ",iacrm_mobilephone" : ""}`;
    return `accounts?$select=${select}&$filter=statecode eq 0 and (${filters.join(" or ")})&$top=10`;
  };

  const out: ExistingMatch[] = [];
  if (accFilters.length || accMobileFilters.length) {
    let value: Record<string, string>[] = [];
    try {
      ({ value } = await dvJson<{ value: Record<string, string>[] }>(env, accountQuery(true)));
    } catch {
      // The mobile column is absent from this environment (or otherwise unusable). Showing the
      // matches we CAN find beats showing none and letting a duplicate through.
      if (!accFilters.length) throw new Error("account match failed and no non-mobile filter remained");
      ({ value } = await dvJson<{ value: Record<string, string>[] }>(env, accountQuery(false)));
    }
    for (const a of value) {
      out.push({
        kind: "account", id: a["accountid"]!, name: a["name"] ?? "",
        matchedBy: why(a["emailaddress1"], [a["telephone1"], a["iacrm_mobilephone"]]),
        city: a["address1_city"] ?? null, postalCode: a["address1_postalcode"] ?? null
      });
    }
  }
  if (leadFilters.length) {
    const { value } = await dvJson<{ value: Record<string, string>[] }>(
      env,
      `leads?$select=leadid,fullname,companyname,address1_city,address1_postalcode,emailaddress1,telephone1,mobilephone&$filter=statecode eq 0 and (${leadFilters.join(" or ")})&$top=10`
    );
    for (const l of value) {
      out.push({
        kind: "lead", id: l["leadid"]!,
        name: [l["fullname"], l["companyname"]].filter(Boolean).join(" — "),
        matchedBy: why(l["emailaddress1"], [l["telephone1"], l["mobilephone"]]),
        city: l["address1_city"] ?? null, postalCode: l["address1_postalcode"] ?? null
      });
    }
  }
  const rank = { email: 0, phone: 1, name: 2 } as const;
  return out.sort((a, b) => rank[a.matchedBy] - rank[b.matchedBy]);
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
  // license columns are org-specific - write to whatever the probe found
  if (c.dlNumber || c.dlState) {
    const cols = await getContactDlColumns(env);
    if (cols) {
      if (c.dlNumber) body[cols.numberCol] = c.dlNumber;
      if (c.dlState && cols.stateCol) body[cols.stateCol] = c.dlState;
      // no state column in this org: state is dropped, number still lands
    }
  }
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
export interface DlColumns { numberCol: string; stateCol: string | null }

/** Probe: which driver's-license columns does this org's contact carry?
 * Nathan's hand-built schema uses iacrm_driverslicense (no state column);
 * the originally-specced names are also accepted. Candidates in preference
 * order; cached positive-only per org (columns may deploy later). */
export async function getContactDlColumns(env: CrmEnvironment): Promise<DlColumns | null> {
  const cacheKey = `dlColsMap:${env.orgUrl}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] && typeof cached[cacheKey] === "object") return cached[cacheKey] as DlColumns;
  try {
    const { value } = await dvJson<{ value: { LogicalName: string }[] }>(
      env, `EntityDefinitions(LogicalName='contact')/Attributes?$select=LogicalName`
    );
    const names = new Set(value.map(a => a.LogicalName));
    const numberCol = ["iacrm_driverslicensenumber", "iacrm_driverslicense"].find(n => names.has(n)) ?? null;
    if (!numberCol) return null;
    const stateCol = names.has("iacrm_driverslicensestate") ? "iacrm_driverslicensestate" : null;
    const cols = { numberCol, stateCol };
    await chrome.storage.local.set({ [cacheKey]: cols });
    return cols;
  } catch {
    return null;
  }
}

export async function contactHasDlColumns(env: CrmEnvironment): Promise<boolean> {
  return (await getContactDlColumns(env)) !== null;
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
