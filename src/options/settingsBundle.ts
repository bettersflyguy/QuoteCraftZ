/** QuoteCraftZ settings as one share file: environments, every site's
 * field mappings, choice mappings, data-service mappings, carrier matches
 * and preferences. Never sign-in tokens, held captures, secured values or
 * per-user picks (default servicing agent). The same file imports whole or
 * for one scope (one site, or the data service). */
import { getEnvironments, saveEnvironments, type CrmEnvironment } from "@/crm/environments";
import {
  buildFieldMapExport, getAllFieldMaps, parseFieldMapImport, setAllFieldMaps,
  type FieldMapExport, type FieldMapImport
} from "@/portal/fieldMaps";
import { getOptionMaps, setOptionMaps } from "@/portal/optionMaps";
import { EZLYNX_FIELDS, effectiveTargets, getDataServiceMaps, setDataServiceMap } from "@/sources/ezlynxSource";

export type TransferScope = { kind: "all" } | { kind: "site"; origin: string } | { kind: "dataservice"; source: string };

export interface SettingsExtras {
  environments: Omit<CrmEnvironment, "id">[];
  /** { orgUrl: { ezlynxCarrierId: crmCarrierGuid } } */
  carrierAliases: Record<string, Record<string, string>>;
  preferences: { autoAdvance?: boolean };
}
export interface SettingsImport { fields: FieldMapImport; extras: SettingsExtras }

const ORG_URL = /^https:\/\/[a-z0-9-]+\.crm\d*\.dynamics\.com$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = new Set(["green", "red", "blue", "orange"]);
const ALIAS_PREFIX = "carrier/aliases:";

/** Every data-service field's effective target (saved choice or default),
 * so a share file carries the complete mapping. */
export async function effectiveDataServiceMaps(): Promise<Record<string, Record<string, string>>> {
  const saved = await getDataServiceMaps();
  const targets = effectiveTargets(saved["ezlynx"]);
  return { ezlynx: Object.fromEntries(EZLYNX_FIELDS.map(f => [f.id, targets[f.id] ?? ""])) };
}

/** The share file for a scope. */
export async function buildSettingsFile(scope: TransferScope): Promise<FieldMapExport & Partial<SettingsExtras>> {
  const maps = await getAllFieldMaps();
  const options = await getOptionMaps();
  if (scope.kind === "site") return buildFieldMapExport({ [scope.origin]: maps[scope.origin] ?? {} }, options);
  const services = await effectiveDataServiceMaps();
  if (scope.kind === "dataservice") {
    return buildFieldMapExport({}, options, { [scope.source]: services[scope.source] ?? {} });
  }
  const all = await chrome.storage.local.get(null);
  const carrierAliases: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(ALIAS_PREFIX) && v && typeof v === "object") {
      carrierAliases[k.slice(ALIAS_PREFIX.length)] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([a, b]) => [a, String(b)]));
    }
  }
  const environments = (await getEnvironments()).map(({ name, orgUrl, color, appId }) => ({ name, orgUrl, color, ...(appId ? { appId } : {}) }));
  const autoAdvance = all["portal/autoAdvance"];
  return {
    ...buildFieldMapExport(maps, options, services),
    environments,
    carrierAliases,
    preferences: typeof autoAdvance === "boolean" ? { autoAdvance } : {}
  };
}

/** Validated non-mapping settings from a share file. */
export function parseSettingsExtras(doc: unknown): SettingsExtras {
  const d = (typeof doc === "object" && doc !== null ? doc : {}) as Record<string, unknown>;
  const environments: SettingsExtras["environments"] = [];
  for (const e of Array.isArray(d["environments"]) ? d["environments"] as unknown[] : []) {
    const r = (e ?? {}) as Record<string, unknown>;
    const orgUrl = typeof r["orgUrl"] === "string" ? r["orgUrl"].toLowerCase().replace(/\/+$/, "") : "";
    const name = typeof r["name"] === "string" ? r["name"].trim().slice(0, 40) : "";
    if (!ORG_URL.test(orgUrl) || !name) continue;
    environments.push({
      name, orgUrl,
      color: (COLORS.has(String(r["color"])) ? r["color"] : "blue") as CrmEnvironment["color"],
      ...(typeof r["appId"] === "string" && GUID.test(r["appId"]) ? { appId: r["appId"] } : {})
    });
  }
  const carrierAliases: SettingsExtras["carrierAliases"] = {};
  const rawAliases = (typeof d["carrierAliases"] === "object" && d["carrierAliases"] !== null ? d["carrierAliases"] : {}) as Record<string, unknown>;
  for (const [org, m] of Object.entries(rawAliases)) {
    if (!ORG_URL.test(org) || typeof m !== "object" || m === null) continue;
    const kept = Object.fromEntries(Object.entries(m as Record<string, unknown>)
      .filter(([k, v]) => /^\d{1,9}$/.test(k) && typeof v === "string" && GUID.test(v)) as [string, string][]);
    if (Object.keys(kept).length) carrierAliases[org] = kept;
  }
  const prefs = (typeof d["preferences"] === "object" && d["preferences"] !== null ? d["preferences"] : {}) as Record<string, unknown>;
  return {
    environments,
    carrierAliases,
    preferences: typeof prefs["autoAdvance"] === "boolean" ? { autoAdvance: prefs["autoAdvance"] } : {}
  };
}

