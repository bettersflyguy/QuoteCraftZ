import { useReducer } from "react";
import type { CapturedRun, RunListItem } from "@/types";
import type { BlockSelection } from "@/crm/mapping";
import type { BatchItemResult } from "@/crm/dataverse";

export interface ImportState {
  step: "run" | "account" | "opportunities" | "carriers" | "review" | "done";
  ezlynxApplicantId: number | null;
  runs: RunListItem[];
  captured: CapturedRun | null;
  accountId: string | null;
  accountName: string | null;
  /** BlockSelection = pinned; null = explicitly skipped; absent key = not yet decided. */
  blockSelections: Record<string, BlockSelection | null>;
  carrierMap: Record<number, string | null>;
  selectedKeys: string[];
  results: BatchItemResult[] | null;
}

export type Action =
  | { t: "context"; applicantId: number | null }
  | { t: "runs"; runs: RunListItem[] }
  | { t: "captured"; run: CapturedRun; aliases: Record<number, string> }
  | { t: "account"; id: string; name: string }
  | { t: "pinBlock"; lob: string; sel: BlockSelection | null }
  | { t: "mapCarrier"; ezlynxId: number; carrierId: string | null }
  | { t: "toggleKey"; key: string }
  | { t: "results"; r: BatchItemResult[] }
  /** Environment switch: clears CRM-side selections, keeps the captured EZLynx run
   * (spec: Panel flow - "switching environment... captured run survives"). */
  | { t: "reset" }
  /** Full "Start over": discards the captured run too, back to the run picker. */
  | { t: "startOver" }
  /** The EZLynx tab navigated to a different applicant: discard everything and
   * restart the wizard against them (stale captures cross-wire customers). */
  | { t: "applicantChanged"; applicantId: number | null }
  | { t: "goto"; step: ImportState["step"] };

const initialState: ImportState = {
  step: "run",
  ezlynxApplicantId: null,
  runs: [],
  captured: null,
  accountId: null,
  accountName: null,
  blockSelections: {},
  carrierMap: {},
  selectedKeys: [],
  results: null
};

function allQuoteKeys(run: CapturedRun): string[] {
  return run.blocks.flatMap(b => b.quotes.map(q => q.key));
}

function reducer(state: ImportState, action: Action): ImportState {
  switch (action.t) {
    case "context":
      return { ...state, ezlynxApplicantId: action.applicantId };

    case "runs":
      return { ...state, runs: action.runs };

    case "captured":
      // selectedKeys initializes to ALL quote keys; carrierMap initializes from stored
      // aliases (worker includes aliases in the captureRun response envelope).
      return {
        ...state,
        captured: action.run,
        selectedKeys: allQuoteKeys(action.run),
        carrierMap: { ...action.aliases },
        blockSelections: {},
        accountId: null,
        accountName: null,
        results: null,
        step: "account"
      };

    case "account":
      return { ...state, accountId: action.id, accountName: action.name, step: "opportunities" };

    case "pinBlock":
      return { ...state, blockSelections: { ...state.blockSelections, [action.lob]: action.sel } };

    case "mapCarrier":
      return { ...state, carrierMap: { ...state.carrierMap, [action.ezlynxId]: action.carrierId } };

    case "toggleKey": {
      const has = state.selectedKeys.includes(action.key);
      return {
        ...state,
        selectedKeys: has
          ? state.selectedKeys.filter(k => k !== action.key)
          : [...state.selectedKeys, action.key]
      };
    }

    case "results":
      return { ...state, results: action.r, step: "done" };

    case "reset":
      return {
        ...state,
        accountId: null,
        accountName: null,
        blockSelections: {},
        // carrier aliases (Dataverse GUIDs) are environment-specific; a stale carrierMap
        // from the previous org would silently mismap in the new one.
        carrierMap: {},
        selectedKeys: state.captured ? allQuoteKeys(state.captured) : [],
        results: null,
        step: state.captured ? "account" : "run"
      };

    case "startOver":
      return { ...initialState, ezlynxApplicantId: state.ezlynxApplicantId, runs: state.runs };

    case "applicantChanged":
      return { ...initialState, ezlynxApplicantId: action.applicantId };

    case "goto":
      return { ...state, step: action.step };

    default:
      return state;
  }
}

export function useImportState() {
  return useReducer(reducer, initialState);
}
