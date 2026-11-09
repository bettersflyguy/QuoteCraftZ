/** Commercial-lines application captured from Bold Penguin (source adapter #2).
 * Shape carried over from the Betters Application Assistant concept (schema 1.1)
 * so downstream consumers (portal fill, future CRM write) stay compatible. */

export interface CapturedAppField {
  label: string;
  value: string;
  /** Control name/id when the field came from a form control. */
  name?: string;
  section: string;
  group: string;
  source: "control" | "choice-group" | "definition-list" | "table" | "review-row" | "entity-card" | "money-line" | "sale" | "taught" | "dataservice";
  /** Explicit rule path for agent-taught captures ("contact2.email") - the
   * normalizer routes it directly, bypassing label-alias scoring, so entity
   * slots with identical-looking values (account email vs contact 2 email)
   * can never collide. Validated against MAP_PATHS before use. */
  mapped?: string;
}

/** Alias-scored projection of the raw fields (business/contact/address/coverage/…).
 * Values are strings except coverage.lines which is a string[]. */
export type NormalizedApplication = Record<string, Record<string, string | string[]>>;

export interface CapturedApplication {
  schemaVersion: "1.1";
  capturedAt: string;
  /** "Bold Penguin" for application captures; the site hostname for portal ingests. */
  source: { system: string; url: string; title: string };
  completion: { likelyCompleted: boolean; matchedPhrases: string[]; hasReviewStep: boolean };
  scannedSections: string[];
  normalized: NormalizedApplication;
  fields: CapturedAppField[];
  /** Quotes held for import, from any source (EZLynx data service, a
   * carrier portal's quote page). The agent selects them, maps carriers and
   * sets Firm/Estimated before loading. */
  quotes?: HeldQuote[];
  /** Carriers that returned no quote ("Carrier Abort: product unavailable"). */
  quoteIssues?: { lob: string; carrierName: string; message: string }[];
  /** The exact rating run behind EZLynx-sourced quotes: the load writes
   * them precisely (alt keys, coverage lines, carrier Q&A, license data). */
  dataService?: { kind: "ezlynx"; run: import("@/types").CapturedRun };
}

export type PremiumStatus = "estimated" | "firm";

export interface HeldQuote {
  /** Stable identity: "ezlynx:{execId}:req|alt{n}" or "portal:{host}". */
  key: string;
  provider: "EZLynx" | "Portal";
  /** Where it came from, for display ("EZLynx", "express.nationwide.com"). */
  source: string;
  /** Line of business as the source names it ("Home", "Auto"; "" unknown). */
  lob: string;
  carrierName: string;
  /** Source's own carrier id (EZLynx), for remembered carrier aliases. */
  carrierRef: string | null;
  /** CRM carrier chosen for this quote (environment-specific). */
  carrierId: string | null;
  kind: "requested" | "alternate";
  quoteNumber: string | null;
  premium: number | null;
  termMonths: number | null;
  /** EZLynx only ever returns estimates; bindable raters return firm. Set by
   * the agent before importing. */
  premiumStatus: PremiumStatus;
  coverageSummary: string;
  coverageLines: { code: string; label: string; limitText: string }[];
  link: string | null;
  selected: boolean;
}

export interface PortalFillResult {
  filledCount: number;
  existingCount: number;
  optionMismatchCount: number;
  controlCount: number;
  filled: { label: string; path: string }[];
  /** Mapped controls the capture held no value for. */
  noData?: { label: string; path: string }[];
  /** Secured pass-through outcome (counts only; values never leave the worker). */
  secure?: { filled: number; missing: number; note: string | null };
}

/** One fillable control from the mapping editor's page scan. */
export interface PortalScanRow {
  key: string;
  label: string;
  type: string;
  /** Banking/payment field - displayed locked, never mappable or fillable. */
  payment: boolean;
  /** What auto-matching would pick for this control right now (rule paths only). */
  autoPath: string | null;
  /** The saved per-site mapping: a rule path, "skip", or null (auto). */
  mapped: string | null;
  /** A selection control's choices in the page's wording. */
  options?: string[];
  /** Picked fields: the field's own label (label may add its section). */
  fieldLabel?: string;
  /** Picked fields: the sub-section key ("other address"), "" outside one. */
  section?: string;
  /** Picked fields: every titled box around it and "#<page heading>". */
  scopes?: string[];
}

export interface PortalScanResult { origin: string; rows: PortalScanRow[] }

/** One mapping the editor's peek highlights on the page. */
export interface PeekItem {
  key: string;
  label: string;
  kind: "mapped" | "auto" | "skip";
  /** Array teaching - highlight every row the capture would pull. */
  array?: boolean;
  /** A section's field mapped to an array: every section of that kind
   * (Primary / Other / Mailing Address) is a row. */
  family?: boolean;
  /** A data-service field: the scoped on-screen labels it covers. */
  labels?: string[];
}
export interface PeekResult {
  shown: number;
  missing: number;
  /** Fields outlined red: read by the capture, covered by nothing. */
  unmapped?: number;
  /** Intake's peek: mapped fields outlined green. */
  mapped?: number;
}
