import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";
import { reset } from "./helpers/chromeStub";
import { pkcePair, buildAuthorizeUrl, getAccessToken, AuthRequiredError, __store } from "@/crm/auth";

beforeEach(async () => {
  reset();
  await __store.clear();
});

describe("pkce", () => {
  it("produces base64url verifier and S256 challenge", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("scopes the token to the org and carries the challenge", () => {
    const url = new URL(buildAuthorizeUrl("https://agentcrmdev.crm.dynamics.com", "https://x.chromiumapp.org/", "CHAL"));
    expect(url.searchParams.get("scope")).toContain("https://agentcrmdev.crm.dynamics.com/user_impersonation");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("code_challenge")).toBe("CHAL");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("getAccessToken", () => {
  it("shares simultaneous sign-in requests for the same org",async()=>{
    let finish!:(url:string)=>void;
    const launch=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
    Object.assign(chrome,{identity:{getRedirectURL:()=>"https://test.chromiumapp.org/",launchWebAuthFlow:launch}});
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({access_token:"TOKEN",expires_in:3600})})));
    const first=getAccessToken("https://same.crm.dynamics.com");
    const second=getAccessToken("https://same.crm.dynamics.com");
    await vi.waitFor(()=>expect(launch).toHaveBeenCalledTimes(1));
    finish("https://test.chromiumapp.org/?code=test");
    expect(await Promise.all([first,second])).toEqual(["TOKEN","TOKEN"]);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it("serializes different-org web auth and releases the queue after cancellation",async()=>{
    let rejectFirst!:(error:Error)=>void;
    const launch=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{rejectFirst=reject;}))
      .mockResolvedValueOnce("https://test.chromiumapp.org/?code=second");
    Object.assign(chrome,{identity:{getRedirectURL:()=>"https://test.chromiumapp.org/",launchWebAuthFlow:launch}});
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({access_token:"SECOND",expires_in:3600})})));
    const first=getAccessToken("https://one.crm.dynamics.com");
    const failure=expect(first).rejects.toThrow("cancelled");
    const second=getAccessToken("https://two.crm.dynamics.com");
    await vi.waitFor(()=>expect(launch).toHaveBeenCalledTimes(1));
    rejectFirst(new Error("cancelled"));await failure;
    expect(await second).toBe("SECOND");expect(launch).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => __store.clear());

  it("returns cached token when unexpired", async () => {
    await __store.set("https://org.crm.dynamics.com", {
      accessToken: "CACHED", refreshToken: "R", expiresAt: Date.now() + 600_000
    });
    expect(await getAccessToken("https://org.crm.dynamics.com")).toBe("CACHED");
  });

  it("refreshes with refresh_token when expired", async () => {
    await __store.set("https://org.crm.dynamics.com", {
      accessToken: "OLD", refreshToken: "R", expiresAt: Date.now() - 1
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ access_token: "NEW", refresh_token: "R2", expires_in: 3600 })
    })));
    expect(await getAccessToken("https://org.crm.dynamics.com")).toBe("NEW");
  });

  it("throws AuthRequiredError when non-interactive and no refresh path", async () => {
    await expect(getAccessToken("https://org.crm.dynamics.com", { interactive: false })).rejects.toThrow(AuthRequiredError);
  });
});
