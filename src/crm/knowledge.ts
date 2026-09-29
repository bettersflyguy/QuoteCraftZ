import type { CapturedRun } from "@/types";
import type { CrmEnvironment } from "./environments";
import type { BatchItemResult, KnowledgeNavProps } from "./dataverse";

export interface KnowledgeApi {
  getKnowledgeNavProps(env: CrmEnvironment): Promise<KnowledgeNavProps | null>;
  executeBatch(
    env: CrmEnvironment,
    ops: { key: string; method: "PATCH" | "POST" | "DELETE"; url: string; body?: unknown }[]
  ): Promise<BatchItemResult[]>;
  query<T>(env: CrmEnvironment, path: string): Promise<T>;
}

const esc = (v: string) => v.replace(/'/g, "''");

export interface KnowledgeWriteResult {
  questionsUpserted: number;
  answersUpserted: number;
  skipped: "no-tables" | null;
}

export interface QuestionSpec {
  /** Stable dictionary key, stored in iacrm_questionid (<=100 chars). */
  key: string;
  body: Record<string, unknown>;
}

export interface AnswerSpec {
  questionKey: string;
  /** Extra uniqueness within the account (EZLynx application id); null means
   * one answer per account+question, updated on re-load. */
  sourceApplicationId: string | null;
  body: Record<string, unknown>;
}

/** Shared upsert core for the question-knowledge layer. Idempotency comes
 * from READ-then-write on `iacrm_questionid` and the account/question
 * lookups — NEVER from iacrm_amsexternalid, which is reserved for the AMS
 * sync (Nathan, 2026-09-28). canonicalkey is never written here either —
 * mapping is a curation concern, not a capture concern. */
export async function upsertKnowledge(
  env: CrmEnvironment,
  accountId: string,
  questions: QuestionSpec[],
  answers: AnswerSpec[],
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const navs = await api.getKnowledgeNavProps(env);
  if (!navs) return { questionsUpserted: 0, answersUpserted: 0, skipped: "no-tables" };
  const qLogical = navs.questionNav.toLowerCase();
  const aLogical = navs.accountNav.toLowerCase();

  // 1. resolve existing dictionary rows by key
  const idByKey = new Map<string, string>();
  const keys = questions.map(q => q.key);
  for (let i = 0; i < keys.length; i += 20) {
    const filter = keys.slice(i, i + 20).map(k => `iacrm_questionid eq '${esc(k)}'`).join(" or ");
    const { value } = await api.query<{ value: Record<string, string>[] }>(
      env, `iacrm_carrierquestions?$select=iacrm_carrierquestionid,iacrm_questionid&$filter=${filter}`
    );
    for (const r of value) idByKey.set(r["iacrm_questionid"]!, r["iacrm_carrierquestionid"]!);
  }

  // 2. dictionary batch: update known rows, create the rest
  const qOps = questions.map(q => {
    const existing = idByKey.get(q.key);
    return existing
      ? { key: `q:${q.key}`, method: "PATCH" as const, url: `iacrm_carrierquestions(${existing})`, body: q.body }
      : { key: `q:${q.key}`, method: "POST" as const, url: "iacrm_carrierquestions", body: { ...q.body, iacrm_questionid: q.key } };
  });
  if (qOps.length) {
    const results = await api.executeBatch(env, qOps);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} question op(s) failed: ${failed[0]!.error}`);
    for (const r of results) {
      if (r.entityId) idByKey.set(r.key.slice(2), r.entityId);
    }
  }

  // 3. the account's existing answers, matched per question (+ source app id)
  const existingAnswers = await api.query<{ value: Record<string, string>[] }>(
    env,
    `iacrm_riskanswers?$select=iacrm_riskanswerid,iacrm_sourceapplicationid,_${qLogical}_value&$filter=_${aLogical}_value eq ${accountId}&$top=500`
  );
  const findAnswer = (questionGuid: string, sourceApp: string | null) =>
    existingAnswers.value.find(a =>
      a[`_${qLogical}_value`] === questionGuid &&
      (sourceApp == null || a["iacrm_sourceapplicationid"] === sourceApp)
    )?.["iacrm_riskanswerid"] ?? null;

  // 4. answer batch
  const aOps: { key: string; method: "PATCH" | "POST"; url: string; body: unknown }[] = [];
  for (const a of answers) {
    const questionGuid = idByKey.get(a.questionKey);
    if (!questionGuid) continue;
    const existing = findAnswer(questionGuid, a.sourceApplicationId);
    if (existing) {
      aOps.push({ key: `a:${aOps.length}`, method: "PATCH", url: `iacrm_riskanswers(${existing})`, body: a.body });
    } else {
      aOps.push({
        key: `a:${aOps.length}`, method: "POST", url: "iacrm_riskanswers",
        body: {
          ...a.body,
          [`${navs.accountNav}@odata.bind`]: `/accounts(${accountId})`,
          [`${navs.questionNav}@odata.bind`]: `/iacrm_carrierquestions(${questionGuid})`
        }
      });
    }
  }
  if (aOps.length) {
    const results = await api.executeBatch(env, aOps);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} answer op(s) failed: ${failed[0]!.error}`);
  }

  return { questionsUpserted: questions.length, answersUpserted: aOps.length, skipped: null };
}

/** Feeds the question-knowledge layer from a captured EZLynx run: dictionary
 * rows for every catalog question, answer rows for every answered one.
 * Dormant until the CRM tables deploy. */
export async function writeQuestionKnowledge(
  env: CrmEnvironment,
  run: CapturedRun,
  accountId: string,
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const now = new Date().toISOString();
  const questions: QuestionSpec[] = [];
  const answers: AnswerSpec[] = [];
  const seen = new Set<string>();

  for (const block of run.blocks) {
    if (!block.icq) continue;
    for (const q of block.icq.catalog) {
      const key = `ezlynx:${q.questionId}`.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push({
        key,
        body: {
          iacrm_carrierquestion_name: q.label.slice(0, 300),
          iacrm_source: "EZLynx",
          iacrm_carriername: (q.carrier ?? "").slice(0, 100),
          iacrm_lob: block.lob.slice(0, 50),
          iacrm_state: (block.icq.state ?? "").slice(0, 10),
          iacrm_helptext: (q.helpText ?? "").slice(0, 500),
          iacrm_optionsjson: JSON.stringify(q.options).slice(0, 10000),
          iacrm_answertype: (q.answerType ?? "").slice(0, 50),
          iacrm_lastseen: now
        }
      });
    }
    for (const p of block.icq.pairs) {
      if (p.answer == null) continue;
      answers.push({
        questionKey: `ezlynx:${p.questionId}`.slice(0, 100),
        sourceApplicationId: String(run.openApplicationId),
        body: {
          iacrm_riskanswer_name: p.label.slice(0, 300),
          iacrm_value: p.answer.slice(0, 500),
          iacrm_source: "EZLynx",
          iacrm_capturedon: run.capturedAt,
          iacrm_sourceapplicationid: String(run.openApplicationId)
        }
      });
    }
  }

  return upsertKnowledge(env, accountId, questions, answers, api);
}
