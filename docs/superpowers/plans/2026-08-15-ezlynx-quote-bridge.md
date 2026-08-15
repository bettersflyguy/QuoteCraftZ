# EZLynx Quote Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome/Edge MV3 extension that imports EZLynx comparative-rater results into the D365 Insurance CRM as `iacrm_quote` records via the signed-in agent's own Dataverse session.

**Architecture:** Content script calls EZLynx's cookie-authenticated JSON API and normalizes to a canonical `CapturedRun`; a service worker owns Entra PKCE tokens (cached per org) and all Dataverse HTTP; a Fluent UI v9 side panel drives run pick → account match → opportunity pin → carrier map → review/commit. One non-atomic `$batch` upsert per import on the `(iacrm_provider, iacrm_amsexternalid)` alternate key.

**Tech Stack:** TypeScript (strict), Vite 5 + `@crxjs/vite-plugin`, React 18, Fluent UI v9, zod, Vitest. Node 22 / npm.

**Spec:** `docs/superpowers/specs/2026-08-15-ezlynx-quote-bridge-design.md` — read it before starting any task.

## Global Constraints

- **Working directory:** `C:\Projects\EZLynx-Quote-Bridge`. Never write to OneDrive paths.
- **Premium status invariant:** `iacrm_premium_status` = `738590000` (Estimated), hardcoded, never derived; omitted from the upsert payload when the existing row is Firm (`738590002`). The extension never writes `738590002`.
- **Coverage values verbatim:** no parsing, normalizing, or currency reformatting anywhere in the render path.
- **Key formats:** requested → `ezlynx:{execId}:req`; alternate *n* (0-based) → `ezlynx:{execId}:alt{n}`.
- **Choice values:** `iacrm_sourcetype`=100000002 (Comparative Rater); `iacrm_status`=738590002 (Quote Received); `iacrm_term`: 6→738590203, 12→738590205, anything else → omit field.
- **Entity set names:** `iacrm_quotes`, `iacrm_carriers`, `iacrm_lineofbusinesses`, `iacrm_quotingmethods`, `accounts`, `opportunities`.
- **Never** write `iacrm_submissionid` / `iacrm_submissionlineid` — always null.
- **Read-only against EZLynx.** GET/POST-list endpoints only; no mutation calls, ever.
- **EZLynx knowledge lives only in** `src/ezlynx/` + `src/config/endpoints.json`. Panel and Dataverse code never see a raw EZLynx object.
- **Auth note (deviation from spec, flagged for review):** spec names MSAL Browser, but MSAL requires DOM/`sessionStorage`, which MV3 service workers lack. Plan hand-rolls the OAuth2 authorization-code + PKCE flow (~120 lines) via `chrome.identity.launchWebAuthFlow`. **Spike-verified 2026-08-15:** the app must be registered under the **SPA** platform — service-worker fetches DO send `Origin: chrome-extension://…`, and Entra rejects cross-origin redemption for public clients with `AADSTS9002326`, which names SPA as the required client-type. The redirect URI lives in `spa.redirectUris`; `publicClient.redirectUris` is empty.
- **CORS note:** MV3 fetches from the service worker to hosts listed in `host_permissions` bypass CORS entirely. `https://*.crm.dynamics.com/*` and `https://login.microsoftonline.com/*` are in `host_permissions`, so the spec's CORS risk is expected to be moot — Task 1 confirms.
- Commit after every task. Messages use conventional prefixes (`feat:`, `test:`, `chore:`, `docs:`).

---

### Task 1: Phase 0 spike — Entra app registration + token + Dataverse GET

Throwaway code; lives in `spike/`, never imported by `src/`. Its output is **answers**, recorded in the spike README.

**Files:**
- Create: `spike/manifest.json`
- Create: `spike/worker.js`
- Create: `spike/README.md`

**Interfaces:**
- Produces: the Entra **Application (client) ID** and the verified auth constants (tenant endpoint, redirect URI form, scope form) that Task 8 (`src/config/appConfig.ts`) and Task 9 (`src/crm/auth.ts`) hardcode as defaults. Record them in `spike/README.md`.