export function parseSettingsFile(text: string): SettingsImport {
  const fields = parseFieldMapImport(text, true);
  const extras = parseSettingsExtras(JSON.parse(text));
  const empty = !fields.sites && !Object.keys(fields.dataServices).length && !extras.environments.length &&
    !Object.keys(extras.carrierAliases).length && extras.preferences.autoAdvance === undefined;
  if (empty) throw new Error("The file contained no usable settings.");
  return { fields, extras };
}

/** What a scope would change, for the review line. */
export function describeImport(p: SettingsImport, scope: TransferScope, existingOrigins: Set<string>): string {
  const parts: string[] = [];
  const sites = p.fields.perOrigin.filter(o => scope.kind === "all" || (scope.kind === "site" && o.origin === scope.origin));
  for (const o of sites) parts.push(`${o.origin}: ${o.fields} field${o.fields === 1 ? "" : "s"} (${existingOrigins.has(o.origin) ? "replaces existing" : "new site"})`);
  if (scope.kind !== "site") {
    for (const [s, m] of Object.entries(p.fields.dataServices)) {
      if (scope.kind === "dataservice" && s !== scope.source) continue;
      parts.push(`${s === "ezlynx" ? "EZLynx" : s} data service: ${Object.keys(m).length} fields`);
    }
  }
  if (scope.kind === "all") {
    if (p.extras.environments.length) parts.push(`${p.extras.environments.length} environment${p.extras.environments.length === 1 ? "" : "s"} (added or updated by org URL)`);
    const aliases = Object.values(p.extras.carrierAliases).reduce((n, m) => n + Object.keys(m).length, 0);
    if (aliases) parts.push(`${aliases} carrier match${aliases === 1 ? "" : "es"}`);
    if (p.extras.preferences.autoAdvance !== undefined) parts.push("preferences");
  }
  return parts.join("; ");
}

/** Applies a parsed file for a scope. Returns false when the file holds
 * nothing for that scope. */
export async function applySettings(p: SettingsImport, scope: TransferScope): Promise<boolean> {
  let changed = false;
  if (scope.kind !== "dataservice") {
    const origins = Object.keys(p.fields.maps).filter(o => scope.kind === "all" || o === (scope as { origin: string }).origin);
    if (origins.length) {
      const merged = { ...await getAllFieldMaps() };
      for (const o of origins) merged[o] = p.fields.maps[o]!;
      await setAllFieldMaps(merged);
      for (const o of origins) if (p.fields.options[o]) await setOptionMaps(o, p.fields.options[o]!);
      changed = true;
    }
  }
  if (scope.kind !== "site") {
    for (const [source, m] of Object.entries(p.fields.dataServices)) {
      if (scope.kind === "dataservice" && source !== scope.source) continue;
      const current = (await getDataServiceMaps())[source] ?? {};
      await setDataServiceMap(source, { ...current, ...m });
      const scopeKey = `dataservice:${source}`;
      if (p.fields.options[scopeKey]) await setOptionMaps(scopeKey, p.fields.options[scopeKey]!);
      changed = true;
    }
  }
  if (scope.kind === "all") {
    if (p.extras.environments.length) {
      const envs = [...await getEnvironments()];
      for (const e of p.extras.environments) {
        const hit = envs.find(x => x.orgUrl.toLowerCase() === e.orgUrl);
        if (hit) Object.assign(hit, { name: e.name, color: e.color, ...(e.appId ? { appId: e.appId } : {}) });
        else envs.push({ id: `env_${Math.random().toString(36).slice(2, 10)}`, ...e });
      }
      await saveEnvironments(envs);
      changed = true;
    }
    for (const [org, m] of Object.entries(p.extras.carrierAliases)) {
      const key = `${ALIAS_PREFIX}${org}`;
      const current = ((await chrome.storage.local.get(key))[key] as Record<string, string> | undefined) ?? {};
      await chrome.storage.local.set({ [key]: { ...current, ...m } });
      changed = true;
    }
    if (p.extras.preferences.autoAdvance !== undefined) {
      await chrome.storage.local.set({ "portal/autoAdvance": p.extras.preferences.autoAdvance });
      changed = true;
    }
  }
  return changed;
}

/** Saves a share file through the browser's download. */
export function downloadSettingsFile(file: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
