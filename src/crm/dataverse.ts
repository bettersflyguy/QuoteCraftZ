import { getAccessToken } from "./auth";
import type { CrmEnvironment } from "./environments";

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
export interface NewAccountFields {
  name: string;
  street: string | null; city: string | null; state: string | null; postalCode: string | null;
  phone: string | null; email: string | null;
}
export interface BatchItemResult { key: string; status: number; error: string | null }

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

export async function createOpportunity(
  env: CrmEnvironment, accountId: string, lobId: string, name: string
): Promise<OppSummary> {
  const body = {
    name,
    "customerid_account@odata.bind": `/accounts(${accountId})`,
    // nav property is SCHEMA-cased - iacrm_lineofbusinessid (logical case) is
    // rejected with "undeclared property". Verified live against DEV 2026-08-15.
    "iacrm_LineOfBusinessId@odata.bind": `/iacrm_lineofbusinesses(${lobId})`
  };
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
  ops: { key: string; method: "PATCH"; url: string; body: unknown }[]
): Promise<BatchItemResult[]> {
  const boundary = `batch_${crypto.randomUUID()}`;
  const parts = ops.map(op => [
    `--${boundary}`,
    "Content-Type: application/http",
    "Content-Transfer-Encoding: binary",
    "",
    `${op.method} ${env.orgUrl}${API}${op.url} HTTP/1.1`,
    "Content-Type: application/json",
    "",
    JSON.stringify(op.body)
  ].join("\r\n"));
  const body = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;

  const res = await dv(env, "$batch", {
    method: "POST",
    headers: { "Content-Type": `multipart/mixed;boundary=${boundary}`, Prefer: "odata.continue-on-error" },
    body
  });
  if (!res.ok) throw new Error(`$batch failed: ${res.status}`);
  const text = await res.text();

  // parse per-part HTTP statuses in order
  const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})[^\r\n]*/g)].map(m => Number(m[1]));
  const errors = [...text.matchAll(/\{"error":\{[^\n]*/g)].map(m => m[0]);
  let errIdx = 0;
  return ops.map((op, i) => {
    const status = statuses[i] ?? 0;
    const failed = status >= 400;
    return { key: op.key, status, error: failed ? (errors[errIdx++] ?? `HTTP ${status}`) : null };
  });
}
