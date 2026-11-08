import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "D365 Insurance Quote Connector",
  version: pkg.version,
  description: "Capture quotes and applications from your rating tools (EZLynx personal lines, Bold Penguin commercial), import them into the D365 Insurance CRM, and fill carrier portals.",
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk8unQsRrBQaoXnMmaSUe734iDVuH7x+JJFQ6keXKeJosNSc9j8j4YnNjQwz21Nd1HyrkxXDL4glKpw5RH3RqgsayH/x2jWvnGsohkGT9EqBdZjaXlm98QuGJ6AWs8nbcPMq11U5SA+lUMM4DfbsVFeXGkPS+x63RdtxMX9R1CULs1WXa+K8O/dct/mUpCJbh1YlG4IkFzsYiz4aN1G+1MEWTjFSssBH6YWpzljhsygMhhxWyL7TkarvkTLK4Bd7iZVMWLen6t5F24YML+s5NPyBOT2dqsWUCuTI+w2jEyO7XtqBe19NQDn+i5lhvQUnr1KUXoGMjlExIyklKlHWGywIDAQAB",
  permissions: ["storage", "identity", "sidePanel", "tabs", "scripting"],
  host_permissions: [
    "https://app.ezlynx.com/*",
    "https://*.boldpenguin.com/*",
    "https://*.crm.dynamics.com/*",
    "https://login.microsoftonline.com/*"
  ],
  // Carrier portals can live on any domain; the portal filler asks for each
  // origin at click time (chrome.permissions.request) instead of demanding
  // blanket access up front - keeps the store listing and install prompt lean.
  optional_host_permissions: ["https://*/*"],
  background: { service_worker: "src/worker.ts", type: "module" },
  content_scripts: [
    { matches: ["https://app.ezlynx.com/*"], js: ["src/ezlynx/content.ts"], run_at: "document_idle" },
    { matches: ["https://*.boldpenguin.com/*"], js: ["src/boldpenguin/extract.ts"], run_at: "document_idle" }
  ],
  side_panel: { default_path: "src/panel/index.html" },
  options_page: "src/options/index.html",
  icons: {
    "16": "icons/16.png",
    "32": "icons/32.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  action: {
    default_title: "D365 Insurance Quote Connector",
    default_icon: { "16": "icons/16.png", "32": "icons/32.png" }
  }
});