- [ ] **Step 1: Register the Entra app** (requires Nathan's Azure login; use `az` CLI via Bash, or the portal)

```bash
az ad app create \
  --display-name "EZLynx Quote Bridge" \
  --sign-in-audience AzureADMultipleOrgs \
  --is-fallback-public-client true \
  --public-client-redirect-uris "https://PLACEHOLDER.chromiumapp.org/" \
  --query appId -o tsv
```

Record the returned `appId`. The redirect URI is finalized in Step 3 once the unpacked extension ID is known (`az ad app update --id <appId> --public-client-redirect-uris "https://<extension-id>.chromiumapp.org/"`). Then grant the Dataverse delegated permission:

```bash
az ad app permission add --id <appId> \
  --api 00000007-0000-0000-c000-000000000000 \
  --api-permissions 78ce3f0f-a1ce-49c2-8cde-64b5c0896db4=Scope
```

(`00000007-...` is Dataverse; the permission is `user_impersonation`.)

- [ ] **Step 2: Write the spike extension**

`spike/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "EZLynx Quote Bridge SPIKE",
  "version": "0.0.1",
  "permissions": ["identity", "storage"],
  "host_permissions": [
    "https://*.crm.dynamics.com/*",
    "https://login.microsoftonline.com/*"
  ],
  "background": { "service_worker": "worker.js" },
  "action": {}
}
```

`spike/worker.js`:

```js
// Phase 0 spike. Answers three questions; see README. THROWAWAY.
const CLIENT_ID = "PASTE-APP-ID-HERE";
const AUTHORITY = "https://login.microsoftonline.com/organizations";

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

async function acquireToken(orgUrl) {
  const redirectUri = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const { verifier, challenge } = await pkce();
  const scope = `${orgUrl}/user_impersonation offline_access openid`;
  const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: redirectUri,
    scope, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account"
  });
  const cb = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(cb).searchParams.get("code");
  if (!code) throw new Error("no code in callback: " + cb);
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

chrome.action.onClicked.addListener(async () => {
  try {
    const org = "https://agentcrmdev.crm.dynamics.com";
    console.log("[spike] acquiring token for", org);
    const token = await acquireToken(org);
    console.log("[spike] token acquired, len", token.length);
    const r = await fetch(`${org}/api/data/v9.2/accounts?$select=name&$top=1`, {
      headers: { Authorization: `Bearer ${token}`, "OData-MaxVersion": "4.0", "OData-Version": "4.0" }
    });
    console.log("[spike] Dataverse GET status:", r.status, await r.json());
  } catch (e) {
    console.error("[spike] FAILED:", e);
  }
});
```

- [ ] **Step 3: Run the spike and record answers**

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `spike/`. Copy the extension ID; update the Entra redirect URI to `https://<extension-id>.chromiumapp.org/` (Step 1 command). Paste the client ID into `worker.js`, reload.
2. Click the toolbar icon; inspect the service worker console.
3. Record in `spike/README.md`, each as PASS/FAIL with the observed output:
   - **Q1 (gate):** Dataverse GET returns 200 with a JSON body. If this fails after the auth succeeded, capture status + `www-authenticate` header — the design returns for revision (relay needed).
   - **Q2:** Was the sign-in silent (existing profile Entra session, no credential entry)? Test in Chrome and Edge (load the same unpacked dir in Edge, update redirect URI if Edge assigns a different extension ID — record both IDs).
   - **Q3:** Change `org` to any second org URL (even a nonexistent one proves the *authorize* round-trip) and confirm a second token request for a different resource succeeds in the same session without full re-auth.
4. Also record: the final client ID, both extension IDs, and whether `prompt: "select_account"` was needed or harmful.

- [ ] **Step 4: Commit**

```bash
git add spike/
git commit -m "chore: phase 0 spike - PKCE + Dataverse CORS verified from extension origin"
```

**STOP if Q1 failed** — report to Nathan; the design needs revision before Tasks 2+.

---

### Task 2: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore` (extend), `manifest.config.ts`
- Create: `src/panel/index.html`, `src/panel/main.tsx` (placeholder), `src/worker.ts` (placeholder), `src/ezlynx/content.ts` (placeholder), `src/options/index.html`, `src/options/main.tsx` (placeholder)

**Interfaces:**
- Produces: `npm run build` → `dist/` loadable unpacked; `npm test` runs Vitest; path alias `@/` → `src/`.

- [ ] **Step 1: Init and install**

```bash
cd C:/Projects/EZLynx-Quote-Bridge
npm init -y
npm i react react-dom @fluentui/react-components zod
npm i -D typescript vite @vitejs/plugin-react @crxjs/vite-plugin@latest vitest @types/react @types/react-dom @types/chrome
```

- [ ] **Step 2: Write configs**

`package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true,
    "types": ["chrome", "vite/client"],
    "baseUrl": ".", "paths": { "@/*": ["src/*"] },
    "resolveJsonModule": true, "skipLibCheck": true, "noEmit": true
  },
  "include": ["src", "tests", "manifest.config.ts", "vite.config.ts", "vitest.config.ts"]
}
```

`manifest.config.ts`:

```ts
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "EZLynx Quote Bridge",
  version: "0.1.0",
  description: "Import EZLynx quote results into the D365 Insurance CRM.",
  permissions: ["storage", "identity", "sidePanel", "tabs"],
  host_permissions: [
    "https://app.ezlynx.com/*",
    "https://*.crm.dynamics.com/*",
    "https://login.microsoftonline.com/*"
  ],
  background: { service_worker: "src/worker.ts", type: "module" },
  content_scripts: [
    { matches: ["https://app.ezlynx.com/*"], js: ["src/ezlynx/content.ts"], run_at: "document_idle" }
  ],
  side_panel: { default_path: "src/panel/index.html" },
  options_page: "src/options/index.html",
  action: { default_title: "EZLynx Quote Bridge" }
});
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";
import path from "node:path";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } }
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } }
});
```

Placeholder files so the build passes: `src/worker.ts` → `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});`, `src/ezlynx/content.ts` → `export {};`, panel/options `index.html` + `main.tsx` rendering `<div>EZLynx Quote Bridge</div>` via `createRoot`.

Append to `.gitignore`: `node_modules/`, `dist/`, `.vite/`.

- [ ] **Step 3: Verify build + empty test run**

Run: `npm run build` → Expected: `dist/` produced, no TS errors.
Run: `npm test` → Expected: "no test files found" exit 0 (or configure `passWithNoTests: true`).
Load `dist/` unpacked in Chrome; clicking the action icon opens the (placeholder) side panel.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold MV3 extension (vite + crxjs + react + vitest)"
```

---

### Task 3: Canonical types + trimmed fixture

**Files:**
- Create: `src/types.ts`
- Create: `tests/fixtures/quote-result.sample.json`
- Create: `tests/fixtures/applicant.sample.json`
- Create: `tests/fixtures/recent-quotes.sample.json`

**Interfaces:**
- Produces (consumed by every later task):

```ts
export interface CapturedApplicant {
  ezlynxApplicantId: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;          // "1949-11-18"
  address: { street: string; city: string; state: string; postalCode: string } | null;
  phones: string[];
  emails: string[];
  coApplicants: { firstName: string; lastName: string; relationship: string }[];
  isCommercial: boolean;
}

export interface CapturedQuote {
  key: string;                          // "ezlynx:{execId}:req" | "ezlynx:{execId}:alt{n}"
  kind: "requested" | "alternate";
  carrierEzlynxId: number;
  carrierName: string;
  quoteNumber: string | null;
  premium: number | null;               // totalPremium as number
  termMonths: number | null;            // 6 | 12 | null
  coverageSummary: string;              // rendered, verbatim values
  raw: unknown;                         // this quote's scriptResult context, for iacrm_rawpayload
}

export interface CapturedLobBlock {
  lob: string;                          // "Auto" | "Home" as EZLynx returns it
  applicantQuoteId: number;
  quotes: CapturedQuote[];
  errors: { carrierName: string; message: string }[];
}

export interface CapturedRun {
  applicant: CapturedApplicant;
  openApplicationId: number;
  capturedAt: string;                   // ISO, stamped at capture
  blocks: CapturedLobBlock[];
}

export interface RunListItem {
  applicationId: number;
  applicantId: number;
  created: string;
  lobs: string;                         // "Auto, Home"
  quoteIdsByLob: { lob: string; applicantQuoteId: number }[];
  description: string;
}
```

- [ ] **Step 1: Write `src/types.ts`** exactly as the Interfaces block above (plus `export`ed nothing else).

- [ ] **Step 2: Write the fixtures.** These are trimmed, PII-scrubbed captures preserving every structural edge case from recon (names/addresses/phones fictionalized; IDs, premiums, coverage values, and error messages real-shaped). `tests/fixtures/quote-result.sample.json`:

```json
[
  {
    "lob": "Auto",
    "allAreComplete": true,
    "scriptStartTime": "2026-08-03T16:07:54.393",
    "scriptResults": [
      {
        "scriptName": "Travelers Auto",
        "carrier": { "id": 13, "name": "Travelers", "siteUrl": "https://signin.travelers.com/", "smallImageUrl": "", "crossRefId": 13 },
        "execId": 1892138218,
        "hasError": false,
        "errorMessage": "Premium : $2273.00Quote Number : 0007684600833",
        "requestedQuotes": [
          {
            "quoteNumber": "0007684600833",
            "quoteIdentifier": "CCF#",
            "coverages": [
              { "name": "BI", "value": "500 CSL" },
              { "name": "PD", "value": "No Coverage" },
              { "name": "UM", "value": "500 CSL" },
              { "name": "MP", "value": "2000" },
              { "name": "PIPOptions", "value": "BASIC+10K MED EXP" }
            ],
            "premiumDetails": { "premiums": [ { "lob": "Auto", "term": "12", "amount": "2273.00", "amountText": "Total Premium", "totalPremium": "2273.00" } ], "payments": [] },
            "discountsApplied": ["Multi-Policy Discount"],
            "underwritingMessages": [],
            "marketingMessages": [],
            "quickAccessUrl": "https://example.invalid/jump",
            "vehicleCoverageBreakdown": { "vehicleNames": ["Coverage_0", "2008 GMC YUKON DENALI_1"], "coverageBreakdown": [] },
            "homeCoveragePremiums": [],
            "endorsementPremiums": []
          }
        ],
        "alternateQuotes": [
          {
            "quoteNumber": "0007684600833",
            "coverages": [ { "name": "BI", "value": "500 CSL" }, { "name": "PD", "value": "No Coverage" } ],
            "premiumDetails": { "premiums": [ { "lob": "Auto", "term": "12", "amount": "1798.00", "amountText": "Total Premium", "totalPremium": "1798.00" } ], "payments": [] },
            "discountsApplied": [],
            "underwritingMessages": [],
            "homeCoveragePremiums": [],
            "endorsementPremiums": []
          }
        ]
      },
      {
        "scriptName": "Liberty Mutual (Formerly Safeco) Auto",
        "carrier": { "id": 35, "name": "Liberty Mutual (Formerly Safeco)", "siteUrl": "", "smallImageUrl": "", "crossRefId": 35 },
        "execId": 1892138211,
        "hasError": false,
        "requestedQuotes": [
          {
            "quoteNumber": null,
            "coverages": [ { "name": "BI", "value": "500 CSL" }, { "name": "UM", "value": "500 CSL" } ],
            "premiumDetails": { "premiums": [ { "lob": "Auto", "term": "12", "amount": "2052.00", "amountText": "Total Premium", "totalPremium": "2052.00" } ], "payments": [] },
            "homeCoveragePremiums": [],
            "endorsementPremiums": []
          }
        ],
        "alternateQuotes": []
      },
      {
        "scriptName": "Hartford Auto XML",
        "carrier": { "id": 692, "name": "The Hartford", "siteUrl": "", "smallImageUrl": "", "crossRefId": 692 },
        "execId": 1892138216,
        "hasError": false,
        "requestedQuotes": [
          {
            "quoteNumber": "PA1013948721Q2026",
            "coverages": [ { "name": "BI", "value": "500/1000" }, { "name": "PD", "value": "10000" } ],
            "premiumDetails": { "premiums": [ { "lob": "Auto", "term": "6", "amount": "1425.50", "amountText": "Total Premium", "totalPremium": "1425.50" } ], "payments": [] },
            "homeCoveragePremiums": [],
            "endorsementPremiums": []
          }
        ],
        "alternateQuotes": []
      },
      {
        "scriptName": "Stillwater Property & Casualty Auto XML",
        "carrier": { "id": 404, "name": "Stillwater Property & Casualty", "siteUrl": "", "smallImageUrl": "", "crossRefId": 404 },
        "execId": 1892138215,
        "hasError": true,
        "errorMessage": "Notice From Carrier::FNI0233 : User ID is not currently eligible to quote this product.",
        "requestedQuotes": [],
        "alternateQuotes": []
      }
    ]
  },
  {
    "lob": "Home",
    "allAreComplete": true,
    "scriptStartTime": "2026-08-03T16:08:43.393",
    "scriptResults": [
      {
        "scriptName": "Liberty Mutual (Formerly Safeco) Home",
        "carrier": { "id": 35, "name": "Liberty Mutual (Formerly Safeco)", "siteUrl": "", "smallImageUrl": "", "crossRefId": 35 },
        "execId": 1892138212,
        "hasError": false,
        "requestedQuotes": [
          {
            "quoteNumber": null,
            "coverages": [ { "name": "Dwelling", "value": "$606,900" }, { "name": "Deductible", "value": "2500" } ],
            "premiumDetails": { "premiums": [ { "lob": "Home", "term": "12", "amount": "4744.64", "amountText": "Total Premium", "totalPremium": "4744.64" } ], "payments": [] },
            "homeCoveragePremiums": [
              { "code": "A", "name": "Dwelling", "limits": "$606,900", "amountText": "$4,751.00" },
              { "code": "B", "name": "OtherStructures", "limits": "$60,690", "amountText": "INCLUDED" },
              { "code": "C", "name": "PersonalProperty", "limits": "$364,140", "amountText": "INCLUDED" }
            ],
            "endorsementPremiums": [
              { "name": "IdentityTheft", "limits": "INCLUDED", "amountText": "$45" },
              { "name": "WaterBackup", "limits": "INCLUDED", "amountText": "$52.09" }
            ]
          }
        ],
        "alternateQuotes": []
      },
      {
        "scriptName": "Travelers Home",
        "carrier": { "id": 13, "name": "Travelers", "siteUrl": "", "smallImageUrl": "", "crossRefId": 13 },
        "execId": 1892138220,
        "hasError": false,
        "requestedQuotes": [
          {
            "quoteNumber": "0007684600833",
            "coverages": [ { "name": "Dwelling", "value": "606900" }, { "name": "PersonalLiability", "value": "500000" } ],
            "premiumDetails": { "premiums": [ { "lob": "Home", "term": "12", "amount": "5316.33", "amountText": "Paid-In-Full", "totalPremium": "5316.33" } ], "payments": [] },
            "homeCoveragePremiums": [
              { "code": "A", "name": "Dwelling", "limits": "606900", "amountText": "INCLUDED" }
            ],
            "endorsementPremiums": []
          }
        ],
        "alternateQuotes": []
      },
      {
        "scriptName": "Nationwide Insurance Home XML",
        "carrier": { "id": 348, "name": "Nationwide Insurance", "siteUrl": "", "smallImageUrl": "", "crossRefId": 348 },
        "execId": 1892138214,
        "hasError": true,
        "errorMessage": "Nationwide will not return a quote without additional underwriting information. Msg No. UP320.08",
        "requestedQuotes": [],
        "alternateQuotes": []
      }
    ]
  }
]
```

`tests/fixtures/applicant.sample.json`:

```json
{
  "id": 219851561,
  "firstName": "Alex",
  "lastName": "Sample",
  "dateOfBirth": "1949-11-18T00:00:00",
  "isCommercial": false,
  "primaryAddress": {
    "address1": "100 EXAMPLE RD", "unit": "", "address2": "",
    "city": "MOUNDS VIEW", "state": "MN", "county": "Ramsey", "postalCode": "55112"
  },
  "phoneNumbers": [ { "type": "Mobile", "number": "6125550100", "extension": "", "id": 0 } ],
  "emailAddresses": [],
  "contacts": [
    {
      "firstName": "Blake", "lastName": "Sample", "isCoApplicant": true,
      "relationship": { "value": 8, "name": "Spouse", "description": "Spouse" }
    }
  ],
  "assignedTo": { "id": 208937, "userName": "nia_nbetters", "name": "Nathan Betters", "organizationId": 62859 },
  "ratingState": "MN"
}
```

`tests/fixtures/recent-quotes.sample.json`:

```json
[
  {
    "applicantId": 219851561, "created": "2026-08-03T16:07:54.13", "applicationId": 199071915,
    "autoApplicantQuoteId": 513228997, "homeApplicantQuoteId": 513228998, "applicantQuoteId": 513228998,
    "lobs": "Auto, Home", "isManualQuote": false, "description": ""
  },
  {
    "applicantId": 219851561, "created": "2025-12-28T09:09:00.37", "applicationId": 85576023,
    "autoApplicantQuoteId": 488436332, "homeApplicantQuoteId": 0, "applicantQuoteId": 488436332,
    "lobs": "Auto", "isManualQuote": false, "description": ""
  }
]
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` → Expected: clean.

```bash
git add src/types.ts tests/fixtures/
git commit -m "feat: canonical CapturedRun types + scrubbed EZLynx fixtures"
```

---

### Task 4: Coverage summary renderer

**Files:**
- Create: `src/ezlynx/renderCoverage.ts`
- Test: `tests/renderCoverage.test.ts`

**Interfaces:**
- Produces: `renderCoverageSummary(quote: RawQuoteLike, lob: string): string` where

```ts
export interface RawQuoteLike {
  coverages?: { name: string; value: string }[];
  homeCoveragePremiums?: { code: string; name: string; limits: string; amountText: string }[];
  endorsementPremiums?: { name: string; limits: string; amountText: string }[];
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/renderCoverage.test.ts
import { describe, it, expect } from "vitest";
import { renderCoverageSummary } from "@/ezlynx/renderCoverage";

describe("renderCoverageSummary", () => {
  it("renders Home from homeCoveragePremiums then endorsementPremiums, three segments", () => {
    const out = renderCoverageSummary({
      homeCoveragePremiums: [
        { code: "A", name: "Dwelling", limits: "$606,900", amountText: "$4,751.00" },
        { code: "B", name: "OtherStructures", limits: "$60,690", amountText: "INCLUDED" }
      ],
      endorsementPremiums: [
        { name: "IdentityTheft", limits: "INCLUDED", amountText: "$45" }
      ]
    }, "Home");
    expect(out).toBe("Cov A: $606,900: $4,751.00\nCov B: $60,690: INCLUDED\nIdentityTheft: INCLUDED: $45");
  });

  it("renders Auto from coverages[], two segments", () => {
    const out = renderCoverageSummary({
      coverages: [ { name: "BI", value: "500 CSL" }, { name: "PD", value: "No Coverage" } ]
    }, "Auto");
    expect(out).toBe("BI: 500 CSL\nPD: No Coverage");
  });

  it("passes values through verbatim - no currency normalization", () => {
    for (const v of ["$606,900", "$606900", "606900", "1%", "BASIC+10K MED EXP"]) {
      const out = renderCoverageSummary({ coverages: [{ name: "X", value: v }] }, "Auto");
      expect(out).toBe(`X: ${v}`);
    }
  });

  it("falls back to coverages[] for Home when homeCoveragePremiums is empty", () => {
    const out = renderCoverageSummary({
      homeCoveragePremiums: [],
      coverages: [ { name: "Dwelling", value: "$606,900" } ]
    }, "Home");
    expect(out).toBe("Dwelling: $606,900");
  });

  it("truncates on a line boundary with trailing ellipsis near the 5000 cap", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ name: `Coverage${i}`, value: "x".repeat(20) }));
    const out = renderCoverageSummary({ coverages: many }, "Auto");
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("\n") || !out.includes("\u0000")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/ezlynx/renderCoverage.ts
const MAX = 5000;

export interface RawQuoteLike {
  coverages?: { name: string; value: string }[];
  homeCoveragePremiums?: { code: string; name: string; limits: string; amountText: string }[];
  endorsementPremiums?: { name: string; limits: string; amountText: string }[];
}

/** Renders the COVERAGE cell text. Values pass through VERBATIM (spec invariant). */
export function renderCoverageSummary(q: RawQuoteLike, lob: string): string {
  const lines: string[] = [];
  const isHome = lob.toLowerCase() === "home";
  if (isHome && (q.homeCoveragePremiums?.length ?? 0) > 0) {
    for (const c of q.homeCoveragePremiums!) lines.push(`Cov ${c.code}: ${c.limits}: ${c.amountText}`);
    for (const e of q.endorsementPremiums ?? []) lines.push(`${e.name}: ${e.limits}: ${e.amountText}`);
  } else {
    for (const c of q.coverages ?? []) lines.push(`${c.name}: ${c.value}`);
  }
  return capOnLineBoundary(lines, MAX);
}

function capOnLineBoundary(lines: string[], max: number): string {
  let out = "";
  for (const line of lines) {
    const next = out ? out + "\n" + line : line;
    if (next.length > max - 1) return out + "…";
    out = next;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ezlynx/renderCoverage.ts tests/renderCoverage.test.ts
git commit -m "feat: coverage summary renderer - verbatim values, line-boundary cap"
```

---

### Task 5: Quote-result normalizer

**Files:**
- Create: `src/ezlynx/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `renderCoverageSummary` (Task 4), types (Task 3), fixtures (Task 3).
- Produces:
  - `normalizeQuoteResult(raw: unknown, applicantQuoteIdByLob: Record<string, number>): { blocks: CapturedLobBlock[] }` — throws `NormalizeError` on shape violation.
  - `normalizeApplicant(raw: unknown): CapturedApplicant` — throws `NormalizeError`.
  - `normalizeRunList(raw: unknown): RunListItem[]`
  - `class NormalizeError extends Error { payloadSnippet: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeQuoteResult, normalizeApplicant, normalizeRunList, NormalizeError } from "@/ezlynx/normalize";
import quoteResult from "./fixtures/quote-result.sample.json";
import applicant from "./fixtures/applicant.sample.json";
import recentQuotes from "./fixtures/recent-quotes.sample.json";

const IDS = { Auto: 513228997, Home: 513228998 };

describe("normalizeQuoteResult", () => {
  const { blocks } = normalizeQuoteResult(quoteResult, IDS);

  it("produces one block per LOB with the right applicantQuoteId", () => {
    expect(blocks.map(b => b.lob)).toEqual(["Auto", "Home"]);
    expect(blocks[0]!.applicantQuoteId).toBe(513228997);
  });

  it("keys requested and alternate quotes on execId with suffixes", () => {
    const auto = blocks[0]!;
    const travelers = auto.quotes.filter(q => q.carrierEzlynxId === 13);
    expect(travelers.map(q => q.key).sort()).toEqual(["ezlynx:1892138218:alt0", "ezlynx:1892138218:req"]);
    expect(travelers.find(q => q.kind === "alternate")!.premium).toBe(1798.0);
  });

  it("handles null quoteNumber (Liberty) and duplicate quoteNumber across LOBs (Travelers)", () => {
    const liberty = blocks[0]!.quotes.find(q => q.carrierEzlynxId === 35)!;
    expect(liberty.quoteNumber).toBeNull();
    const travHome = blocks[1]!.quotes.find(q => q.carrierEzlynxId === 13)!;
    expect(travHome.quoteNumber).toBe("0007684600833"); // same number, different key
    expect(travHome.key).toBe("ezlynx:1892138220:req");
  });

  it("maps terms: Hartford 6mo, others 12mo", () => {
    const hartford = blocks[0]!.quotes.find(q => q.carrierEzlynxId === 692)!;
    expect(hartford.termMonths).toBe(6);
  });

  it("collects errored carriers into errors[], writes no quotes for them", () => {
    expect(blocks[0]!.errors).toEqual([
      { carrierName: "Stillwater Property & Casualty", message: expect.stringContaining("FNI0233") }
    ]);
    expect(blocks[1]!.errors.some(e => e.carrierName === "Nationwide Insurance")).toBe(true);
    expect(blocks[0]!.quotes.some(q => q.carrierEzlynxId === 404)).toBe(false);
  });

  it("renders Home coverage from homeCoveragePremiums + endorsements", () => {
    const liberty = blocks[1]!.quotes.find(q => q.carrierEzlynxId === 35)!;
    expect(liberty.coverageSummary).toContain("Cov A: $606,900: $4,751.00");
    expect(liberty.coverageSummary).toContain("IdentityTheft: INCLUDED: $45");
  });

  it("preserves per-quote raw context", () => {
    const q = blocks[0]!.quotes[0]!;
    expect(q.raw).toMatchObject({ lob: "Auto", execId: expect.any(Number) });
  });

  it("throws NormalizeError with payload snippet on shape violation", () => {
    expect(() => normalizeQuoteResult({ not: "an array" }, IDS)).toThrow(NormalizeError);
    try { normalizeQuoteResult({ not: "an array" }, IDS); } catch (e) {
      expect((e as NormalizeError).payloadSnippet).toContain("not");
    }
  });
});

describe("normalizeApplicant", () => {
  it("extracts identity, address, phones, co-applicants", () => {
    const a = normalizeApplicant(applicant);
    expect(a).toEqual({
      ezlynxApplicantId: 219851561,
      firstName: "Alex", lastName: "Sample",
      dateOfBirth: "1949-11-18",
      address: { street: "100 EXAMPLE RD", city: "MOUNDS VIEW", state: "MN", postalCode: "55112" },
      phones: ["6125550100"], emails: [],
      coApplicants: [{ firstName: "Blake", lastName: "Sample", relationship: "Spouse" }],
      isCommercial: false
    });
  });
});

describe("normalizeRunList", () => {
  it("produces one item per run with per-LOB quote ids", () => {
    const items = normalizeRunList(recentQuotes);
    expect(items[0]!.quoteIdsByLob).toEqual([
      { lob: "Auto", applicantQuoteId: 513228997 },
      { lob: "Home", applicantQuoteId: 513228998 }
    ]);
    expect(items[1]!.quoteIdsByLob).toEqual([{ lob: "Auto", applicantQuoteId: 488436332 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/ezlynx/normalize.ts
import { z } from "zod";
import type { CapturedApplicant, CapturedLobBlock, CapturedQuote, RunListItem } from "@/types";
import { renderCoverageSummary } from "./renderCoverage";

export class NormalizeError extends Error {
  payloadSnippet: string;
  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "NormalizeError";
    this.payloadSnippet = JSON.stringify(payload)?.slice(0, 2000) ?? "";
  }
}

const RawQuote = z.object({
  quoteNumber: z.string().nullish(),
  coverages: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
  premiumDetails: z.object({
    premiums: z.array(z.object({ term: z.string().nullish(), totalPremium: z.string().nullish() }))
  }).nullish(),
  homeCoveragePremiums: z.array(z.object({ code: z.string(), name: z.string(), limits: z.string(), amountText: z.string() })).nullish(),
  endorsementPremiums: z.array(z.object({ name: z.string(), limits: z.string(), amountText: z.string() })).nullish()
}).passthrough();

const RawScriptResult = z.object({
  scriptName: z.string(),
  carrier: z.object({ id: z.number(), name: z.string() }).passthrough(),
  execId: z.number(),
  hasError: z.boolean(),
  errorMessage: z.string().nullish(),
  requestedQuotes: z.array(RawQuote).nullish(),
  alternateQuotes: z.array(RawQuote).nullish()
}).passthrough();

const RawLobBlock = z.object({
  lob: z.string(),
  scriptResults: z.array(RawScriptResult)
}).passthrough();

const RawQuoteResult = z.array(RawLobBlock);

function parsePremium(q: z.infer<typeof RawQuote>): { premium: number | null; termMonths: number | null } {
  const p = q.premiumDetails?.premiums?.[0];
  const premium = p?.totalPremium != null ? Number(p.totalPremium) : null;
  const t = p?.term != null ? Number(p.term) : null;
  return {
    premium: premium != null && Number.isFinite(premium) ? premium : null,
    termMonths: t === 6 || t === 12 ? t : null
  };
}

export function normalizeQuoteResult(
  raw: unknown,
  applicantQuoteIdByLob: Record<string, number>
): { blocks: CapturedLobBlock[] } {
  const parsed = RawQuoteResult.safeParse(raw);
  if (!parsed.success) throw new NormalizeError(`quote-result shape: ${parsed.error.message}`, raw);

  const blocks: CapturedLobBlock[] = parsed.data.map(block => {
    const quotes: CapturedQuote[] = [];
    const errors: { carrierName: string; message: string }[] = [];
    for (const s of block.scriptResults) {
      if (s.hasError) {
        errors.push({ carrierName: s.carrier.name, message: s.errorMessage ?? "Carrier returned an error" });
        continue;
      }
      const mk = (q: z.infer<typeof RawQuote>, kind: "requested" | "alternate", i: number): CapturedQuote => {
        const { premium, termMonths } = parsePremium(q);
        return {
          key: kind === "requested" ? `ezlynx:${s.execId}:req` : `ezlynx:${s.execId}:alt${i}`,
          kind,
          carrierEzlynxId: s.carrier.id,
          carrierName: s.carrier.name,
          quoteNumber: q.quoteNumber ?? null,
          premium,
          termMonths,
          coverageSummary: renderCoverageSummary(q, block.lob),
          raw: { lob: block.lob, scriptName: s.scriptName, carrier: s.carrier, execId: s.execId, kind, quote: q }
        };
      };
      (s.requestedQuotes ?? []).forEach(q => quotes.push(mk(q, "requested", 0)));
      (s.alternateQuotes ?? []).forEach((q, i) => quotes.push(mk(q, "alternate", i)));
    }
    return { lob: block.lob, applicantQuoteId: applicantQuoteIdByLob[block.lob] ?? 0, quotes, errors };
  });

  return { blocks };
}

const RawApplicant = z.object({
  id: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullish(),
  isCommercial: z.boolean().nullish(),
  primaryAddress: z.object({
    address1: z.string(), city: z.string(), state: z.string(), postalCode: z.string()
  }).passthrough().nullish(),
  phoneNumbers: z.array(z.object({ number: z.string() }).passthrough()).nullish(),
  emailAddresses: z.array(z.object({ emailAddress: z.string() }).passthrough().or(z.string())).nullish(),
  contacts: z.array(z.object({
    firstName: z.string(), lastName: z.string(),
    relationship: z.object({ name: z.string() }).passthrough().nullish()
  }).passthrough()).nullish()
}).passthrough();

export function normalizeApplicant(raw: unknown): CapturedApplicant {
  const p = RawApplicant.safeParse(raw);
  if (!p.success) throw new NormalizeError(`applicant shape: ${p.error.message}`, raw);
  const a = p.data;
  return {
    ezlynxApplicantId: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    dateOfBirth: a.dateOfBirth ? a.dateOfBirth.slice(0, 10) : null,
    address: a.primaryAddress
      ? { street: a.primaryAddress.address1, city: a.primaryAddress.city, state: a.primaryAddress.state, postalCode: a.primaryAddress.postalCode }
      : null,
    phones: (a.phoneNumbers ?? []).map(pn => pn.number),
    emails: (a.emailAddresses ?? []).map(e => (typeof e === "string" ? e : e.emailAddress)),
    coApplicants: (a.contacts ?? []).map(c => ({
      firstName: c.firstName, lastName: c.lastName, relationship: c.relationship?.name ?? ""
    })),
    isCommercial: a.isCommercial ?? false
  };
}

const RawRunRow = z.object({
  applicantId: z.number(),
  created: z.string(),
  applicationId: z.number(),
  autoApplicantQuoteId: z.number().nullish(),
  homeApplicantQuoteId: z.number().nullish(),
  lobs: z.string().nullish(),
  description: z.string().nullish()
}).passthrough();

export function normalizeRunList(raw: unknown): RunListItem[] {
  const p = z.array(RawRunRow).safeParse(raw);
  if (!p.success) throw new NormalizeError(`run-list shape: ${p.error.message}`, raw);
  return p.data.map(r => {
    const quoteIdsByLob: { lob: string; applicantQuoteId: number }[] = [];
    if (r.autoApplicantQuoteId) quoteIdsByLob.push({ lob: "Auto", applicantQuoteId: r.autoApplicantQuoteId });
    if (r.homeApplicantQuoteId) quoteIdsByLob.push({ lob: "Home", applicantQuoteId: r.homeApplicantQuoteId });
    return {
      applicationId: r.applicationId,
      applicantId: r.applicantId,
      created: r.created,
      lobs: r.lobs ?? quoteIdsByLob.map(q => q.lob).join(", "),
      quoteIdsByLob,
      description: r.description ?? ""
    };
  });
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → Expected: all normalize + renderCoverage tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ezlynx/normalize.ts tests/normalize.test.ts
git commit -m "feat: EZLynx normalizers - quote-result, applicant, run list"
```

---

### Task 6: EZLynx client + content-script bridge

**Files:**
- Create: `src/config/endpoints.json`
- Create: `src/ezlynx/client.ts`
- Modify: `src/ezlynx/content.ts` (replace placeholder)
- Create: `src/messages.ts`
- Test: `tests/ezlynxClient.test.ts`

**Interfaces:**
- Consumes: normalizers (Task 5).
- Produces:
  - `src/messages.ts` message contract (used by worker Task 11 and panel Tasks 12–15):

```ts
export type BridgeRequest =
  | { type: "ezlynx/getContext" }                                   // → { applicantId: number | null }
  | { type: "ezlynx/listRuns"; applicantId: number }                // → RunListItem[]
  | { type: "ezlynx/captureRun"; applicantId: number; run: RunListItem }; // → CapturedRun

export type PanelRequest =
  | { type: "panel/getEzlynxContext" }
  | { type: "panel/listRuns"; applicantId: number }
  | { type: "panel/captureRun"; applicantId: number; run: RunListItem }
  | { type: "panel/searchAccounts"; name: string; postalCode: string | null }
  | { type: "panel/getOpportunities"; accountId: string }
  | { type: "panel/getCarriers" }
  | { type: "panel/commit"; payload: CommitPayload }
  | { type: "env/list" } | { type: "env/setActive"; id: string } | { type: "auth/signIn" };

export interface BridgeResponse<T = unknown> { ok: true; data: T } 
export interface BridgeError { ok: false; error: string; kind: "normalize" | "session" | "auth" | "http" | "unknown"; detail?: string }
export type Res<T> = BridgeResponse<T> | BridgeError;
```

  - `fetchRunList(applicantId)`, `fetchCapturedRun(applicantId, run)` in `client.ts` (called only from the content script).

- [ ] **Step 1: Write `src/config/endpoints.json`**

```json
{
  "recentQuotes": "/RatingApi/api/quote-result/recent-quotes-for-applicant/{applicantId}",
  "agencyQuotes": "/RatingApi/v1/completed-quotes/agency",
  "applicant": "/RatingApi/v1/applicant/{applicantId}",
  "quoteResult": "/RatingApi/api/quote-result/{applicantQuoteId}",
  "applicantUrlPattern": "/web/account/(\\d+)/"
}
```

- [ ] **Step 2: Write the failing test** (client is testable by injecting fetch)

```ts
// tests/ezlynxClient.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchCapturedRun, EzlynxSessionError } from "@/ezlynx/client";
import quoteResult from "./fixtures/quote-result.sample.json";
import applicant from "./fixtures/applicant.sample.json";

const run = {
  applicationId: 199071915, applicantId: 219851561, created: "2026-08-03T16:07:54.13",
  lobs: "Auto, Home", description: "",
  quoteIdsByLob: [
    { lob: "Auto", applicantQuoteId: 513228997 },
    { lob: "Home", applicantQuoteId: 513228998 }
  ]
};

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("fetchCapturedRun", () => {
  it("calls applicant + one quote-result per distinct id, merges blocks", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/applicant/")) return okJson(applicant);
      if (url.includes("/quote-result/513228997")) return okJson(quoteResult);
      if (url.includes("/quote-result/513228998")) return okJson(quoteResult);
      throw new Error("unexpected url " + url);
    });
    const captured = await fetchCapturedRun(219851561, run, fetcher as never);
    expect(captured.applicant.lastName).toBe("Sample");
    expect(captured.blocks.map(b => b.lob).sort()).toEqual(["Auto", "Home"]);
    // both LOBs came from one payload → quote-result fetched once per distinct body needed
    expect(fetcher.mock.calls.filter(c => (c[0] as string).includes("quote-result")).length).toBeLessThanOrEqual(2);
  });

  it("throws EzlynxSessionError on 401/302-to-login", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as Response));
    await expect(fetchCapturedRun(219851561, run, fetcher as never)).rejects.toThrow(EzlynxSessionError);
  });
});
```

- [ ] **Step 3: Run to verify failure**, then implement

```ts
// src/ezlynx/client.ts
import endpoints from "@/config/endpoints.json";
import { normalizeApplicant, normalizeQuoteResult, normalizeRunList } from "./normalize";
import type { CapturedRun, RunListItem } from "@/types";

export class EzlynxSessionError extends Error {
  constructor() { super("EZLynx session expired or unauthorized"); this.name = "EzlynxSessionError"; }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (url, init) => fetch(url, { credentials: "include", ...init });

async function getJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher(url);
  if (res.status === 401 || res.status === 403 || res.status === 302) throw new EzlynxSessionError();
  if (!res.ok) throw new Error(`EZLynx ${res.status} for ${url}`);
  return res.json();
}

export async function fetchRunList(applicantId: number, fetcher: Fetcher = defaultFetcher): Promise<RunListItem[]> {
  const url = endpoints.recentQuotes.replace("{applicantId}", String(applicantId));
  return normalizeRunList(await getJson(url, fetcher));
}

export async function fetchCapturedRun(
  applicantId: number,
  run: RunListItem,
  fetcher: Fetcher = defaultFetcher
): Promise<CapturedRun> {
  const applicant = normalizeApplicant(
    await getJson(endpoints.applicant.replace("{applicantId}", String(applicantId)), fetcher)
  );

  // one quote-result payload can carry multiple LOB blocks; fetch each distinct id,
  // then keep the block whose LOB the id claims (dedup when both ids return both blocks)
  const idByLob: Record<string, number> = {};
  for (const q of run.quoteIdsByLob) idByLob[q.lob] = q.applicantQuoteId;

  const distinctIds = [...new Set(run.quoteIdsByLob.map(q => q.applicantQuoteId))];
  const seen = new Set<string>();
  const blocks = [];
  for (const id of distinctIds) {
    const url = endpoints.quoteResult.replace("{applicantQuoteId}", String(id));
    const { blocks: got } = normalizeQuoteResult(await getJson(url, fetcher), idByLob);
    for (const b of got) {
      if (!seen.has(b.lob)) { seen.add(b.lob); blocks.push(b); }
    }
  }

  return {
    applicant,
    openApplicationId: run.applicationId,
    capturedAt: new Date().toISOString(),
    blocks
  };
}

export function applicantIdFromUrl(href: string): number | null {
  const m = new RegExp(endpoints.applicantUrlPattern).exec(href);
  return m?.[1] ? Number(m[1]) : null;
}
```

`src/messages.ts`: exactly the Interfaces block above (with `CommitPayload` imported from `@/crm/mapping` — add `import type { CommitPayload } from "@/crm/mapping";` **after Task 10 defines it; until then declare** `export interface CommitPayload { placeholder?: never }` **and replace in Task 10**).

`src/ezlynx/content.ts`:

```ts
import { fetchRunList, fetchCapturedRun, applicantIdFromUrl, EzlynxSessionError } from "./client";
import { NormalizeError } from "./normalize";
import type { BridgeRequest, Res } from "@/messages";

chrome.runtime.onMessage.addListener((msg: BridgeRequest, _sender, sendResponse: (r: Res<unknown>) => void) => {
  (async () => {
    try {
      switch (msg.type) {
        case "ezlynx/getContext":
          return sendResponse({ ok: true, data: { applicantId: applicantIdFromUrl(location.href) } });
        case "ezlynx/listRuns":
          return sendResponse({ ok: true, data: await fetchRunList(msg.applicantId) });
        case "ezlynx/captureRun":
          return sendResponse({ ok: true, data: await fetchCapturedRun(msg.applicantId, msg.run) });
      }
    } catch (e) {
      if (e instanceof EzlynxSessionError) return sendResponse({ ok: false, error: "EZLynx session expired — sign in on the EZLynx tab and retry.", kind: "session" });
      if (e instanceof NormalizeError) return sendResponse({ ok: false, error: "Couldn't read EZLynx results — the extension needs an update.", kind: "normalize", detail: e.payloadSnippet });
      return sendResponse({ ok: false, error: String(e), kind: "unknown" });
    }
  })();
  return true; // async response
});
```

- [ ] **Step 4: Run tests + build** — `npm test && npm run build` → Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/endpoints.json src/ezlynx/client.ts src/ezlynx/content.ts src/messages.ts tests/ezlynxClient.test.ts
git commit -m "feat: EZLynx client + content-script bridge with typed message contract"
```

---

### Task 7: Environment registry

**Files:**
- Create: `src/crm/environments.ts`
- Create: `src/config/appConfig.ts`
- Test: `tests/environments.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CrmEnvironment { id: string; name: string; orgUrl: string; color: "green" | "red" | "blue" | "orange" }
export async function getEnvironments(): Promise<CrmEnvironment[]>
export async function saveEnvironments(envs: CrmEnvironment[]): Promise<void>
export async function getActiveEnvironment(): Promise<CrmEnvironment>   // falls back to first
export async function setActiveEnvironment(id: string): Promise<void>  // ALSO clears pinned CRM selections (storage key "panel/selections")
```

- `src/config/appConfig.ts`: `export const APP_CONFIG = { clientId: "<from Task 1 README>", authority: "https://login.microsoftonline.com/organizations" }`.

- [ ] **Step 1: Write the failing test.** chrome.storage is absent in Node — stub it:

```ts
// tests/environments.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o); }),
      remove: vi.fn(async (k: string) => { delete store[k]; })
    },
    session: {
      get: vi.fn(async (k: string) => ({ [k]: store[`s:${k}`] })),
      set: vi.fn(async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) store[`s:${k}`] = v; }),
      remove: vi.fn(async (k: string) => { delete store[`s:${k}`]; })
    }
  }
});

