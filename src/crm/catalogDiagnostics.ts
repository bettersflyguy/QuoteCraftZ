/** AB#3745 diagnostic: what the CRM field list read actually did, per table,
 * so an owner whose Mappings list shows only the six built-in "Contacts (all
 * rows)" targets can copy one text block that says which silent path happened.
 *
 * Only these are ever recorded: logical table names, HTTP status, a short
 * classified error text and counts. Never an org URL query string, a token,
 * request headers or a response body. */
import type { CatalogUnavailable } from "./catalogNote";

export interface PicklistProbe {
  ok: boolean;
  /** HTTP status when the error carries one. */
  status?: number;
  error?: string;
  /** Picklist columns dropped because no options could be read. */
  hidden: number;
}

export interface TableDiagnostic {
  logical: string;
  ok: boolean;
  status?: number;
  error?: string;
  /** Columns left after filterColumns (before hidden picklists are removed). */
  columns: number;
  picklist?: PicklistProbe;
}

/** ok: every table read. partial: some failed (A). all-failed: none read (B). */
export type CatalogCase = "ok" | "partial" | "all-failed";

export interface CatalogDiagnostics {
  /** The cache key version the shape was written under (CACHE_PREFIX). */
  version: string;
  source: "cached" | "live";
  fetchedAt: number;
  envId: string;
  case: CatalogCase;
  tables: TableDiagnostic[];
}

/** Strips anything that could carry a secret from error text: the query
 * string, bearer tokens and long token-like strings. */
export function safeText(text: string): string {
  return text
    .replace(/\?\S*/g, "")
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}(\.[A-Za-z0-9_-]{10,})*\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** HTTP status an error carries: CrmAccessError.status, or the status that
 * dvJson writes into its message ("Dataverse 500 for ..."). */
export function statusOf(e: unknown): number | undefined {
  const err = e as { status?: unknown; message?: unknown } | null;
  if (typeof err?.status === "number") return err.status;
  const m = /Dataverse (\d{3})\b/.exec(String(err?.message ?? ""));
  return m ? Number(m[1]) : undefined;
}

/** Short, safe text for a classified failure. */
export function describeCatalogError(c: CatalogUnavailable): string {
  switch (c.kind) {
    case "signin": return "sign-in required";
    case "rejected": return "sign-in rejected (HTTP 401)";
    case "role": return "no security role to read this table (HTTP 403)";
    default: return safeText(c.detail) || "unknown error";
  }
}

export function caseOf(tables: TableDiagnostic[]): CatalogCase {
  const failed = tables.filter(t => !t.ok).length;
  return failed === 0 ? "ok" : failed === tables.length ? "all-failed" : "partial";
}

/** Panel case label: the catalog's own, or the message round-trip failing. */
export type PanelCase = CatalogCase | "message-failed" | "loading";

export function panelCase(catalog: { diagnostics?: CatalogDiagnostics; unavailable?: unknown; entities: unknown[] } | null, messageError: string | null, loading = false): PanelCase {
  // a read in flight has no result yet: never report it as all-failed
  if (loading) return "loading";
  if (messageError) return "message-failed";
  if (!catalog) return "all-failed";
  if (catalog.diagnostics) return catalog.diagnostics.case;
  return catalog.entities.length ? "ok" : "all-failed";
}

/** The note the panel shows for a non-ok case (null when all is well). */
export function diagnosticNote(
  catalog: { diagnostics?: CatalogDiagnostics } | null,
  messageError: string | null,
  allFailedNote: string,
  loading = false
): string | null {
  const c = panelCase(catalog as never, messageError, loading);
  if (c === "loading") return "Reading CRM field list…";
  if (c === "message-failed") return `CRM field list: the request to the extension worker failed (${safeText(messageError ?? "") || "no detail"}). Showing built-in targets.`;
  if (c === "all-failed") return allFailedNote;
  const tables = catalog?.diagnostics?.tables ?? [];
  const hidden = tables.reduce((n, t) => n + (t.picklist?.hidden ?? 0), 0);
  const probeFailed = tables.filter(t => t.picklist && !t.picklist.ok);
  const choiceNote = probeFailed.length
    ? `CRM choice columns could not be read for ${probeFailed.map(t => t.logical).join(", ")}; ${hidden} choice column(s) are hidden.`
    : "";
  if (c === "partial") {
    const parts = tables.filter(t => !t.ok).map(t => `${t.logical} table could not be read${t.status ? ` (HTTP ${t.status})` : t.error ? ` (${t.error})` : ""}`);
    return `CRM field list is partial: ${parts.join("; ")}. Those tables' columns are missing from the target lists.${choiceNote ? ` ${choiceNote}` : ""}`;
  }
  return choiceNote || null;
}

const when = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : "unknown");

/** Plain-text summary for the Copy details button. */
export function diagnosticText(
  catalog: { diagnostics?: CatalogDiagnostics; unavailable?: CatalogUnavailable; entities: unknown[] } | null,
  opts: { buildVersion: string; messageError?: string | null; loading?: boolean }
): string {
  const d = catalog?.diagnostics;
  const lines = [
    "QuoteCraftZ CRM field list diagnostic (AB#3745)",
    `Extension build: ${opts.buildVersion}`,
    `Case: ${panelCase(catalog as never, opts.messageError ?? null, opts.loading ?? false)}`
  ];
  if (opts.messageError) lines.push(`Message error: ${safeText(opts.messageError)}`);
  if (!catalog) lines.push("Catalog: none received");
  else {
    lines.push(`Entities listed: ${catalog.entities.length}`);
    if (catalog.unavailable) lines.push(`Unavailable reason: ${describeCatalogError(catalog.unavailable)}`);
  }
  if (d) {
    lines.push(
      `Catalog version: ${d.version}`,
      `Source: ${d.source}`,
      `Fetched at: ${when(d.fetchedAt)}`,
      `Environment: ${safeText(d.envId) || "unknown"}`,
      "Tables:"
    );
    for (const t of d.tables) {
      lines.push(`  ${t.logical}: ${t.ok ? "ok" : "FAILED"}${t.status ? ` HTTP ${t.status}` : ""}${t.error ? ` (${safeText(t.error)})` : ""}; columns ${t.columns}`);
      if (t.picklist) {
        lines.push(`    choice probe: ${t.picklist.ok ? "ok" : `FAILED${t.picklist.status ? ` HTTP ${t.picklist.status}` : ""}${t.picklist.error ? ` (${safeText(t.picklist.error)})` : ""}`}; choice columns hidden (no options): ${t.picklist.hidden}`);
      }
    }
  }
  return lines.join("\n");
}

/** The panel's catalog request, never swallowing the error. `refresh` forces a
 * re-read in the worker (the Retry button). */
export async function requestCatalog<C>(
  send: (msg: { type: "panel/crmFieldCatalog"; refresh: boolean }) => Promise<C>,
  refresh: boolean
): Promise<{ catalog: C | null; messageError: string | null }> {
  try {
    return { catalog: await send({ type: "panel/crmFieldCatalog", refresh }), messageError: null };
  } catch (e) {
    return { catalog: null, messageError: safeText(String((e as { message?: unknown } | null)?.message ?? e)) || "unknown error" };
  }
}
