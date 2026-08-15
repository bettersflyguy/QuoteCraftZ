// Phase 0 spike. Answers Q1-Q3 in README. THROWAWAY - never imported by src/.
const CLIENT_ID = "84e47c8b-6499-40e9-b014-3e24c9ecd303";
const AUTHORITY = "https://login.microsoftonline.com/organizations";
const ORG = "https://agentcrmdev.crm.dynamics.com";
// Q3 second-resource check: any other org URL proves the second authorize round-trip
const ORG2 = "https://orgf9f691a1.crm.dynamics.com";

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

async function acquireToken(orgUrl, interactiveNote) {
  const redirectUri = chrome.identity.getRedirectURL();
  console.log("[spike] redirect URI:", redirectUri);
  const { verifier, challenge } = await pkce();
  const scope = `${orgUrl}/user_impersonation offline_access openid`;
  const t0 = Date.now();
  const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: redirectUri,
    scope, code_challenge: challenge, code_challenge_method: "S256"
  });
  const cb = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const elapsed = Date.now() - t0;
  const code = new URL(cb).searchParams.get("code");
  if (!code) throw new Error("no code in callback: " + cb);
  // Q2 heuristic: a silent SSO pass-through round-trips in a couple seconds; typing credentials takes longer
  console.log(`[spike] ${interactiveNote} authorize completed in ${elapsed}ms (fast = SSO pass-through, no typing)`);
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, grant_type: "authorization_code", code,
      redirect_uri: redirectUri, code_verifier: verifier, scope
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error("token exchange failed: " + JSON.stringify(json));
  return json.access_token;
}

async function run() {
  const results = { q1: "PENDING", q2: "see authorize timing in log", q3: "PENDING", at: new Date().toISOString() };
  try {
    const token = await acquireToken(ORG, "Q1/Q2");
    console.log("[spike] token acquired, len", token.length);
    const r = await fetch(`${ORG}/api/data/v9.2/accounts?$select=name&$top=1`, {
      headers: { Authorization: `Bearer ${token}`, "OData-MaxVersion": "4.0", "OData-Version": "4.0" }
    });
    const body = await r.json();
    results.q1 = r.status === 200 ? `PASS (200, got: ${JSON.stringify(body).slice(0, 120)})` : `FAIL (${r.status}: ${JSON.stringify(body).slice(0, 300)})`;
    console.log("[spike] Q1 Dataverse GET:", results.q1);
  } catch (e) {
    results.q1 = "FAIL (auth): " + e.message;
    console.error("[spike] Q1 FAILED:", e);
  }
  try {
    await acquireToken(ORG2, "Q3");
    results.q3 = "PASS (second-org authorize + redemption succeeded)";
  } catch (e) {
    // even an org-specific error after a successful authorize answers Q3's auth-flow question
    results.q3 = "CHECK: " + e.message.slice(0, 200);
  }
  console.log("[spike] RESULTS:", results);
  await chrome.storage.local.set({ spikeResults: results });
  chrome.action.setBadgeText({ text: results.q1.startsWith("PASS") ? "OK" : "ERR" });
  chrome.action.setBadgeBackgroundColor({ color: results.q1.startsWith("PASS") ? "#107C10" : "#D13438" });
}

chrome.action.onClicked.addListener(run);