import { getEnvironments, getActiveEnvironment, setActiveEnvironment } from "@/crm/environments";

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe("environments", () => {
  it("ships DEV as the default and default-active", async () => {
    const envs = await getEnvironments();
    expect(envs[0]).toMatchObject({ id: "dev", name: "DEV", orgUrl: "https://agentcrmdev.crm.dynamics.com", color: "green" });
    expect((await getActiveEnvironment()).id).toBe("dev");
  });

  it("setActiveEnvironment persists and clears pinned selections", async () => {
    store["panel/selections"] = { accountId: "abc" };
    await setActiveEnvironment("dev");
    expect(store["env/active"]).toBe("dev");
    expect(store["panel/selections"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

```ts
// src/crm/environments.ts
export interface CrmEnvironment {
  id: string; name: string; orgUrl: string; color: "green" | "red" | "blue" | "orange";
}

export const DEFAULT_ENVIRONMENTS: CrmEnvironment[] = [
  { id: "dev", name: "DEV", orgUrl: "https://agentcrmdev.crm.dynamics.com", color: "green" }
];

export async function getEnvironments(): Promise<CrmEnvironment[]> {
  const { "env/list": list } = await chrome.storage.local.get("env/list");
  return (list as CrmEnvironment[] | undefined)?.length ? (list as CrmEnvironment[]) : DEFAULT_ENVIRONMENTS;
}

export async function saveEnvironments(envs: CrmEnvironment[]): Promise<void> {
  await chrome.storage.local.set({ "env/list": envs });
}

export async function getActiveEnvironment(): Promise<CrmEnvironment> {
  const envs = await getEnvironments();
  const { "env/active": id } = await chrome.storage.local.get("env/active");
  return envs.find(e => e.id === id) ?? envs[0]!;
}

export async function setActiveEnvironment(id: string): Promise<void> {
  await chrome.storage.local.set({ "env/active": id });
  // record IDs are meaningless in another org (spec: Environments)
  await chrome.storage.local.remove("panel/selections");
}
```

`src/config/appConfig.ts` as in Interfaces (paste the real client ID from `spike/README.md`).

- [ ] **Step 3: Run to verify pass** — `npm test`.

- [ ] **Step 4: Commit**

```bash
git add src/crm/environments.ts src/config/appConfig.ts tests/environments.test.ts
git commit -m "feat: switchable environment registry with DEV default"
```

---

### Task 8: PKCE auth with per-org token cache

**Files:**
- Create: `src/crm/auth.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `APP_CONFIG` (Task 7), spike constants (Task 1).
- Produces:

```ts
export class AuthRequiredError extends Error {}   // panel shows sign-in button on this
export async function getAccessToken(orgUrl: string, opts?: { interactive?: boolean }): Promise<string>
// cache key: `token:{orgUrl}` in chrome.storage.session → { accessToken, refreshToken, expiresAt }
// order: cached-unexpired → refresh_token grant → (interactive ? launchWebAuthFlow : throw AuthRequiredError)
export function pkcePair(): Promise<{ verifier: string; challenge: string }>   // exported for tests
export function buildAuthorizeUrl(orgUrl: string, redirectUri: string, challenge: string): string
```

- [ ] **Step 1: Write the failing tests** (pure parts + cache/refresh logic with mocked fetch; reuse the chrome stub pattern from Task 7 — extract it to `tests/helpers/chromeStub.ts` and import in both)

```ts
// tests/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";
import { pkcePair, buildAuthorizeUrl, getAccessToken, AuthRequiredError, __store } from "@/crm/auth";

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
```

- [ ] **Step 2: Run to verify failure**, then implement

```ts
// src/crm/auth.ts
import { APP_CONFIG } from "@/config/appConfig";

export class AuthRequiredError extends Error {
  constructor() { super("Interactive sign-in required"); this.name = "AuthRequiredError"; }
}

interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: number }

/** Per-org token cache over chrome.storage.session. Exported for tests. */
export const __store = {
  async get(orgUrl: string): Promise<TokenSet | null> {
    const key = `token:${orgUrl}`;
    const o = await chrome.storage.session.get(key);
    return (o[key] as TokenSet | undefined) ?? null;
  },
  async set(orgUrl: string, t: TokenSet): Promise<void> {
    await chrome.storage.session.set({ [`token:${orgUrl}`]: t });
  },
  async clear(): Promise<void> { /* test helper; per-key removal in prod paths */ }
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
```

For the test helper, make `__store.clear()` actually clear the stubbed backing map (the chrome stub from Task 7 shares state; simplest: `clear` iterates `chrome.storage.session.remove` over known keys, or the stub exposes a reset — either is fine as long as the test passes deterministically).

- [ ] **Step 3: Run to verify pass** — `npm test`.

- [ ] **Step 4: Commit**

```bash
git add src/crm/auth.ts tests/auth.test.ts tests/helpers/chromeStub.ts
git commit -m "feat: hand-rolled PKCE auth with per-org session token cache"
```

---

### Task 9: Dataverse client

**Files:**
- Create: `src/crm/dataverse.ts`
- Test: `tests/dataverse.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` (Task 8), `CrmEnvironment` (Task 7).
- Produces:

```ts
export interface AccountMatch { accountId: string; name: string; city: string | null; postalCode: string | null; openOppCount: number }
export interface OppSummary { opportunityId: string; name: string; lobId: string | null; lobName: string | null; desiredEffectiveDate: string | null }
export interface CarrierRow { carrierId: string; name: string }
export interface BatchItemResult { key: string; status: number; error: string | null }

export class CrmAccessError extends Error { orgUrl: string }   // 401/403 → panel names the environment

export async function searchAccounts(env: CrmEnvironment, name: string, postalCode: string | null): Promise<AccountMatch[]>
export async function getOpenOpportunities(env: CrmEnvironment, accountId: string): Promise<OppSummary[]>
export async function getCarriers(env: CrmEnvironment): Promise<CarrierRow[]>
export async function getQuotingMethodId(env: CrmEnvironment, nameContains: string): Promise<string | null>
export async function getExistingQuoteStatuses(env: CrmEnvironment, keys: string[]): Promise<Map<string, number>>  // key → iacrm_premium_status
export async function executeBatch(env: CrmEnvironment, ops: { key: string; method: "PATCH"; url: string; body: unknown }[]): Promise<BatchItemResult[]>
export function altKeyUrl(key: string): string  // "iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='...')" with '' escaping
```

- [ ] **Step 1: Write the failing tests** (mock `fetch` + mock `getAccessToken` via `vi.mock`)

```ts
// tests/dataverse.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/chromeStub";

vi.mock("@/crm/auth", () => ({
  getAccessToken: vi.fn(async () => "TOKEN"),
  AuthRequiredError: class extends Error {}
}));

import { altKeyUrl, executeBatch, getExistingQuoteStatuses, searchAccounts, CrmAccessError } from "@/crm/dataverse";

const ENV = { id: "dev", name: "DEV", orgUrl: "https://org.crm.dynamics.com", color: "green" as const };

beforeEach(() => vi.restoreAllMocks());

describe("altKeyUrl", () => {
  it("addresses the alternate key and escapes single quotes", () => {
    expect(altKeyUrl("ezlynx:1:req")).toBe("iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='ezlynx:1:req')");
    expect(altKeyUrl("o'brien")).toContain("o''brien");
  });
});

describe("executeBatch", () => {
  it("builds multipart batch with continue-on-error and maps per-part statuses by order", async () => {
    const bodyText = [
      "--batchresponse_x", "Content-Type: application/http", "",
      "HTTP/1.1 204 No Content", "", "",
      "--batchresponse_x", "Content-Type: application/http", "",
      "HTTP/1.1 400 Bad Request", "Content-Type: application/json", "",
      JSON.stringify({ error: { message: "lookup invalid" } }),
      "--batchresponse_x--"
    ].join("\r\n");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://org.crm.dynamics.com/api/data/v9.2/$batch");
      expect((init.headers as Record<string, string>)["Prefer"]).toContain("odata.continue-on-error");
      expect(init.body as string).toContain("PATCH https://org.crm.dynamics.com/api/data/v9.2/iacrm_quotes(");
      return { ok: true, status: 200, text: async () => bodyText, headers: new Headers() } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await executeBatch(ENV, [
      { key: "k1", method: "PATCH", url: altKeyUrl("k1"), body: { a: 1 } },
      { key: "k2", method: "PATCH", url: altKeyUrl("k2"), body: { a: 2 } }
    ]);
    expect(results).toEqual([
      { key: "k1", status: 204, error: null },
      { key: "k2", status: 400, error: expect.stringContaining("lookup invalid") }
    ]);
  });

  it("retries once on 429 honoring Retry-After", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, headers: new Headers({ "Retry-After": "0" }), text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => "--b--\r\n", headers: new Headers() } as unknown as Response;
    }));
    await executeBatch(ENV, []);
    expect(calls).toBe(2);
  });
});

describe("CrmAccessError", () => {
  it("raises on 403 with the org attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), headers: new Headers() } as unknown as Response)));
    await expect(searchAccounts(ENV, "Sample", null)).rejects.toThrow(CrmAccessError);
  });
});

