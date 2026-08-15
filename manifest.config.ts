import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "EZLynx Quote Bridge",
  version: "0.1.0",
  description: "Import EZLynx quote results into the D365 Insurance CRM.",
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk8unQsRrBQaoXnMmaSUe734iDVuH7x+JJFQ6keXKeJosNSc9j8j4YnNjQwz21Nd1HyrkxXDL4glKpw5RH3RqgsayH/x2jWvnGsohkGT9EqBdZjaXlm98QuGJ6AWs8nbcPMq11U5SA+lUMM4DfbsVFeXGkPS+x63RdtxMX9R1CULs1WXa+K8O/dct/mUpCJbh1YlG4IkFzsYiz4aN1G+1MEWTjFSssBH6YWpzljhsygMhhxWyL7TkarvkTLK4Bd7iZVMWLen6t5F24YML+s5NPyBOT2dqsWUCuTI+w2jEyO7XtqBe19NQDn+i5lhvQUnr1KUXoGMjlExIyklKlHWGywIDAQAB",
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
