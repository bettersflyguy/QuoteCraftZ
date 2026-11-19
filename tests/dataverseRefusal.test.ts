/** AB#3745 follow-up: Dataverse's own 403 reason and the refused account. */
import { describe, it, expect, vi, afterEach } from "vitest";

const OID = "aaaaaaaa-1111-2222-3333-444444444444", TID = "bbbbbbbb-1111-2222-3333-444444444444";
const payload = Buffer.from(JSON.stringify({
  preferred_username: "agent@example.com", oid: OID, tid: TID, aud: "https://x.crm.dynamics.com/?evil=1",
  name: "Secret Name", scp: "user_impersonation", appid: "cccccccc-1111-2222-3333-444444444444"
})).toString("base64url");
const TOKEN = `hdr.${payload}.sig-abcdefghijklmnopqrstuvwxyz0123456789`;
vi.mock("@/crm/auth", () => ({ getAccessToken: async () => TOKEN }));

import { dvJson, CrmAccessError } from "@/crm/dataverse";
import { buildFieldCatalog } from "@/crm/fieldCatalog";
import { parseRefusal, safeClaims, safeHost, diagnosticNote, diagnosticText } from "@/crm/catalogDiagnostics";
import { classifyCatalogError } from "@/crm/catalogNote";
import type { CrmEnvironment } from "@/crm/environments";

const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;
afterEach(() => vi.unstubAllGlobals());

const body = { error: { code: "0x80040220", message: "Principal user (Id=11111111-2222-3333-4444-555555555555) is missing prvReadEntity privilege. See https://x.crm.dynamics.com/api/data/v9.2/accounts?$select=name&token=abc" } };

describe("Dataverse refusal reason", () => {
  it("a 403 keeps Dataverse's code and message and the account, with no URL, query or token", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 403 }));
    const err = await dvJson(env, "accounts?$select=name").catch(e => e) as CrmAccessError;
    expect(err).toBeInstanceOf(CrmAccessError);
    expect(err.status).toBe(403);
    expect(err.upn).toBe("agent@example.com");
    expect(err.dvCode).toBe("0x80040220");
    expect(err.dvMessage).toContain("missing prvReadEntity privilege");
    for (const v of [err.dvMessage!, err.dvCode!]) {
      expect(v).not.toMatch(/\?|https?:|token=|\$select/);
    }
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(classifyCatalogError(err)).toMatchObject({ kind: "role", status: 403, upn: "agent@example.com", dvCode: "0x80040220" });
  });

  it("an unreadable body still raises the 403", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>no</html>", { status: 403 }));
    const err = await dvJson(env, "accounts").catch(e => e) as CrmAccessError;
    expect(err.status).toBe(403);
    expect(err.dvCode).toBeUndefined();
    expect(parseRefusal("not json")).toEqual({});
  });

  it("every table refused: the plain-words note names the account and environment", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 403 }));
    const c = await buildFieldCatalog(env, { dvJson });
    expect(c.diagnostics?.account).toBe("agent@example.com");
    expect(diagnosticNote(c, null, "GENERIC")).toBe(
      "CRM field list not loaded: Dataverse refused agent@example.com in DEV at x.crm.dynamics.com (HTTP 403) on every table. Showing only built-in targets. " +
      "A CRM administrator needs to give this account a security role in DEV, or sign in with the work account that has DEV access.");
    const text = diagnosticText(c, { buildVersion: "1" });
    expect(text).toContain("Account refused: agent@example.com");
    expect(text).toContain("0x80040220");
    expect(text).toContain("missing prvReadEntity privilege");
    expect(text).not.toMatch(/\?|https?:|token=|\$select/);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("sig-abcdef");
  });

  it("records org host, token claims and the first refusal, and nothing else from the token", async () => {
    const dirty = { ...env, orgUrl: "https://x.crm.dynamics.com/?secret=1#frag" } as CrmEnvironment;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 403 }));
    const c = await buildFieldCatalog(dirty, { dvJson });
    expect(c.diagnostics).toMatchObject({
      orgHost: "x.crm.dynamics.com", account: "agent@example.com",
      claims: { upn: "agent@example.com", oid: OID, tid: TID, aud: "x.crm.dynamics.com" },
      refusal: { status: 403, code: "0x80040220" }
    });
    const text = diagnosticText(c, { buildVersion: "1" });
    expect(text).toContain("Org host: x.crm.dynamics.com");
    expect(text).toContain(`Token claims: upn=agent@example.com oid=${OID} tid=${TID} aud=x.crm.dynamics.com`);
    expect(text).toContain("First refusal: HTTP 403 Dataverse: 0x80040220");
    for (const bad of ["secret=1", "frag", "evil=1", "Secret Name", "user_impersonation", "cccccccc", TOKEN, "sig-abcdef"]) expect(text).not.toContain(bad);
  });

  it("a 403 with no Dataverse error body is reported as possibly a proxy or firewall", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>blocked</html>", { status: 403 }));
    const c = await buildFieldCatalog(env, { dvJson });
    expect(c.diagnostics?.refusal).toEqual({ status: 403 });
    expect(diagnosticText(c, { buildVersion: "1" })).toContain("no Dataverse error body (possibly a proxy or firewall)");
  });

  it("claims with an unexpected shape are dropped, not shown", () => {
    expect(safeClaims({ upn: "a b@x?y", oid: "not-a-guid", tid: "<script>", aud: "javascript:alert(1)" })).toEqual({});
    expect(safeHost("https://u:p@h.example.com/p?q=1")).toBe("h.example.com");
  });

  it("a mix of refusals and other failures keeps the generic note", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++ % 2 ? new Response("{}", { status: 500 }) : new Response("{}", { status: 403 })));
    const c = await buildFieldCatalog(env, { dvJson });
    expect(diagnosticNote(c, null, "GENERIC")).toBe("GENERIC");
  });
});