describe("getExistingQuoteStatuses", () => {
  it("or-chains keys and maps status by amsexternalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(decodeURIComponent(url)).toContain("iacrm_amsexternalid eq 'ezlynx:1:req' or iacrm_amsexternalid eq 'ezlynx:2:req'");
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ value: [{ iacrm_amsexternalid: "ezlynx:1:req", iacrm_premium_status: 738590002 }] })
      } as unknown as Response;
    }));
    const m = await getExistingQuoteStatuses(ENV, ["ezlynx:1:req", "ezlynx:2:req"]);
    expect(m.get("ezlynx:1:req")).toBe(738590002);
    expect(m.has("ezlynx:2:req")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

```ts
// src/crm/dataverse.ts
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

export function altKeyUrl(key: string): string {
  return `iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='${esc(key)}')`;
}

export async function searchAccounts(env: CrmEnvironment, name: string, postalCode: string | null): Promise<AccountMatch[]> {
  const q = `accounts?$select=name,accountid,address1_city,address1_postalcode&$filter=contains(name,'${esc(name)}')&$top=10`;
  const { value } = await dvJson<{ value: Record<string, string | null>[] }>(env, q);
  const accounts = value.map(a => ({
    accountId: a["accountid"]!, name: a["name"] ?? "", city: a["address1_city"], postalCode: a["address1_postalcode"], openOppCount: 0
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
    lobId: o["_iacrm_lineofbusinessid_value"],
    lobName: o["_iacrm_lineofbusinessid_value@OData.Community.Display.V1.FormattedValue"] ?? null,
    desiredEffectiveDate: o["iacrm_desiredeffectivedate"]
  }));
}

export async function getCarriers(env: CrmEnvironment): Promise<CarrierRow[]> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env, `iacrm_carriers?$select=iacrm_name,iacrm_carrierid&$filter=statecode eq 0&$orderby=iacrm_name`
  );
  return value.map(c => ({ carrierId: c["iacrm_carrierid"]!, name: c["iacrm_name"] ?? "" }));
}

export async function getQuotingMethodId(env: CrmEnvironment, nameContains: string): Promise<string | null> {
  const { value } = await dvJson<{ value: Record<string, string>[] }>(
    env, `iacrm_quotingmethods?$select=iacrm_quotingmethodid&$filter=contains(iacrm_name,'${esc(nameContains)}')&$top=1`
  );
  return value[0]?.["iacrm_quotingmethodid"] ?? null;
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
```

