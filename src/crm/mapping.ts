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
  /** systemuser GUID the written quotes are owned by (servicing agent). */
  ownerId: string | null;
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
  const { run, accountId, quotingMethodId, blockSelections, carrierMap, selectedKeys, ownerId } = payload;
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
      if (ownerId) body["ownerid@odata.bind"] = `/systemusers(${ownerId})`;

      ops.push({ key: q.key, method: "PATCH", url: altKeyUrl(q.key), body });
    }
  }
  return ops;
}
