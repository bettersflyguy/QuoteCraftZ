import { APP_CONFIG } from "@/config/appConfig";

export class AuthRequiredError extends Error {
  constructor() { super("Interactive sign-in required"); this.name = "AuthRequiredError"; }
}

interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: number }

/** Per-org token cache over chrome.storage.session. Exported for tests. */
const knownOrgs = new Set<string>();

export const __store = {
  async get(orgUrl: string): Promise<TokenSet | null> {
    const key = `token:${orgUrl}`;
    const o = await chrome.storage.session.get(key);
    return (o[key] as TokenSet | undefined) ?? null;
  },
  async set(orgUrl: string, t: TokenSet): Promise<void> {
    knownOrgs.add(orgUrl);
    await chrome.storage.session.set({ [`token:${orgUrl}`]: t });
  },
  /** Test helper: genuinely clears every cached token, not just the object's own state. */
  async clear(): Promise<void> {
    for (const orgUrl of knownOrgs) {
      await chrome.storage.session.remove(`token:${orgUrl}`);
    }
    knownOrgs.clear();
  }
};

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

function scopeFor(orgUrl: string): string {
  return `${orgUrl}/user_impersonation offline_access openid`;
}

export function buildAuthorizeUrl(orgUrl: string, redirectUri: string, challenge: string): string {
  return `${APP_CONFIG.authority}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: APP_CONFIG.clientId, response_type: "code", redirect_uri: redirectUri,
    scope: scopeFor(orgUrl), code_challenge: challenge, code_challenge_method: "S256",
    prompt: "select_account"   // Windows SSO otherwise silently picks the wrong profile (Nathan, 2026-08-15); refresh tokens keep later calls non-interactive
  });
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(`${APP_CONFIG.authority}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${json.error_description ?? json.error}`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + (json.expires_in - 120) * 1000   // 2 min skew
  };
}

async function interactiveSignIn(orgUrl: string): Promise<TokenSet> {
  const redirectUri = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await pkcePair();
  const cb = await chrome.identity.launchWebAuthFlow({ url: buildAuthorizeUrl(orgUrl, redirectUri, challenge), interactive: true });
  const code = cb ? new URL(cb).searchParams.get("code") : null;
  if (!code) throw new AuthRequiredError();
  return tokenRequest(new URLSearchParams({
    client_id: APP_CONFIG.clientId, grant_type: "authorization_code", code,
    redirect_uri: redirectUri, code_verifier: verifier, scope: scopeFor(orgUrl)
  }));
}

export async function getAccessToken(orgUrl: string, opts: { interactive?: boolean } = {}): Promise<string> {
  const interactive = opts.interactive ?? true;
  const cached = await __store.get(orgUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  if (cached?.refreshToken) {
    try {
      const t = await tokenRequest(new URLSearchParams({
        client_id: APP_CONFIG.clientId, grant_type: "refresh_token",
        refresh_token: cached.refreshToken, scope: scopeFor(orgUrl)
      }));
      await __store.set(orgUrl, t);
      return t.accessToken;
    } catch { /* fall through to interactive */ }
  }

  if (!interactive) throw new AuthRequiredError();
  const t = await interactiveSignIn(orgUrl);
  await __store.set(orgUrl, t);
  return t.accessToken;
}