- [ ] **Step 3: Run to verify pass** — `npm test`.

- [ ] **Step 4: Commit**

```bash
git add src/crm/dataverse.ts tests/dataverse.test.ts
git commit -m "feat: Dataverse client - search, batch upsert, 429 retry, access errors"
```

---

### Task 10: Field mapping

**Files:**
- Create: `src/crm/mapping.ts`
- Modify: `src/messages.ts` (replace placeholder `CommitPayload`)
- Test: `tests/mapping.test.ts`

**Interfaces:**
- Consumes: `CapturedRun`/`CapturedQuote` (Task 3), `altKeyUrl` (Task 9).
- Produces:

```ts
export interface BlockSelection { opportunityId: string; lineOfBusinessId: string | null; desiredEffectiveDate: string | null }
export interface CommitPayload {
  run: CapturedRun;
  accountId: string;
  quotingMethodId: string | null;
  blockSelections: Record<string, BlockSelection>;      // keyed by lob; absent lob = skip block
  carrierMap: Record<number, string | null>;            // ezlynx carrier.id → iacrm_carrier GUID
  selectedKeys: string[];                               // quote keys the agent left checked
}
export function buildQuoteOps(payload: CommitPayload, existingStatuses: Map<string, number>):
  { key: string; method: "PATCH"; url: string; body: Record<string, unknown> }[]
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mapping.test.ts
import { describe, it, expect } from "vitest";
import { buildQuoteOps, type CommitPayload } from "@/crm/mapping";
import type { CapturedRun } from "@/types";

const run: CapturedRun = {
  applicant: {
    ezlynxApplicantId: 219851561, firstName: "Alex", lastName: "Sample", dateOfBirth: "1949-11-18",
    address: null, phones: [], emails: [], coApplicants: [], isCommercial: false
  },
  openApplicationId: 199071915,
  capturedAt: "2026-08-15T12:00:00Z",
  blocks: [
    {
      lob: "Auto", applicantQuoteId: 513228997,
      quotes: [
        { key: "ezlynx:1:req", kind: "requested", carrierEzlynxId: 13, carrierName: "Travelers",
          quoteNumber: "Q1", premium: 2273, termMonths: 12, coverageSummary: "BI: 500 CSL", raw: { x: 1 } },
        { key: "ezlynx:1:alt0", kind: "alternate", carrierEzlynxId: 13, carrierName: "Travelers",
          quoteNumber: "Q1", premium: 1798, termMonths: 12, coverageSummary: "BI: 500 CSL", raw: { x: 2 } },
        { key: "ezlynx:2:req", kind: "requested", carrierEzlynxId: 999, carrierName: "Unknown Mutual",
          quoteNumber: null, premium: 1500, termMonths: 6, coverageSummary: "", raw: {} }
      ],
      errors: []
    },
    {
      lob: "Home", applicantQuoteId: 513228998,
      quotes: [
        { key: "ezlynx:3:req", kind: "requested", carrierEzlynxId: 35, carrierName: "Liberty",
          quoteNumber: null, premium: 4744.64, termMonths: 12, coverageSummary: "Cov A: $606,900: $4,751.00", raw: {} }
      ],
      errors: []
    }
  ]
};

const payload: CommitPayload = {
  run,
  accountId: "AAA-1",
  quotingMethodId: "QM-1",
  blockSelections: {
    Auto: { opportunityId: "OPP-AUTO", lineOfBusinessId: "LOB-AUTO", desiredEffectiveDate: "2026-09-01" }
    // Home intentionally unpinned → skipped
  },
  carrierMap: { 13: "CAR-TRAV", 999: null },
  selectedKeys: ["ezlynx:1:req", "ezlynx:1:alt0", "ezlynx:2:req", "ezlynx:3:req"]
};

describe("buildQuoteOps", () => {
  const ops = buildQuoteOps(payload, new Map());

  it("emits one op per selected quote in pinned blocks only (Home skipped)", () => {
    expect(ops.map(o => o.key).sort()).toEqual(["ezlynx:1:alt0", "ezlynx:1:req", "ezlynx:2:req"]);
  });

  it("addresses the alternate key and stamps provider/source/status", () => {
    const op = ops.find(o => o.key === "ezlynx:1:req")!;
    expect(op.url).toBe("iacrm_quotes(iacrm_provider='EZLynx',iacrm_amsexternalid='ezlynx:1:req')");
    expect(op.body).toMatchObject({
      iacrm_provider: "EZLynx",
      iacrm_amsexternalid: "ezlynx:1:req",
      iacrm_sourcetype: 100000002,
      iacrm_status: 738590002,
      iacrm_premium_status: 738590000,
      iacrm_premium: 2273,
      iacrm_term: 738590205,
      iacrm_effectivedate: "2026-09-01",
      iacrm_expirationdate: "2027-09-01",
      "iacrm_accountid@odata.bind": "/accounts(AAA-1)",
      "iacrm_opportunityid@odata.bind": "/opportunities(OPP-AUTO)",
      "iacrm_lineofbusinessid@odata.bind": "/iacrm_lineofbusinesses(LOB-AUTO)",
      "iacrm_carrierid@odata.bind": "/iacrm_carriers(CAR-TRAV)",
      "iacrm_quotingmethodid@odata.bind": "/iacrm_quotingmethods(QM-1)"
    });
    expect(op.body["iacrm_quotelink"]).toBe(
      "https://app.ezlynx.com/web/account/219851561/rating/quote-results/199071915/513228997"
    );
  });

  it("names quotes {Carrier} - {LOB} - {EffectiveDate}, alternates suffixed", () => {
    expect(ops.find(o => o.key === "ezlynx:1:req")!.body["iacrm_quote_name"]).toBe("Travelers – Auto – 2026-09-01");
    expect(ops.find(o => o.key === "ezlynx:1:alt0")!.body["iacrm_quote_name"]).toBe("Travelers – Auto – 2026-09-01 – Alt");
  });

  it("6-month term maps to 738590203; unmatched carrier omits the bind", () => {
    const op = ops.find(o => o.key === "ezlynx:2:req")!;
    expect(op.body["iacrm_term"]).toBe(738590203);
    expect(op.body["iacrm_carrierid@odata.bind"]).toBeUndefined();
    expect(op.body["iacrm_expirationdate"]).toBe("2027-03-01");
  });

  it("never writes submission fields", () => {
    for (const op of ops) {
      expect(Object.keys(op.body).some(k => k.startsWith("iacrm_submission"))).toBe(false);
    }
  });

  it("omits iacrm_premium_status when the existing row is Firm", () => {
    const opsWithFirm = buildQuoteOps(payload, new Map([["ezlynx:1:req", 738590002]]));
    const firm = opsWithFirm.find(o => o.key === "ezlynx:1:req")!;
    expect("iacrm_premium_status" in firm.body).toBe(false);
    const notFirm = opsWithFirm.find(o => o.key === "ezlynx:1:alt0")!;
    expect(notFirm.body["iacrm_premium_status"]).toBe(738590000);
  });

  it("serializes rawpayload as JSON and honors deselection", () => {
    const fewer = buildQuoteOps({ ...payload, selectedKeys: ["ezlynx:1:req"] }, new Map());
    expect(fewer).toHaveLength(1);
    expect(typeof buildQuoteOps(payload, new Map())[0]!.body["iacrm_rawpayload"]).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

```ts
// src/crm/mapping.ts
import type { CapturedRun } from "@/types";
import { altKeyUrl } from "./dataverse";

