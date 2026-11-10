import { getAccessToken } from "./auth";
import type { CrmEnvironment } from "./environments";
import type { AccountEnrichmentState, ContactRow, NewContact } from "./enrich";

export class CrmAccessError extends Error {
  orgUrl: string;
  status: number;
  upn: string | null;
  constructor(orgUrl: string, status: number, upn: string | null = null) {
    super(`No access to ${orgUrl} (HTTP ${status})`);
    this.name = "CrmAccessError";
    this.orgUrl = orgUrl;
    this.status = status;
    this.upn = upn;
  }
}

/** Account the token was issued to, read off the JWT payload - lets the panel
 * say WHICH account Dataverse rejected (wrong-account-picked vs missing role). */
export function upnFromToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return (json.preferred_username ?? json.upn ?? json.unique_name ?? null) as string | null;
  } catch { return null; }
}

export interface AccountMatch { accountId: string; name: string; city: string | null; postalCode: string | null; openOppCount: number }
export interface OppSummary { opportunityId: string; name: string; lobId: string | null; lobName: string | null; desiredEffectiveDate: string | null }
export interface CarrierRow { carrierId: string; name: string }
export interface UserRow { userId: string; fullName: string; email?: string | null }
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
  if (res.status === 401 || res.status === 403) throw new CrmAccessError(env.orgUrl, res.status, upnFromToken(token));
  return res;
}

export async function dvJson<T>(env: CrmEnvironment, path: string): Promise<T> {
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

/** The quote's own source key column ("ezlynx:123:req", "<host>:<opp>"):
 * what tells a reload "this quote is already in CRM". iacrm_amsexternalid
 * belongs to the AMS sync and is NEVER written here; it is only READ, to
 * recognize quotes that earlier versions stamped with it. Contract with the
 * CRM session: docs/crm-handoff-quote-source-key.md. */
export const QUOTE_KEY_COLUMN = "iacrm_sourcequotekey";

export type QuoteProvider = "EZLynx" | "Portal";

/** One quote a load wants to write: its source key, plus the opportunity
 * and name used to find it while the source key column isn't deployed. */
export interface QuoteLookup { key: string; opportunityId: string; name: string }

export interface ExistingQuote { id: string; premiumStatus: number | null }

export interface QuoteMatches {
  byKey: Map<string, ExistingQuote>;
  /** false until the CRM deploys QUOTE_KEY_COLUMN */
  keyColumn: boolean;
}

type QuoteRow = {
  iacrm_quoteid: string; iacrm_quote_name?: string | null; iacrm_amsexternalid?: string | null;
  iacrm_sourcequotekey?: string | null; iacrm_premium_status?: number | null; _iacrm_opportunityid_value?: string | null;
};

/** Finds the CRM quotes a load's quotes already are, by (in order) the
 * source key column, the legacy key earlier versions stamped in
 * iacrm_amsexternalid, then the same name on the same opportunity. Reads
 * only. Missing source key column = keyColumn false (one retry without it). */
export async function findExistingQuotes(env: CrmEnvironment, provider: QuoteProvider, items: QuoteLookup[]): Promise<QuoteMatches> {
  const byKey = new Map<string, ExistingQuote>();
  if (!items.length) return { byKey, keyColumn: true };
  const run = async (keyColumn: boolean): Promise<QuoteRow[]> => {
    const rows: QuoteRow[] = [];
    // a few quotes per request keeps the URL well under Dataverse's limit
    for (let i = 0; i < items.length; i += 8) {
      const chunk = items.slice(i, i + 8);
      const ors = chunk.flatMap(it => [
        ...(keyColumn ? [`${QUOTE_KEY_COLUMN} eq '${esc(it.key)}'`] : []),
        `iacrm_amsexternalid eq '${esc(it.key)}'`,
        `(_iacrm_opportunityid_value eq ${it.opportunityId} and iacrm_quote_name eq '${esc(it.name)}')`
      ]).join(" or ");
      const select = `iacrm_quoteid,iacrm_quote_name,iacrm_amsexternalid,iacrm_premium_status,_iacrm_opportunityid_value${keyColumn ? `,${QUOTE_KEY_COLUMN}` : ""}`;
      const path = `iacrm_quotes?$select=${select}&$filter=iacrm_provider eq '${provider}' and (${ors})`;
      const res = await dv(env, path);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (keyColumn && res.status === 400 && detail.includes(QUOTE_KEY_COLUMN)) throw new MissingKeyColumn();
        throw new Error(`Dataverse ${res.status} looking up quotes: ${detail.slice(0, 300)}`);
      }
      rows.push(...((await res.json()) as { value: QuoteRow[] }).value);
    }
    return rows;
  };
  let keyColumn = true;
  let rows: QuoteRow[];
  try { rows = await run(true); }
  catch (e) {
    if (!(e instanceof MissingKeyColumn)) throw e;
    keyColumn = false;
    rows = await run(false);
  }
  for (const it of items) {
    const hit = rows.find(r => keyColumn && r.iacrm_sourcequotekey === it.key)
      ?? rows.find(r => r.iacrm_amsexternalid === it.key)
      ?? rows.find(r => r._iacrm_opportunityid_value?.toLowerCase() === it.opportunityId.toLowerCase() && r.iacrm_quote_name === it.name);
    if (hit) byKey.set(it.key, { id: hit.iacrm_quoteid, premiumStatus: hit.iacrm_premium_status ?? null });
  }
  return { byKey, keyColumn };
}

