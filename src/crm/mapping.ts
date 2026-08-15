import type { CapturedRun } from "@/types";

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

// buildQuoteOps arrives with Task 10.
