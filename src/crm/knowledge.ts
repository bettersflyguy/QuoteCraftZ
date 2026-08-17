import type { CapturedRun } from "@/types";
import type { CrmEnvironment } from "./environments";
import type { BatchItemResult, KnowledgeNavProps } from "./dataverse";

export interface KnowledgeApi {
  getKnowledgeNavProps(env: CrmEnvironment): Promise<KnowledgeNavProps | null>;
  executeBatch(
    env: CrmEnvironment,
    ops: { key: string; method: "PATCH" | "POST" | "DELETE"; url: string; body?: unknown }[]
  ): Promise<BatchItemResult[]>;
}

const esc = (v: string) => v.replace(/'/g, "''");

export interface KnowledgeWriteResult {
  questionsUpserted: number;
  answersUpserted: number;
  skipped: "no-tables" | null;
}

/** Feeds the question-knowledge layer from a captured run: upserts dictionary
 * rows for every catalog question (options, help text, carrier attribution)
 * and answer rows for every answered question, both on alternate keys so
 * re-imports update rather than duplicate. Dormant until the CRM tables
 * deploy. canonicalkey is never written here - mapping is a curation concern,
 * not a capture concern. */
export async function writeQuestionKnowledge(
  env: CrmEnvironment,
  run: CapturedRun,
  accountId: string,
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const navs = await api.getKnowledgeNavProps(env);
  if (!navs) return { questionsUpserted: 0, answersUpserted: 0, skipped: "no-tables" };

  const ops: { key: string; method: "PATCH"; url: string; body?: unknown }[] = [];
  const seenQuestions = new Set<string>();
  let answers = 0;
  const now = new Date().toISOString();

  for (const block of run.blocks) {
    if (!block.icq) continue;
    for (const q of block.icq.catalog) {
      const extId = `ezlynx:${q.questionId}`;
      if (seenQuestions.has(extId)) continue;
      seenQuestions.add(extId);
      ops.push({
        key: `q:${extId}`,
        method: "PATCH",
        url: `iacrm_carrierquestions(iacrm_amsexternalid='${esc(extId)}')`,
        body: {
          iacrm_carrierquestion_name: q.label.slice(0, 300),
          iacrm_questionid: q.questionId.slice(0, 100),
          iacrm_source: "EZLynx",
          iacrm_carriername: (q.carrier ?? "").slice(0, 100),
          iacrm_lob: block.lob.slice(0, 50),
          iacrm_state: (block.icq.state ?? "").slice(0, 10),
          iacrm_helptext: (q.helpText ?? "").slice(0, 500),
          iacrm_optionsjson: JSON.stringify(q.options).slice(0, 10000),
          iacrm_answertype: (q.answerType ?? "").slice(0, 50),
          iacrm_amsexternalid: extId,
          iacrm_lastseen: now
        }
      });
    }
    for (const p of block.icq.pairs) {
      if (p.answer == null) continue;
      const extId = `ezlynx:${run.openApplicationId}:${p.questionId}`;
      ops.push({
        key: `a:${extId}`,
        method: "PATCH",
        url: `iacrm_riskanswers(iacrm_amsexternalid='${esc(extId)}')`,
        body: {
          iacrm_riskanswer_name: p.label.slice(0, 300),
          iacrm_value: p.answer.slice(0, 500),
          iacrm_source: "EZLynx",
          iacrm_capturedon: run.capturedAt,
          iacrm_sourceapplicationid: String(run.openApplicationId),
          iacrm_amsexternalid: extId,
          [`${navs.accountNav}@odata.bind`]: `/accounts(${accountId})`,
          [`${navs.questionNav}@odata.bind`]: `/iacrm_carrierquestions(iacrm_amsexternalid='${esc(`ezlynx:${p.questionId}`)}')`
        }
      });
      answers++;
    }
  }

  if (ops.length) {
    const results = await api.executeBatch(env, ops);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} knowledge op(s) failed: ${failed[0]!.error}`);
  }
  return { questionsUpserted: seenQuestions.size, answersUpserted: answers, skipped: null };
}
