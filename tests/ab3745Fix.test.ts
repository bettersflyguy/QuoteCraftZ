/** AB#3745 fix: not-a-member message, account/environment status, Sign out,
 * Lead in the catalog, refresh after update, manual refresh, no swallowed errors. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./helpers/chromeStub";
import { backing, reset } from "./helpers/chromeStub";
import { __store } from "@/crm/auth";
import { CrmAccessError, signedInAccount } from "@/crm/dataverse";
import {
  CATALOG_ENTITIES, READ_ONLY_ENTITY_KEYS, mappableEntities, type CatalogApi, buildFieldCatalog, clearFieldCatalogCache, getFieldCatalog, type FieldCatalog
} from "@/crm/fieldCatalog";
import { catalogUnavailableNote, classifyCatalogError, isNotMemberRefusal, notMemberText, ROLE_TASK } from "@/crm/catalogNote";
import { diagnosticNote, diagnosticText } from "@/crm/catalogDiagnostics";
import { routeMessage } from "@/workerRouter";
import { MAP_PATH_GROUPS } from "@/portal/fieldMaps";
import type { CrmEnvironment } from "@/crm/environments";

const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;
const WRONG = "Nathan@bettersinsurance.com";
const NOT_MEMBER = { code: "0x80072560", message: "The user is not a member of the organization." };

const refusal = (status: number, reason: { code?: string; message?: string } = {}, upn: string | null = WRONG) =>
  new CrmAccessError(env.orgUrl, status, upn, reason);

const attrs = { value: [{ LogicalName: "name", AttributeType: "String", IsValidForCreate: true, IsValidForUpdate: true, DisplayName: { UserLocalizedLabel: { Label: "Name" } } }] };
const okApi = () => ({ dvJson: vi.fn(async (_e: CrmEnvironment, path: string) => (path.includes("/Attributes?") ? attrs : { value: [] })) as unknown as CatalogApi["dvJson"] & ReturnType<typeof vi.fn> });

const realChrome = globalThis.chrome;
beforeEach(() => { vi.stubGlobal("chrome", realChrome); reset(); __store.clear(); });
afterEach(() => { vi.stubGlobal("chrome", realChrome); });

describe("not a member of the organization (0x80072560)", () => {
  it("is recognised by its code or its message, and only by those", () => {
    expect(isNotMemberRefusal({ dvCode: "0x80072560" })).toBe(true);
    expect(isNotMemberRefusal({ dvMessage: "The user is not a member of the organization." })).toBe(true);
    expect(isNotMemberRefusal({ dvMessage: "the user is not a member of the organisation" })).toBe(true);
    expect(isNotMemberRefusal({ dvCode: "0x80040220", dvMessage: "missing prvReadEntity privilege" })).toBe(false);
    expect(isNotMemberRefusal({})).toBe(false);
    expect(isNotMemberRefusal(null)).toBe(false);
  });

  it("classifies as notMember (not role) whether Dataverse answered 403 or 401, and a real role refusal stays role", () => {
    expect(classifyCatalogError(refusal(403, NOT_MEMBER))).toMatchObject({ kind: "notMember", upn: WRONG, dvCode: "0x80072560" });
    expect(classifyCatalogError(refusal(401, { message: NOT_MEMBER.message }))).toMatchObject({ kind: "notMember" });
    expect(classifyCatalogError(refusal(403, { code: "0x80040220", message: "missing prvReadEntity" }))).toMatchObject({ kind: "role" });
    expect(classifyCatalogError(refusal(403))).toMatchObject({ kind: "role" });
  });

  it("the panel note names the account, says it is not a user of this CRM, and never says 'no security role'", () => {
    const note = catalogUnavailableNote(classifyCatalogError(refusal(403, NOT_MEMBER)));
    expect(note).toContain(`signed in as ${WRONG}, which is not a user of this CRM; sign out and sign in with your CRM account`.replace("signed", "Signed"));
    expect(note).not.toMatch(/security role/i);
    expect(note).not.toContain(ROLE_TASK);
    expect(notMemberText(null)).toContain("Signed in as an account, which is not a user of this CRM");
    // a genuine role refusal keeps the role text
    expect(catalogUnavailableNote(classifyCatalogError(refusal(403, { code: "0x80040220" })))).toContain("security role");
  });

  it("every table refused with not-a-member: the all-failed note and Copy details use the real reason", async () => {
    const api = { dvJson: async () => { throw refusal(403, NOT_MEMBER); } };
    const c = await buildFieldCatalog(env, api as never);
    expect(c.unavailable?.kind).toBe("notMember");
    const note = diagnosticNote(c, null, "GENERIC");
    expect(note).toContain(`Signed in as ${WRONG}, which is not a user of this CRM; sign out and sign in with your CRM account.`);
    expect(note).toContain("DEV");
    expect(note).not.toMatch(/security role|GENERIC/);
    const text = diagnosticText(c, { buildVersion: "0.1.70" });
    expect(text).toContain("0x80072560");
    expect(text).toContain("account is not a user of this CRM");
  });

  it("the worker's own error for a not-a-member refusal gives the same plain words, with Sign in guidance", async () => {
    const deps = {
      getActiveEnvironment: async () => env,
      searchAccounts: async () => { throw refusal(403, NOT_MEMBER); }
    };
    const res = await routeMessage({ type: "panel/searchAccounts", name: "S", postalCode: null }, deps as never);
    expect(res).toMatchObject({ ok: false, kind: "auth" });
    expect((res as { error: string }).error).toContain(`Signed in as ${WRONG}, which is not a user of this CRM (DEV); sign out and sign in with your CRM account.`);
    expect((res as { error: string }).error).not.toMatch(/security role/i);
  });
});

describe("account and environment status, Sign out", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

  it("signedInAccount reads the cached token's account, and null when signed out", async () => {
    expect(await signedInAccount(env.orgUrl)).toBeNull();
    await __store.set(env.orgUrl, { accessToken: jwt({ preferred_username: "Nathan@bettersagency.com" }), refreshToken: "R", expiresAt: Date.now() + 1000 });
    expect(await signedInAccount(env.orgUrl)).toBe("Nathan@bettersagency.com");
    // a token that is not a JWT yields no account rather than an error
    await __store.set(env.orgUrl, { accessToken: "garbage", refreshToken: null, expiresAt: 0 });
    expect(await signedInAccount(env.orgUrl)).toBeNull();
  });

  it("auth/status returns account, environment name and host only - no token", async () => {
    const token = jwt({ preferred_username: WRONG });
    const deps = {
      getActiveEnvironment: async () => ({ ...env, orgUrl: "https://x.crm.dynamics.com/?secret=1" }),
      getSignedInAccount: async () => WRONG
    };
    const res = await routeMessage({ type: "auth/status" }, deps as never);
    expect(res).toEqual({ ok: true, data: { envId: "dev", envName: "DEV", orgHost: "x.crm.dynamics.com", account: WRONG } });
    expect(JSON.stringify(res)).not.toContain(token);
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("auth/signOut clears the active environment's cached sign-in and nothing else", async () => {
    await __store.set(env.orgUrl, { accessToken: jwt({ preferred_username: WRONG }), refreshToken: "R", expiresAt: Date.now() + 1000 });
    const clearToken = vi.fn(async (o: string) => { await chrome.storage.session.remove(`token:${o}`); });
    const res = await routeMessage({ type: "auth/signOut" }, { getActiveEnvironment: async () => env, clearToken } as never);
    expect(res).toEqual({ ok: true, data: null });
    expect(clearToken).toHaveBeenCalledWith(env.orgUrl);
    expect(await signedInAccount(env.orgUrl)).toBeNull();
  });
});

describe("Lead in the field catalog", () => {
  it("lists Lead, keeps the earlier tables and the built-in mapping targets", () => {
    const lead = CATALOG_ENTITIES.find(e => e.key === "lead");
    expect(lead).toMatchObject({ logical: "lead", set: "leads", label: "Lead", array: false });
    for (const k of ["account", "primarycontact", "contacts", "policies", "addresses", "quote", "opportunity", "priorcoverage"]) {
      expect(CATALOG_ENTITIES.some(e => e.key === k)).toBe(true);
    }
    expect(MAP_PATH_GROUPS.length).toBeGreaterThan(0);
  });

  it("reads the Lead table's columns and offers them as crm:lead targets", async () => {
    const api = okApi();
    const c = await buildFieldCatalog(env, api);
    const lead = c.entities.find(e => e.key === "lead");
    expect(lead?.columns.map(x => x.name)).toEqual(["name"]);
    expect(api.dvJson.mock.calls.some(([, p]) => String(p).includes("LogicalName='lead'"))).toBe(true);
    expect(c.diagnostics?.tables.some(t => t.logical === "lead" && t.ok)).toBe(true);
  });

  it("Lead stays in the catalog but is not offered as a mapping target (nothing writes it yet)", async () => {
    const c = await buildFieldCatalog(env, okApi());
    expect(c.entities.some(e => e.key === "lead")).toBe(true);
    expect(READ_ONLY_ENTITY_KEYS.has("lead")).toBe(true);
    const keys = mappableEntities(c).map(e => e.key);
    expect(keys).not.toContain("lead");
    expect(keys).toContain("account");
    expect(keys.length).toBe(c.entities.length - 1);
  });

  it("a failing Lead table is reported as partial, not dropped silently", async () => {
    const api = { dvJson: async <T,>(_e: CrmEnvironment, p: string): Promise<T> => {
      if (p.includes("LogicalName='lead'")) throw new Error("Dataverse 404 for x");
      return (p.includes("/Attributes?") ? attrs : { value: [] }) as T;
    } };
    const c = await buildFieldCatalog(env, api);
    expect(c.diagnostics?.case).toBe("partial");
    expect(diagnosticNote(c, null, "x")).toContain("lead table could not be read (HTTP 404)");
  });
});

describe("cache rules: version bump, refresh after update, manual refresh", () => {
  const cacheKeys = () => Object.keys(backing).filter(k => k.startsWith("crm/fieldCatalog/"));

  it("the cache key is v9 (the shape changed)", async () => {
    await getFieldCatalog(env, okApi());
    expect(cacheKeys()).toEqual(["crm/fieldCatalog/v9/dev"]);
  });

  it("a catalog is reused within a day on the same build, and Refresh forces a live read", async () => {
    const api = okApi();
    await getFieldCatalog(env, api);
    const after1 = api.dvJson.mock.calls.length;
    const hit = await getFieldCatalog(env, api);
    expect(api.dvJson.mock.calls.length).toBe(after1);
    expect(hit.diagnostics?.source).toBe("cached");
    await getFieldCatalog(env, api, true);
    expect(api.dvJson.mock.calls.length).toBeGreaterThan(after1);
  });

  it("a catalog read by another extension build is not reused", async () => {
    const api = okApi();
    vi.stubGlobal("chrome", { ...realChrome, runtime: { getManifest: () => ({ version: "0.1.69" }) } });
    await getFieldCatalog(env, api);
    const after = api.dvJson.mock.calls.length;
    vi.stubGlobal("chrome", { ...realChrome, runtime: { getManifest: () => ({ version: "0.1.70" }) } });
    const fresh = await getFieldCatalog(env, api);
    expect(api.dvJson.mock.calls.length).toBeGreaterThan(after);
    expect(fresh.diagnostics?.source).toBe("live");
    expect(fresh.build).toBe("0.1.70");
  });

  it("a failed read is returned with its reason and never cached", async () => {
    const api = { dvJson: async () => { throw refusal(403, NOT_MEMBER); } };
    const c: FieldCatalog = await getFieldCatalog(env, api as never);
    expect(c.entities).toEqual([]);
    expect(c.unavailable?.kind).toBe("notMember");
    expect(cacheKeys()).toEqual([]);
  });

  it("clearFieldCatalogCache removes every cached catalog (any version) and leaves other storage alone", async () => {
    backing["crm/fieldCatalog/v8/dev"] = { old: true };
    backing["crm/fieldCatalog/v9/dev"] = { cur: true };
    backing["portal/fieldMap"] = { keep: "me" };
    await clearFieldCatalogCache();
    expect(cacheKeys()).toEqual([]);
    expect(backing["portal/fieldMap"]).toEqual({ keep: "me" });
  });
});