class MissingKeyColumn extends Error {}

/** Update the quote already in CRM by its id, else create it; the source
 * key rides on the body once the column exists. Never iacrm_amsexternalid. */
export function quoteWrite(key: string, matches: QuoteMatches, body: Record<string, unknown>): { method: "PATCH" | "POST"; url: string; body: Record<string, unknown> } {
  const { iacrm_amsexternalid: _ams, ...clean } = body;
  const out = matches.keyColumn ? { ...clean, [QUOTE_KEY_COLUMN]: key } : clean;
  const hit = matches.byKey.get(key);
  return hit ? { method: "PATCH", url: `iacrm_quotes(${hit.id})`, body: out } : { method: "POST", url: "iacrm_quotes", body: out };
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
  /** Lead subject, e.g. "Progressive Auto Quote - Dearris Thomas". */
  topic: string;
  /** Intake source name ("Tivly", ...) - resolved-or-created in iacrm_leadsource. */
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
  /** Captured CRM-column values (raw text) taught for this policy row -
   * coerced against the live catalog worker-side; explicit fields win. */
  extra?: Record<string, string>;
}

/** Creates an ACTIVE policy from a carrier sale screen: bound today, tied to
 * the insured and (when known) carrier / LOB / originating opportunity.
 * Schema-cased nav props verified against live metadata. */
