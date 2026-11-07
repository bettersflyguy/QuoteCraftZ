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
  source: "control" | "choice-group" | "definition-list" | "table" | "review-row" | "entity-card" | "money-line" | "sale";
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
}

export interface PortalFillResult {
  filledCount: number;
  existingCount: number;
  optionMismatchCount: number;
  controlCount: number;
  filled: { label: string; path: string }[];
}

/** One fillable control from the mapping editor's page scan. */
export interface PortalScanRow {
  key: string;
  label: string;
  type: string;
  /** Banking/payment field — displayed locked, never mappable or fillable. */
  payment: boolean;
  /** What auto-matching would pick for this control right now (rule paths only). */
  autoPath: string | null;
  /** The saved per-site mapping: a rule path, "skip", or null (auto). */
  mapped: string | null;
}

export interface PortalScanResult { origin: string; rows: PortalScanRow[] }