export interface BlockSelection {
  opportunityId: string;
  lineOfBusinessId: string | null;
  desiredEffectiveDate: string | null;
}

export interface CommitPayload {
  run: CapturedRun;
  accountId: string;
  quotingMethodId: string | null;
  blockSelections: Record<string, BlockSelection>;
  carrierMap: Record<number, string | null>;
  selectedKeys: string[];
}

const TERM_CHOICE: Record<number, number> = { 6: 738590203, 12: 738590205 };
const SOURCETYPE_COMPARATIVE_RATER = 100000002;
const STATUS_QUOTE_RECEIVED = 738590002;
const PREMIUM_STATUS_ESTIMATED = 738590000;
const PREMIUM_STATUS_FIRM = 738590002;
const RAW_CAP = 1_048_576;

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = (m! - 1) + months;
  const year = y! + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d!, new Date(year, month, 0).getDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildQuoteOps(
  payload: CommitPayload,
  existingStatuses: Map<string, number>
): { key: string; method: "PATCH"; url: string; body: Record<string, unknown> }[] {
  const { run, accountId, quotingMethodId, blockSelections, carrierMap, selectedKeys } = payload;
  const selected = new Set(selectedKeys);
  const ops: { key: string; method: "PATCH"; url: string; body: Record<string, unknown> }[] = [];

  for (const block of run.blocks) {
    const sel = blockSelections[block.lob];
    if (!sel) continue; // unpinned LOB block: skipped, not blocked (spec: panel flow #3)

    for (const q of block.quotes) {
      if (!selected.has(q.key)) continue;

      const effective = sel.desiredEffectiveDate; // EZLynx results carry no effective date (recon); opportunity's is the fallback and primary
      const name =
        `${q.carrierName} – ${block.lob}${effective ? ` – ${effective}` : ""}` +
        (q.kind === "alternate" ? " – Alt" : "");

      const body: Record<string, unknown> = {
        iacrm_quote_name: name,
        iacrm_provider: "EZLynx",
        iacrm_amsexternalid: q.key,
        iacrm_sourcetype: SOURCETYPE_COMPARATIVE_RATER,
        iacrm_status: STATUS_QUOTE_RECEIVED,
        iacrm_coveragelimitsummary: q.coverageSummary,
        iacrm_quotelink: `https://app.ezlynx.com/web/account/${run.applicant.ezlynxApplicantId}/rating/quote-results/${run.openApplicationId}/${block.applicantQuoteId}`,
        iacrm_rawpayload: JSON.stringify(q.raw).slice(0, RAW_CAP),
        "iacrm_accountid@odata.bind": `/accounts(${accountId})`,
        "iacrm_opportunityid@odata.bind": `/opportunities(${sel.opportunityId})`
      };

      // Estimated always; NEVER downgrade an agent's Firm (spec invariant)
      if (existingStatuses.get(q.key) !== PREMIUM_STATUS_FIRM) {
        body["iacrm_premium_status"] = PREMIUM_STATUS_ESTIMATED;
      }

      if (q.premium != null) body["iacrm_premium"] = q.premium;
      const term = q.termMonths != null ? TERM_CHOICE[q.termMonths] : undefined;
      if (term != null) body["iacrm_term"] = term;
      if (effective) {
        body["iacrm_effectivedate"] = effective;
        if (q.termMonths != null) body["iacrm_expirationdate"] = addMonths(effective, q.termMonths);
      }
      if (sel.lineOfBusinessId) body["iacrm_lineofbusinessid@odata.bind"] = `/iacrm_lineofbusinesses(${sel.lineOfBusinessId})`;
      const carrierId = carrierMap[q.carrierEzlynxId];
      if (carrierId) body["iacrm_carrierid@odata.bind"] = `/iacrm_carriers(${carrierId})`;
      if (quotingMethodId) body["iacrm_quotingmethodid@odata.bind"] = `/iacrm_quotingmethods(${quotingMethodId})`;

      ops.push({ key: q.key, method: "PATCH", url: altKeyUrl(q.key), body });
    }
  }
  return ops;
}
```

Update `src/messages.ts`: delete the placeholder `CommitPayload` and `import type { CommitPayload } from "@/crm/mapping"` instead (re-export it).

- [ ] **Step 3: Run to verify pass** — `npm test`.

- [ ] **Step 4: Commit**

```bash
git add src/crm/mapping.ts src/messages.ts tests/mapping.test.ts
git commit -m "feat: quote field mapping with Firm-protection and skip-unpinned-LOB"
```

---

### Task 11: Service worker message router

**Files:**
- Modify: `src/worker.ts` (replace placeholder)
- Create: `src/crm/carrierAliases.ts`
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–10.
- Produces: the worker answers every `PanelRequest` from `src/messages.ts`. Also:

```ts
// carrierAliases.ts — persistent ezlynx-id → CRM-carrier map (chrome.storage.local "carrier/aliases")
export async function getCarrierAliases(): Promise<Record<number, string>>
export async function saveCarrierAlias(ezlynxId: number, crmCarrierId: string): Promise<void>
```

- [ ] **Step 1: Write the failing test** for the router core (extract routing into a pure function so it tests without chrome messaging):

```ts
// tests/worker.test.ts
import { describe, it, expect, vi } from "vitest";
import "./helpers/chromeStub";
import { routeMessage } from "@/workerRouter";

