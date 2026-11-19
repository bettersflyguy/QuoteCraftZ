/** Why the CRM field list could not be read, and the panel text for it.
 * Before this, every failure (not signed in, no security role, a rejected
 * sign-in, a network error) ended in the same "CRM fields unavailable"
 * line, and a failed read of every table was swallowed into an empty
 * catalog with no reason at all. */

export type CatalogUnavailable =
  | { kind: "signin" }
  | { kind: "rejected"; status: 401 }
  | { kind: "role"; status: 403 }
  | { kind: "other"; detail: string };

/** ADO task that tracks the missing CRM security role for the connector. */
export const ROLE_TASK = "Task 3704";

/** Classifies a failed CRM read by the error the worker raised. */
export function classifyCatalogError(e: unknown): CatalogUnavailable {
  const err = e as { name?: string; status?: number; message?: string } | null;
  if (err?.name === "AuthRequiredError") return { kind: "signin" };
  if (err?.name === "CrmAccessError") {
    return err.status === 403 ? { kind: "role", status: 403 } : { kind: "rejected", status: 401 };
  }
  // never carry a URL query string (or anything after it) into the panel
  const detail = String(err?.message ?? e ?? "").replace(/\?\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { kind: "other", detail };
}

/** The panel line for an unavailable catalog; always ends by saying the
 * built-in targets are showing. */
export function catalogUnavailableNote(reason: CatalogUnavailable | undefined): string {
  switch (reason?.kind) {
    case "signin":
      return "CRM fields unavailable: sign in to the CRM. Showing built-in targets.";
    case "rejected":
      return "CRM fields unavailable: the CRM rejected the sign-in (HTTP 401). Sign in again with your work account. Showing built-in targets.";
    case "role":
      return `CRM fields unavailable: your account has no CRM security role that can read these tables (HTTP 403, see ${ROLE_TASK}). Ask for the role; no change is needed in the extension. Showing built-in targets.`;
    case "other":
      return `CRM fields unavailable: the CRM field list could not be read${reason.detail ? ` (${reason.detail})` : ""}. Showing built-in targets.`;
    default:
      return "CRM fields unavailable: the CRM returned no fields for this environment. Showing built-in targets.";
  }
}