export async function createPolicy(env: CrmEnvironment, f: NewPolicyFields, extra: Record<string, unknown> = {}): Promise<{ policyId: string }> {
  const body: Record<string, unknown> = {
    ...extra,
    iacrm_policy_name: f.name,
    iacrm_policynumber: f.policyNumber,
    // a taught status/bind date (an AMS policies list: Renewed, Cancelled…)
    // is the truth for that row; sale screens default to bound-today Active
    iacrm_binddate: extra["iacrm_binddate"] ?? new Date().toISOString().slice(0, 10),
    iacrm_status: extra["iacrm_status"] ?? 738590000, // Active
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

export interface NewQuoteFields {
  accountId: string;
  opportunityId: string;
  carrierId: string | null;
  lobId: string | null;
  name: string;
  premium: number | null;
  coverageSummary: string;
  /** ISO date or null. */
  effectiveDate: string | null;
  /** The portal page the quote came from (iacrm_quotelink + alt-key host). */
  sourceUrl: string;
  quotingMethodId: string | null;
  /** Captured CRM-column values (raw text) - coerced worker-side; explicit fields win. */
  extra?: Record<string, string>;
  /** The agent's choice; Firm is written, Estimated never downgrades a Firm
   * already on the quote (the caller passes keepFirm when it is). */
  premiumStatus?: "estimated" | "firm";
  keepFirm?: boolean;
}

/** Upserts a portal-captured quote onto the opportunity - provider "Portal",
 * alt-keyed per host+opportunity so a re-capture updates instead of
 * duplicating. Same column conventions as the EZLynx writer; premium status
 * is always Estimated (standing rule), source type left unset (carrier
 * direct, not comparative rater). */
/** A carrier portal quote on its opportunity: updates the one already in
 * CRM (found by findExistingQuotes) or creates it. Source key
 * "<host>:<opportunity>": one quote per site per opportunity. */
export async function createQuote(env: CrmEnvironment, f: NewQuoteFields, extra: Record<string, unknown> = {}): Promise<{ quoteId: string }> {
  const key = portalQuoteKey(f.sourceUrl, f.opportunityId);
  const matches = await findExistingQuotes(env, "Portal", [{ key, opportunityId: f.opportunityId, name: f.name }]);
  const existing = matches.byKey.get(key);
  const keepFirm = f.keepFirm || existing?.premiumStatus === 738590002;
  const body: Record<string, unknown> = {
    ...extra,
    iacrm_quote_name: f.name,
    iacrm_provider: "Portal",
    iacrm_status: 738590002,          // Quote Received
    // Firm 738590002 / Estimated 738590000; an existing Firm is never downgraded
    ...(f.premiumStatus === "firm" ? { iacrm_premium_status: 738590002 } : keepFirm ? {} : { iacrm_premium_status: 738590000 }),
    iacrm_coveragelimitsummary: f.coverageSummary.slice(0, 4000),
    iacrm_quotelink: f.sourceUrl.slice(0, 500),
    "iacrm_AccountId@odata.bind": `/accounts(${f.accountId})`,
    "iacrm_OpportunityId@odata.bind": `/opportunities(${f.opportunityId})`
  };
  if (f.premium != null) body["iacrm_premium"] = f.premium;
  if (f.effectiveDate) body["iacrm_effectivedate"] = f.effectiveDate;
  if (f.carrierId) body["iacrm_CarrierId@odata.bind"] = `/iacrm_carriers(${f.carrierId})`;
  if (f.lobId) body["iacrm_LineOfBusinessId@odata.bind"] = `/iacrm_lineofbusinesses(${f.lobId})`;
  if (f.quotingMethodId) body["iacrm_QuotingMethodId@odata.bind"] = `/iacrm_quotingmethods(${f.quotingMethodId})`;
  const op = quoteWrite(key, matches, body);
  const r = await dv(env, `${op.url}?$select=iacrm_quoteid`, {
    method: op.method,
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(op.body)
  });
  if (!r.ok) throw new Error(`quote ${op.method === "POST" ? "create" : "update"} failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const rec = (await r.json()) as Record<string, string>;
  return { quoteId: rec["iacrm_quoteid"] ?? existing!.id };
}

/** A portal quote's source key: one quote per site per opportunity. */
export function portalQuoteKey(sourceUrl: string, opportunityId: string): string {
  return `${new URL(sourceUrl).hostname}:${opportunityId}`;
}

export interface InsuredSearchRow {
  kind: "account" | "contact";
  id: string;
  name: string;
  city: string | null;
  postalCode: string | null;
}

/** Free-text CRM search over accounts and contacts, for picking the insured
 * whose data should fill a carrier quote sheet. */
export async function searchInsureds(env: CrmEnvironment, query: string): Promise<InsuredSearchRow[]> {
  const q = query.replace(/'/g, "''");
  const out: InsuredSearchRow[] = [];
  const acc = await dvJson<{ value: Record<string, string>[] }>(
    env, `accounts?$select=accountid,name,address1_city,address1_postalcode&$filter=statecode eq 0 and contains(name,'${q}')&$orderby=name&$top=8`
  );
  for (const a of acc.value) out.push({ kind: "account", id: a["accountid"]!, name: a["name"] ?? "", city: a["address1_city"] ?? null, postalCode: a["address1_postalcode"] ?? null });
  const con = await dvJson<{ value: Record<string, string>[] }>(
    env, `contacts?$select=contactid,fullname,address1_city,address1_postalcode&$filter=statecode eq 0 and contains(fullname,'${q}')&$orderby=fullname&$top=8`
  );
  for (const c of con.value) out.push({ kind: "contact", id: c["contactid"]!, name: c["fullname"] ?? "", city: c["address1_city"] ?? null, postalCode: c["address1_postalcode"] ?? null });
  return out;
}

const ACCOUNT_SOURCE_SELECT = "accountid,name,address1_line1,address1_line2,address1_city,address1_stateorprovince,address1_postalcode,telephone1,emailaddress1,iacrm_insuredtype,iacrm_insuredfirstname,iacrm_insuredlastname,_primarycontactid_value";
const CONTACT_SOURCE_SELECT = "contactid,firstname,lastname,fullname,birthdate,gendercode,familystatuscode,mobilephone,telephone1,emailaddress1,address1_line1,address1_line2,address1_city,address1_stateorprovince,address1_postalcode,_parentcustomerid_value";

/** The raw records behind an insured pick: the account (with iacrm_mobilephone
 * when the column exists), its primary contact, and logged risk answers when
 * the knowledge tables exist. Best-effort on every custom piece. */
export async function getInsuredSourceRecords(
  env: CrmEnvironment, kind: "account" | "contact", id: string
): Promise<import("./crmSource").CrmSourceRecords> {
  let account: Record<string, unknown> | null = null;
  let contact: Record<string, unknown> | null = null;

  if (kind === "account") {
    try {
      account = await dvJson<Record<string, unknown>>(env, `accounts(${id})?$select=${ACCOUNT_SOURCE_SELECT},iacrm_mobilephone`);
    } catch {
      account = await dvJson<Record<string, unknown>>(env, `accounts(${id})?$select=${ACCOUNT_SOURCE_SELECT}`);
    }
    const primaryId = account?.["_primarycontactid_value"];
    if (typeof primaryId === "string" && primaryId) {
      try { contact = await dvJson<Record<string, unknown>>(env, `contacts(${primaryId})?$select=${CONTACT_SOURCE_SELECT}`); } catch { /* keep account-only */ }
    }
  } else {
    contact = await dvJson<Record<string, unknown>>(env, `contacts(${id})?$select=${CONTACT_SOURCE_SELECT}`);
    const parentId = contact?.["_parentcustomerid_value"];
    if (typeof parentId === "string" && parentId) {
      try {
        account = await dvJson<Record<string, unknown>>(env, `accounts(${parentId})?$select=${ACCOUNT_SOURCE_SELECT},iacrm_mobilephone`);
      } catch { /* contact-only */ }
    }
  }

  const riskAnswers: { label: string; value: string }[] = [];
  const accountId = (account?.["accountid"] as string | undefined) ?? (kind === "account" ? id : undefined);
  if (accountId) {
    try {
      const { value } = await dvJson<{ value: Record<string, string>[] }>(
        env, `iacrm_riskanswers?$select=iacrm_riskanswer_name,iacrm_value&$filter=_iacrm_accountid_value eq ${accountId} and statecode eq 0&$top=200`
      );
      for (const r of value) riskAnswers.push({ label: r["iacrm_riskanswer_name"] ?? "", value: r["iacrm_value"] ?? "" });
    } catch { /* knowledge tables absent in this org */ }
  }

  // every contact on the account, so the agent has household/stakeholder
  // context in the panel (display-only - the mapper never fills from these)
  let relatedContacts: Record<string, unknown>[] = [];
  if (accountId) {
    try {
      const { value } = await dvJson<{ value: Record<string, unknown>[] }>(
        env, `contacts?$select=contactid,fullname,emailaddress1,telephone1,mobilephone,birthdate,jobtitle&$filter=_parentcustomerid_value eq ${accountId} and statecode eq 0&$orderby=fullname&$top=25`
      );
      relatedContacts = value;
    } catch { /* non-fatal: panel just shows no contact list */ }
  }

  // the FULL records (every column, display values annotated) so a page
  // mapping to any CRM column can fill; related contacts in the one shared
  // slot order. Secured columns come back empty here unless permitted, and
  // are dropped by the capture builder regardless.
  const full: NonNullable<import("./crmSource").CrmSourceRecords["full"]> = { account: null, primary: null, related: [] };
  try {
    if (accountId) full.account = await dvJson<Record<string, unknown>>(env, `accounts(${accountId})`);
    const primaryId = (full.account?.["_primarycontactid_value"] as string | undefined) ?? (contact?.["contactid"] as string | undefined);
    if (primaryId) full.primary = await dvJson<Record<string, unknown>>(env, `contacts(${primaryId})`);
    if (accountId) {
      const { value } = await dvJson<{ value: Record<string, unknown>[] }>(env,
        `contacts?$filter=_parentcustomerid_value eq ${accountId} and statecode eq 0&$orderby=createdon asc&$top=12`);
      full.related = value.filter(c => c["contactid"] !== primaryId).slice(0, 10);
    }
  } catch { /* the basic fields above still fill */ }
  // the insured person's addresses live on their contact (EZLynx: the
  // applicant has many, each other contact one)
  const addressOwner = (full.primary?.["contactid"] as string | undefined) ?? null;
  if (addressOwner) {
    try { full.addresses = await getRecordAddresses(env, addressOwner); } catch { /* addresses are optional context */ }
  }

  return { account, contact, riskAnswers, relatedContacts, full };
}

/** Timeline-capable records a note can attach to: logical name + entity set
 * (the annotation's objectid_<logical> binding). */
export const NOTE_RECORDS = {
  account: { logical: "account", set: "accounts" },
  contact: { logical: "contact", set: "contacts" },
  opportunity: { logical: "opportunity", set: "opportunities" },
  quote: { logical: "iacrm_quote", set: "iacrm_quotes" },
  policy: { logical: "iacrm_policy", set: "iacrm_policies" }
} as const;

/** What a note write did: a new dated note, today's note updated, or
 * nothing because the captured data hasn't changed. */
export type NoteOutcome = "created" | "updated" | "unchanged";

export async function upsertAccountNote(
  env: CrmEnvironment, accountId: string, subject: string, text: string,
  legacyMatch?: { prefix: string; suffix: string }
): Promise<NoteOutcome> {
  return upsertRecordNote(env, "account", accountId, subject, text, legacyMatch);
}

/** "MM-DD-YYYY" for a moment, local time. */
function localDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}

/** A note body without its "Captured <when> from <where>" line, so two
 * loads of the same data compare equal. */
export function noteContent(text: string): string {
  return String(text ?? "").replace(/<p><b>Captured [^<]*<\/b><\/p>/g, "").replace(/^Captured .*$/m, "").trim();
}

/** Notes are HISTORY, never silently rewritten (agent's rule): per record
 * and subject, the latest note is left alone when the data is unchanged,
 * updated when it was written TODAY (corrections during the same intake),
 * and otherwise a NEW note dated today is added - what was captured a year
 * ago stays as it was. Subjects carry the date ("... (EZLynx) 11-08-2026"). */
export async function upsertRecordNote(
  env: CrmEnvironment, record: keyof typeof NOTE_RECORDS, id: string, subject: string, text: string,
  legacyMatch?: { prefix: string; suffix: string }, now: Date = new Date()
): Promise<NoteOutcome> {
  const target = NOTE_RECORDS[record];
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // the base subject finds undated notes from earlier versions and every dated one
  const subjects = `startswith(subject,${q(subject)})` + (legacyMatch
    ? ` or (startswith(subject,${q(legacyMatch.prefix)}) and endswith(subject,${q(legacyMatch.suffix)}))`
    : "");
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env,
    `annotations?$select=annotationid,notetext,createdon&$filter=_objectid_value eq ${id} and (${subjects})&$orderby=createdon desc&$top=1`
  );
  const dated = `${subject} ${localDate(now)}`;
  const latest = value[0];
  if (latest) {
    if (noteContent(latest["notetext"] ?? "") === noteContent(text)) return "unchanged";
    const created = latest["createdon"] ? new Date(latest["createdon"]) : null;
    if (created && !Number.isNaN(created.getTime()) && localDate(created) === localDate(now)) {
      const res = await dv(env, `annotations(${latest["annotationid"]})`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: dated, notetext: text })
      });
      if (!res.ok) throw new Error(`Dataverse ${res.status} updating note: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return "updated";
    }
  }
  await dvPost(env, "annotations?$select=annotationid", {
    subject: dated,
    notetext: text,
    [`objectid_${target.logical}@odata.bind`]: `/${target.set}(${id})`
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
        name: [l["fullname"], l["companyname"]].filter(Boolean).join(", "),
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

/** Resolves the pipeline for a LOB (iacrm_DefaultForLob match, else a
 * name-matched active pipeline - "Commercial …" for commercial LOBs/insureds,
 * "… Personal …" for personal - else first active) and its ordered stages.
 * Null when the org has no active pipelines. No org currently sets
 * DefaultForLob, so the name match is the path that actually runs. */
export async function getStagesForLob(
  env: CrmEnvironment, lobId: string | null,
  hint?: { insuredType?: 1 | 2 | null; lobName?: string | null }
): Promise<PipelineStages | null> {
  let pipeline: Record<string, string> | undefined;
  if (lobId) {
    const { value } = await dvJson<{ value: Record<string, string>[] }>(
      env, `iacrm_pipelines?$select=iacrm_pipelineid,iacrm_pipeline_name&$filter=statecode eq 0 and _iacrm_defaultforlob_value eq ${lobId}&$top=1`
    );
    pipeline = value[0];
  }
  if (!pipeline) {
    const { value } = await dvJson<{ value: Record<string, string>[] }>(
      env, `iacrm_pipelines?$select=iacrm_pipelineid,iacrm_pipeline_name&$filter=statecode eq 0&$orderby=iacrm_pipeline_name&$top=50`
    );
    const lobName = (hint?.lobName ?? "").toLowerCase();
    const wanted =
      lobName.includes("commercial") ? "commercial"
      : lobName.includes("personal") ? "personal"
      : hint?.insuredType === 2 ? "commercial"
      : hint?.insuredType === 1 ? "personal"
      : null;
    if (wanted) pipeline = value.find(p => (p["iacrm_pipeline_name"] ?? "").toLowerCase().includes(wanted));
    pipeline ??= value[0];
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
  pipelineId?: string | null, stageId?: string | null, leadSource?: string | null,
  extra: Record<string, unknown> = {}
): Promise<OppSummary> {
  const body: Record<string, unknown> = {
    ...extra,
    name,
    "customerid_account@odata.bind": `/accounts(${accountId})`,
    // nav property is SCHEMA-cased - iacrm_lineofbusinessid (logical case) is
    // rejected with "undeclared property". Verified live against DEV 2026-08-15.
    "iacrm_LineOfBusinessId@odata.bind": `/iacrm_lineofbusinesses(${lobId})`
  };
  // default pipeline + chosen stage so panel-created opps land on the Kanban
  if (pipelineId) body["iacrm_PipelineId@odata.bind"] = `/iacrm_pipelines(${pipelineId})`;
  if (stageId) body["iacrm_PipelineStageId@odata.bind"] = `/iacrm_pipelinestages(${stageId})`;
  // intake attribution (Tivly etc.) - account-path loads otherwise lose it
  if (leadSource) body["iacrm_LeadSourceId@odata.bind"] = `/iacrm_leadsources(${await getLeadSourceId(env, leadSource)})`;
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
  // domainname (the sign-in UPN) disambiguates same-named rows: real agent vs
  // service/external account is invisible from fullname alone
  const q = `systemusers?$select=systemuserid,fullname,domainname,internalemailaddress&$filter=isdisabled eq false and contains(fullname,'${esc(query)}')&$orderby=fullname&$top=10`;
  const { value } = await dvJson<{ value: Record<string, string>[] }>(env, q);
  return value.map(u => ({
    userId: u["systemuserid"]!,
    fullName: u["fullname"] ?? "",
    email: u["domainname"] || u["internalemailaddress"] || null
  }));
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

/** One prior (incumbent) policy onto the insured's Prior Coverage: the same
 * line, carrier and expiration is that record (filled where empty, missing
 * links set); a later term or another carrier is a new record, so history
 * is kept. Returns what happened. */
export async function upsertPriorCoverage(
  env: CrmEnvironment,
  p: { accountId: string; opportunityId: string | null; lobId: string | null; carrierId: string | null; values: Record<string, unknown> }
): Promise<{ outcome: "created" | "filled" | "unchanged"; id: string }> {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const filters = [`_iacrm_accountid_value eq ${p.accountId}`, "statecode eq 0"];
  if (p.lobId) filters.push(`_iacrm_lineofbusinessid_value eq ${p.lobId}`);
  else if (typeof p.values["iacrm_name"] === "string") filters.push(`iacrm_name eq ${q(p.values["iacrm_name"] as string)}`);
  const carrier = p.values["iacrm_priorcarriername"];
  filters.push(typeof carrier === "string" ? `iacrm_priorcarriername eq ${q(carrier)}` : "iacrm_priorcarriername eq null");
  const exp = p.values["iacrm_expirationdate"];
  filters.push(typeof exp === "string" ? `iacrm_expirationdate eq ${exp}` : "iacrm_expirationdate eq null");
  const { value } = await dvJson<{ value: Record<string, string | null>[] }>(env,
    `iacrm_priorcoverages?$select=iacrm_priorcoverageid,_iacrm_opportunityid_value,_iacrm_lineofbusinessid_value,_iacrm_carrierid_value&$filter=${encodeURIComponent(filters.join(" and "))}&$top=1`);
  const binds = (have: Record<string, string | null> | null): Record<string, string> => {
    const out: Record<string, string> = {};
    if (p.opportunityId && !have?.["_iacrm_opportunityid_value"]) out["iacrm_OpportunityId@odata.bind"] = `/opportunities(${p.opportunityId})`;
    if (p.lobId && !have?.["_iacrm_lineofbusinessid_value"]) out["iacrm_LineOfBusinessId@odata.bind"] = `/iacrm_lineofbusinesses(${p.lobId})`;
    if (p.carrierId && !have?.["_iacrm_carrierid_value"]) out["iacrm_CarrierId@odata.bind"] = `/iacrm_carriers(${p.carrierId})`;
    return out;
  };
  const existing = value[0];
  if (existing) {
    const id = existing["iacrm_priorcoverageid"]!;
    const written = await fillIfEmpty(env, "iacrm_priorcoverages", id, p.values);
    const links = binds(existing);
    if (Object.keys(links).length) {
      const res = await dv(env, `iacrm_priorcoverages(${id})`, { method: "PATCH", body: JSON.stringify(links) });
      if (!res.ok) throw new Error(`Dataverse ${res.status} linking prior coverage: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    }
    return { outcome: written.length || Object.keys(links).length ? "filled" : "unchanged", id };
  }
  const created = await dvPost<{ iacrm_priorcoverageid: string }>(env, "iacrm_priorcoverages?$select=iacrm_priorcoverageid", {
    ...p.values, ...binds(null), "iacrm_AccountId@odata.bind": `/accounts(${p.accountId})`
  });
  return { outcome: "created", id: created.iacrm_priorcoverageid };
}

/** A record's addresses with any data, by address number (1-3 on a contact
 * and 1-2 on an account are its own Address 1/2/3 columns, kept in sync by
 * Dataverse; higher numbers are its More Addresses). */
export async function getRecordAddresses(env: CrmEnvironment, parentId: string): Promise<Record<string, unknown>[]> {
  const { value } = await dvJson<{ value: Record<string, unknown>[] }>(env,
    `customeraddresses?$filter=_parentid_value eq ${parentId}&$orderby=addressnumber asc&$top=40`);
  return value.filter(a => ["line1", "city", "postalcode", "stateorprovince"].some(c => typeof a[c] === "string" && a[c]));
}

/** One captured address row onto a person (or account): address number N
 * on that record. An existing row is filled where empty (agent-entered CRM
 * data wins); a missing one is created. Returns what happened. */
export async function upsertRecordAddress(
  env: CrmEnvironment, parent: "contact" | "account", parentId: string, addressNumber: number, values: Record<string, unknown>
): Promise<{ outcome: "created" | "filled" | "unchanged"; columns: string[] }> {
  const accountId = parentId;
  const cols = Object.keys(values).filter(c => /^[a-z][a-z0-9_]*$/.test(c));
  if (!cols.length || !Number.isInteger(addressNumber) || addressNumber < 1) return { outcome: "unchanged", columns: [] };
  const { value } = await dvJson<{ value: { customeraddressid: string }[] }>(env,
    `customeraddresses?$select=customeraddressid&$filter=_parentid_value eq ${accountId} and addressnumber eq ${addressNumber}&$top=1`);
  const id = value[0]?.customeraddressid;
  if (id) {
    const written = await fillIfEmpty(env, "customeraddresses", id, values);
    return { outcome: written.length ? "filled" : "unchanged", columns: written };
  }
  const body: Record<string, unknown> = {};
  for (const c of cols) body[c] = values[c];
  body["addressnumber"] = addressNumber;
  body[`parentid_${parent}@odata.bind`] = `/${parent === "contact" ? "contacts" : "accounts"}(${accountId})`;
  await dvPost(env, "customeraddresses?$select=customeraddressid", body);
  return { outcome: "created", columns: cols };
}

/** Writes captured column values onto an existing record ONLY where the
 * column is empty - agent-entered CRM data always wins over captured data.
 * Returns the columns written. */
export async function fillIfEmpty(env: CrmEnvironment, entitySet: string, id: string, values: Record<string, unknown>): Promise<string[]> {
  const cols = Object.keys(values).filter(c => /^[a-z][a-z0-9_]*$/.test(c));
  if (!cols.length) return [];
  const current = await dvJson<Record<string, unknown>>(env, `${entitySet}(${id})?$select=${cols.join(",")}`);
  const patch: Record<string, unknown> = {};
  for (const c of cols) {
    const v = current[c];
    if (v === null || v === undefined || v === "") patch[c] = values[c];
  }
  if (!Object.keys(patch).length) return [];
  const res = await dv(env, `${entitySet}(${id})`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Dataverse ${res.status} updating ${entitySet}: ${detail.slice(0, 300)}`);
  }
  return Object.keys(patch);
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
    ...(c.extra ?? {}),
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
  /** riskanswer -> insured item bind nav property (schema-cased), when
   * the optional iacrm_insureditemid lookup exists */
  insuredItemNav?: string;
}

/** Probe: are the question-knowledge tables (iacrm_carrierquestion /
 * iacrm_riskanswer) deployed in this org? Returns the schema-cased nav
 * properties needed for riskanswer binds, or null while undeployed.
 * Cached positive-only per org. */
export async function getKnowledgeNavProps(env: CrmEnvironment): Promise<KnowledgeNavProps | null> {
  // v2: also carries the optional insured item link
  const cacheKey = `knowNav2:${env.orgUrl}`;
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
    const insuredItemNav = value.find(r => r.ReferencedEntity === "iacrm_insureditem")?.ReferencingEntityNavigationPropertyName;
    const navs: KnowledgeNavProps = { accountNav, questionNav, ...(insuredItemNav ? { insuredItemNav } : {}) };
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

/** A display name for an asset record that has none mapped: "2019 Honda
 * Civic", the property's street, the item's maker and model... */
export function assetName(values: Record<string, unknown>, fallback: string): string {
  const v = (k: string) => (typeof values[k] === "string" || typeof values[k] === "number" ? String(values[k]).trim() : "");
  const parts = [v("iacrm_year"), v("iacrm_make"), v("iacrm_model")].filter(Boolean).join(" ") ||
    v("iacrm_addressline1") || [v("iacrm_brandormaker"), v("iacrm_modelorstyle")].filter(Boolean).join(" ") ||
    v("iacrm_description") || v("iacrm_vin") || v("iacrm_hullid") || v("iacrm_serialnumber");
  return (parts || fallback).slice(0, 200);
}

/** One of the insured's assets (vehicle, watercraft, property, equipment,
 * scheduled item): the same asset (by VIN / hull ID / street / serial, else
 * name) on that insured is filled where empty, never duplicated; otherwise
 * a new record on the insured. */
export async function upsertAsset(
  env: CrmEnvironment,
  table: { set: string; logical: string; match: string; singular: string },
  accountId: string,
  values: Record<string, unknown>
): Promise<{ outcome: "created" | "filled" | "unchanged"; id: string }> {
  return upsertOwnedRecord(env, table, { column: "iacrm_accountid", id: accountId }, {
    "iacrm_accountid@odata.bind": `/accounts(${accountId})`
  }, values, table.singular);
}

/** A record hanging off an asset (additional interest, renovation, loss,
 * party): the same named record under that parent is filled where empty,
 * otherwise created under it. */
export async function upsertChildRecord(
  env: CrmEnvironment,
  table: { set: string; logical: string; bind: string; parentSet: string; accountBind: boolean },
  parentId: string,
  accountId: string,
  values: Record<string, unknown>,
  fallbackName: string
): Promise<{ outcome: "created" | "filled" | "unchanged"; id: string }> {
  return upsertOwnedRecord(env, { ...table, match: "iacrm_name" }, { column: table.bind, id: parentId }, {
    [`${table.bind}@odata.bind`]: `/${table.parentSet}(${parentId})`,
    ...(table.accountBind ? { "iacrm_accountid@odata.bind": `/accounts(${accountId})` } : {})
  }, values, fallbackName);
}

/** The insured item an asset's plug-in registered for it (where additional
 * interests attach); null until it exists. */
export async function insuredItemOf(env: CrmEnvironment, assetSet: string, assetId: string): Promise<string | null> {
  const r = await dvJson<Record<string, string | null>>(env, `${assetSet}(${assetId})?$select=_iacrm_insureditemid_value`);
  return r["_iacrm_insureditemid_value"] ?? null;
}

async function upsertOwnedRecord(
  env: CrmEnvironment,
  table: { set: string; logical: string; match: string },
  owner: { column: string; id: string },
  binds: Record<string, string>,
  values: Record<string, unknown>,
  fallbackName: string
): Promise<{ outcome: "created" | "filled" | "unchanged"; id: string }> {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const row = { ...values };
  if (!row["iacrm_name"]) row["iacrm_name"] = assetName(row, fallbackName);
  const key = typeof row[table.match] === "string" && (row[table.match] as string).trim() ? table.match : "iacrm_name";
  const idCol = `${table.logical}id`;
  const filter = [`_${owner.column}_value eq ${owner.id}`, "statecode eq 0", `${key} eq ${q(String(row[key]))}`].join(" and ");
  const { value } = await dvJson<{ value: Record<string, string>[] }>(env, `${table.set}?$select=${idCol}&$filter=${encodeURIComponent(filter)}&$top=1`);
  const existing = value[0]?.[idCol];
  if (existing) {
    const written = await fillIfEmpty(env, table.set, existing, row);
    return { outcome: written.length ? "filled" : "unchanged", id: existing };
  }
  const created = await dvPost<Record<string, string>>(env, `${table.set}?$select=${idCol}`, { ...row, ...binds });
  return { outcome: "created", id: created[idCol]! };
}