describe("routeMessage", () => {
  it("returns a typed error for unknown message types", async () => {
    const res = await routeMessage({ type: "nope" } as never, {} as never);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("unknown"), kind: "unknown" });
  });

  it("wraps CrmAccessError with the environment name for the panel", async () => {
    const deps = {
      getActiveEnvironment: vi.fn(async () => ({ id: "dev", name: "DEV", orgUrl: "https://o.crm.dynamics.com", color: "green" as const })),
      searchAccounts: vi.fn(async () => { const e = new Error("x") as Error & { name: string; orgUrl: string }; e.name = "CrmAccessError"; e.orgUrl = "https://o.crm.dynamics.com"; throw e; })
    };
    const res = await routeMessage({ type: "panel/searchAccounts", name: "S", postalCode: null }, deps as never);
    expect(res).toMatchObject({ ok: false, kind: "auth", error: expect.stringContaining("DEV") });
  });
});
```

- [ ] **Step 2: Implement.** Create `src/workerRouter.ts` — a `routeMessage(msg, deps)` function with a deps object (environment fns, dataverse fns, tab lookup) so tests inject fakes; `src/worker.ts` binds the real deps:

```ts
// src/workerRouter.ts (shape; full switch over PanelRequest)
import type { PanelRequest, Res } from "@/messages";

export interface Deps { /* the real functions from environments/dataverse/mapping/carrierAliases + ezlynxTab helpers */ }

export async function routeMessage(msg: PanelRequest, deps: Deps): Promise<Res<unknown>> {
  try {
    switch (msg.type) {
      // env/list, env/setActive → environments.ts
      // panel/getEzlynxContext, panel/listRuns, panel/captureRun → find EZLynx tab (chrome.tabs.query
      //   { url: "https://app.ezlynx.com/*" }), chrome.tabs.sendMessage the BridgeRequest, relay Res
      // panel/searchAccounts, panel/getOpportunities, panel/getCarriers → dataverse.ts with active env
      // panel/commit → getExistingQuoteStatuses(selectedKeys) → buildQuoteOps → executeBatch → BatchItemResult[]
      // auth/signIn → getAccessToken(activeEnv.orgUrl, { interactive: true })
      default:
        return { ok: false, error: `unknown message type: ${(msg as { type: string }).type}`, kind: "unknown" };
    }
  } catch (e) {
    const err = e as Error & { orgUrl?: string };
    if (err.name === "CrmAccessError") {
      const env = await deps.getActiveEnvironment();
      return { ok: false, error: `Your account has no access to ${env.name} (${err.orgUrl}). Check the active environment.`, kind: "auth" };
    }
    if (err.name === "AuthRequiredError") return { ok: false, error: "Sign-in required", kind: "auth" };
    return { ok: false, error: String(err.message ?? err), kind: "unknown" };
  }
}
```

`src/worker.ts`:

```ts
import { routeMessage, realDeps } from "@/workerRouter";
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  routeMessage(msg, realDeps).then(sendResponse);
  return true;
});
```

`panel/commit` handler detail (the one nontrivial handler — implement exactly):

```ts
const env = await deps.getActiveEnvironment();
const existing = await deps.getExistingQuoteStatuses(env, msg.payload.selectedKeys);
const ops = deps.buildQuoteOps(msg.payload, existing);
const results = await deps.executeBatch(env, ops);
return { ok: true, data: results };
```

`carrierAliases.ts`:

```ts
export async function getCarrierAliases(): Promise<Record<number, string>> {
  const { "carrier/aliases": a } = await chrome.storage.local.get("carrier/aliases");
  return (a as Record<number, string> | undefined) ?? {};
}
export async function saveCarrierAlias(ezlynxId: number, crmCarrierId: string): Promise<void> {
  const all = await getCarrierAliases();
  all[ezlynxId] = crmCarrierId;
  await chrome.storage.local.set({ "carrier/aliases": all });
}
```

- [ ] **Step 3: Run tests + build** — `npm test && npm run build` → PASS/clean.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts src/workerRouter.ts src/crm/carrierAliases.ts tests/worker.test.ts
git commit -m "feat: worker message router + persistent carrier alias map"
```

---

### Task 12: Panel shell, environment header, wizard state

**Files:**
- Modify: `src/panel/main.tsx`
- Create: `src/panel/App.tsx`, `src/panel/state.ts`, `src/panel/EnvBadge.tsx`, `src/panel/api.ts`

**Interfaces:**
- Produces:
  - `src/panel/api.ts`: `send<T>(msg: PanelRequest): Promise<T>` — wraps `chrome.runtime.sendMessage`, throws `PanelError(kind, message, detail?)` on `ok:false`.
  - `src/panel/state.ts`: `useImportState()` reducer hook:

```ts
interface ImportState {
  step: "run" | "account" | "opportunities" | "carriers" | "review" | "done";
  ezlynxApplicantId: number | null;
  runs: RunListItem[];
  captured: CapturedRun | null;
  accountId: string | null; accountName: string | null;
  blockSelections: Record<string, BlockSelection>;
  carrierMap: Record<number, string | null>;
  selectedKeys: string[];
  results: BatchItemResult[] | null;
}
type Action =
  | { t: "context"; applicantId: number | null } | { t: "runs"; runs: RunListItem[] }
  | { t: "captured"; run: CapturedRun }          | { t: "account"; id: string; name: string }
  | { t: "pinBlock"; lob: string; sel: BlockSelection | null }
  | { t: "mapCarrier"; ezlynxId: number; carrierId: string | null }
  | { t: "toggleKey"; key: string }              | { t: "results"; r: BatchItemResult[] }
  | { t: "reset" } | { t: "goto"; step: ImportState["step"] };
```

  - On `captured`: `selectedKeys` initializes to ALL quote keys; `carrierMap` initializes from stored aliases (worker includes aliases in the `captureRun` response envelope — extend that response to `{ run: CapturedRun; aliases: Record<number, string> }` in the Task 11 handler).
  - `EnvBadge`: always-visible header pill showing active env name in its color; clicking opens a Menu listing environments; selection calls `env/setActive` then dispatches `reset` for CRM selections (captured run survives — re-derive `selectedKeys` from `captured`).

- [ ] **Step 1: Implement shell**

`src/panel/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={webLightTheme}><App /></FluentProvider>
);
```

`src/panel/App.tsx` skeleton: header (`<EnvBadge />` + title), then a `switch (state.step)` rendering the step components (Tasks 13–14 fill them; render `<div>TODO {state.step}</div>` placeholders for now — placeholders here are acceptable ONLY because Tasks 13–14 replace them within this plan).

Color mapping for `EnvBadge`: green→`colorPaletteGreenBackground2`, red→`colorPaletteRedBackground2`, blue→`colorPaletteBlueBackground2`, orange→`colorPaletteDarkOrangeBackground2` (Fluent tokens).

- [ ] **Step 2: Verify** — `npm run build`, load `dist/`, open panel: header shows **DEV** badge in green; switching env (once a second is added via options in Task 15) clears selections.

- [ ] **Step 3: Commit**

```bash
git add src/panel/
git commit -m "feat: panel shell with environment badge and wizard state"
```

---

### Task 13: Panel steps — run picker + account match

**Files:**
- Create: `src/panel/steps/RunPicker.tsx`, `src/panel/steps/AccountMatch.tsx`
- Modify: `src/panel/App.tsx` (mount real components)

**Interfaces:**
- Consumes: `send` (Task 12), state actions (Task 12).
- Produces: step components mounted for `step === "run"` and `"account"`.

- [ ] **Step 1: Implement `RunPicker`**

Behavior (all states must render something actionable):
- On mount: `send({type:"panel/getEzlynxContext"})`. If `applicantId` null → message "Open an EZLynx applicant page, then Refresh" + Refresh button.
- With applicantId: `send({type:"panel/listRuns", applicantId})` → list newest-first: `{lobs} — {created as locale date} {description}`. Click → `send({type:"panel/captureRun", ...})` → dispatch `captured` → step `account`.
- `kind:"session"` error → warning bar with the error text. `kind:"normalize"` error → error bar + "Copy payload" button writing `detail` to clipboard (spec: fail loud, copyable).

```tsx
// Core of RunPicker.tsx (imports/Fluent chrome omitted for brevity in plan; write complete file)
const [runs, setRuns] = useState<RunListItem[] | null>(null);
const [err, setErr] = useState<PanelError | null>(null);
useEffect(() => { (async () => {
  try {
    const ctx = await send<{ applicantId: number | null }>({ type: "panel/getEzlynxContext" });
    dispatch({ t: "context", applicantId: ctx.applicantId });
    if (ctx.applicantId) setRuns(await send<RunListItem[]>({ type: "panel/listRuns", applicantId: ctx.applicantId }));
  } catch (e) { setErr(e as PanelError); }
})(); }, [refreshNonce]);
```

- [ ] **Step 2: Implement `AccountMatch`**

- Search box prefilled with `captured.applicant.lastName`; Search button → `panel/searchAccounts` with the applicant's postalCode.
- Result rows: name, city, postal, `{openOppCount} open opps`; postal-match rows first (already sorted by worker). Row click → dispatch `account` → step `opportunities`.
- "Create new account…" is a `Button` (explicit, never automatic — spec) that for v1 opens the CRM's new-account form in a tab: `https://{activeOrgHost}/main.aspx?pagetype=entityrecord&etn=account` — the agent creates it there, returns, and re-searches. No silent creation path exists in code.
- Show captured applicant summary (name, address line, DOB) above the search so the agent can eyeball the match.

- [ ] **Step 3: Verify manually** — build, reload, walk: open EZLynx applicant → panel lists runs → capture → search account against DEV. (Requires Task 11 wired; EZLynx login present.)

- [ ] **Step 4: Commit**

```bash
git add src/panel/
git commit -m "feat: run picker and account match steps"
```

---

### Task 14: Panel steps — opportunity pin, carrier map, review/commit

**Files:**
- Create: `src/panel/steps/OpportunityPin.tsx`, `src/panel/steps/CarrierMap.tsx`, `src/panel/steps/ReviewCommit.tsx`
- Modify: `src/panel/App.tsx`

**Interfaces:**
- Consumes: state + `send`; `panel/commit` handler (Task 11).
- Produces: the remaining wizard; after commit, `results` view.

- [ ] **Step 1: `OpportunityPin`**

- Loads `panel/getOpportunities` for the chosen account once.
- One card per captured LOB block: block header `{lob} — {n} quotes`, a `Dropdown` of open opportunities sorted with LOB-name matches first (`opp.lobName?.toLowerCase().includes(block.lob.toLowerCase())`), plus explicit option "Skip this LOB". Selecting an opp dispatches `pinBlock` with `{opportunityId, lineOfBusinessId: opp.lobId, desiredEffectiveDate: opp.desiredEffectiveDate?.slice(0,10) ?? null}`; skip dispatches `pinBlock` with `null`.
- Footer: "Continue" enabled when every block has an explicit pin-or-skip decision; blocks pinned count shown ("Auto pinned, Home skipped").

- [ ] **Step 2: `CarrierMap`**

- Distinct carriers across selected blocks: rows of `{carrierName} (EZLynx #{id})` → `Dropdown` of CRM carriers (`panel/getCarriers`) preselected from `carrierMap` (aliases). Unmapped rows show a warning icon + "will import without carrier link".
- On Continue: for every newly mapped pair, `send` a `saveCarrierAlias` via commit payload? No — persist immediately: add message `{ type: "panel/saveCarrierAlias"; ezlynxId: number; carrierId: string }` to `PanelRequest` (and handle in the Task 11 router — one-line handler calling `saveCarrierAlias`). Dispatch `mapCarrier` locally either way.

- [ ] **Step 3: `ReviewCommit`**

- Table: checkbox | carrier | LOB | kind (Req/Alt) | premium | term | first line of coverage summary. Checkbox toggles `toggleKey`.
- Errored-carriers notice per block: "N carriers returned no quote" + expandable list of `{carrierName}: {message}` (spec: not lossy).
- Commit button label: `Write {selectedCount} quotes to {envName}` — env name bolded, badge-colored.
- On commit: build `CommitPayload` from state, `send({type:"panel/commit", payload})`, dispatch `results`, step `done`.
- `done` view: per-row status — 204/201 → success icon "Created/updated"; ≥400 → error icon + message; failed rows remain listed with a "Retry failed" button that re-commits with only failed keys (spec: failed rows stay selected for retry). "Start over" → `reset`.

- [ ] **Step 4: End-to-end manual pass against DEV** — full walk with a real EZLynx run; verify in the CRM (Quotes Quick Compare on the Opportunity) that rows landed with coverage text, premium, carrier, link; re-run the same import and confirm update-not-duplicate (row count stable).

- [ ] **Step 5: Commit**

```bash
git add src/panel/ src/messages.ts src/workerRouter.ts
git commit -m "feat: opportunity pin, carrier map, review/commit with per-row results"
```

---

### Task 15: Options page — environment editor

**Files:**
- Modify: `src/options/main.tsx`
- Create: `src/options/OptionsApp.tsx`

**Interfaces:**
- Consumes: `getEnvironments`/`saveEnvironments`/`getActiveEnvironment`/`setActiveEnvironment` (Task 7) — options page calls them directly (same extension origin; no worker round-trip needed for storage).

- [ ] **Step 1: Implement**

- Table of environments: name (Input), org URL (Input, validated `^https://[a-z0-9-]+\.crm\d*\.dynamics\.com$`), color (Dropdown: green/blue/orange/red), active (RadioGroup), delete (disabled for the active row).
- "Add environment" appends an empty row. Save button persists via `saveEnvironments`; setting active calls `setActiveEnvironment` (which clears panel selections by design).
- Footer note: "Each environment requires your account to have a Dataverse security role in that org."
- Prefilled from defaults on first open: DEV row present; a blank "Production" row is NOT pre-created (add-on-demand keeps the list honest).

- [ ] **Step 2: Verify** — build, open options, add a second env with a fake org URL, set active, confirm panel badge changes and pinned selections cleared; switch back to DEV.

- [ ] **Step 3: Commit**

```bash
git add src/options/
git commit -m "feat: options page environment editor"
```

---

### Task 16: Release collateral — e2e script, install docs, README

**Files:**
- Create: `docs/e2e-checklist.md`
- Create: `README.md`

**Interfaces:** none — documentation.

- [ ] **Step 1: Write `docs/e2e-checklist.md`** — the manual pre-release Playwright-style walk (spec: one e2e, manual, not CI). Numbered steps with expected results:

1. `npm run build`; load `dist/` unpacked in Chrome AND Edge.
2. Sign into EZLynx; open an applicant with a completed Auto/Home rate.
3. Open panel → runs list shows the rate run (newest first).
4. Capture → account search returns the matching Account first (postal boost).
5. Pin Auto, skip Home → carrier map shows persisted aliases → review shows quotes with coverage text and the errored-carrier notice.
6. Commit to DEV → all rows 2xx.
7. In the CRM: Opportunity → Quotes (Quick Compare) shows the rows; COVERAGE cell text matches EZLynx's screen; quote link opens the EZLynx result.
8. Re-commit the same run → row count unchanged (upsert, not duplicate).
9. In the CRM set one quote's premium status to Firm; re-commit → it stays Firm.
10. Options → switch environment → panel selections cleared, badge updates; switch back.
11. Sign-out test: clear `chrome.storage.session` (worker devtools) → next CRM call prompts sign-in; captured run survived.

- [ ] **Step 2: Write `README.md`** — what it is, install-unpacked steps for agents (Chrome + Edge), the Entra app consent note (first run per user), environment setup, troubleshooting table mapping the panel's error messages to causes (session expired / no access to env / extension needs update), and a pointer to the spec + this plan.

- [ ] **Step 3: Run the full e2e checklist once yourself; fix anything it catches; commit**

```bash
git add docs/e2e-checklist.md README.md
git commit -m "docs: e2e checklist and install README"
```

---

## Self-review (completed at plan-writing time)

- **Spec coverage:** panel five-step flow → Tasks 12–14; coverage rendering rules → Task 4; normalizer + fixture edge cases (null/dup quoteNumber, errors, mixed terms, multi-LOB) → Tasks 3/5; environment switching incl. selection-clearing → Tasks 7/12/15; Firm-protection pre-read → Tasks 9 (`getExistingQuoteStatuses`) + 10 (omission) + 11 (commit handler order); errored-carrier surfacing → Tasks 5 (errors[]) + 14 (notice); carrier alias persistence → Tasks 11/14; batch continue-on-error + 429 → Task 9; quote-link format → Task 10 test; Estimated invariant → Task 10 test; skip-unpinned-LOB → Task 10 test; store-readiness structure (config-not-code) → Tasks 6/7 (endpoints.json, appConfig, env list). Phase 6 (store listing) is out of plan scope by design.
- **Known deviations flagged for Nathan:** hand-rolled PKCE instead of MSAL (Global Constraints, validated by Task 1); public-client platform instead of SPA (same); effective date comes from the pinned Opportunity because EZLynx results carry none (Task 10 comment).
- **Type consistency:** message contract defined once in Task 6 and extended explicitly in Tasks 12 (aliases in capture response) and 14 (`panel/saveCarrierAlias`) — executors must update `PanelRequest` in those tasks, not fork it.
