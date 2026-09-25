/** CRM load for a captured application (Bold Penguin or portal ingest) —
 * the non-EZLynx twin of the quote commit: insured enrichment from the
 * normalized projection, plus every captured field logged to the
 * question-knowledge tables for the risk-data layer. */
import { canonical, clean } from "@/boldpenguin/normalize";
import type { CapturedApplication } from "@/boldpenguin/types";
import type { CapturedApplicant } from "@/types";
import type { KnowledgeApi, KnowledgeWriteResult } from "./knowledge";
import type { CrmEnvironment } from "./environments";

const esc = (v: string) => v.replace(/'/g, "''");

function str(app: CapturedApplication, group: string, key: string): string | null {
  const v = app.normalized[group]?.[key];
  return typeof v === "string" && v ? v : null;
}

/** "10/01/2026" or "2026-10-01" -> ISO date; anything else -> null (never
 * write a guess into a birthdate). */
export function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

/** Projects the capture's normalized identity into the shape the existing
 * enrichment pipeline (ensureInsuredData) already consumes. */
export function applicantFromCapture(app: CapturedApplication): CapturedApplicant {
  let firstName = str(app, "contact", "firstName") ?? "";
  let lastName = str(app, "contact", "lastName") ?? "";
  if (!firstName && !lastName) {
    const full = clean(str(app, "contact", "fullName") ?? "");
    const parts = full.split(" ");
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }
  const street = [str(app, "address", "street1"), str(app, "address", "street2")].filter(Boolean).join(", ");
  const city = str(app, "address", "city");
  const state = str(app, "address", "state");
  const postalCode = str(app, "address", "postalCode");
  const phone = str(app, "contact", "phone");
  const email = str(app, "contact", "email");
  return {
    ezlynxApplicantId: 0,
    firstName,
    lastName,
    dateOfBirth: toIsoDate(str(app, "contact", "dateOfBirth")),
    dlNumber: null,
    dlState: null,
    address: street || city || postalCode ? { street, city: city ?? "", state: state ?? "", postalCode: postalCode ?? "" } : null,
    phones: phone ? [{ type: null, number: phone }] : [],
    emails: email ? [email] : [],
    coApplicants: [],
    isCommercial: Boolean(str(app, "business", "legalName"))
  };
}

/** The account name a new record should get: business name for commercial,
 * the person's name otherwise. */
export function accountNameFromCapture(app: CapturedApplication): string {
  return str(app, "business", "legalName") ?? str(app, "contact", "fullName") ??
    clean(`${str(app, "contact", "firstName") ?? ""} ${str(app, "contact", "lastName") ?? ""}`);
}

/** Upserts every captured field into the knowledge tables: one dictionary row
 * per canonical label (`capture:{label}`), one answer row per account+label
 * (`capture:{accountId}:{label}` — a re-load updates instead of duplicating).
 * Dormant with a notice until the CRM tables deploy, like the EZLynx writer. */
export async function writeApplicationKnowledge(
  env: CrmEnvironment,
  app: CapturedApplication,
  accountId: string,
  api: KnowledgeApi
): Promise<KnowledgeWriteResult> {
  const navs = await api.getKnowledgeNavProps(env);
  if (!navs) return { questionsUpserted: 0, answersUpserted: 0, skipped: "no-tables" };

  const now = new Date().toISOString();
  const sourceApp = str(app, "application", "id") ?? app.source.system;
  const ops: { key: string; method: "PATCH"; url: string; body?: unknown }[] = [];
  const seen = new Set<string>();

  for (const field of app.fields) {
    const label = clean(field.label);
    const value = clean(field.value);
    const canon = canonical(label).slice(0, 180);
    if (!canon || !value || seen.has(canon)) continue;
    seen.add(canon);
    const qExtId = `capture:${canon}`;
    ops.push({
      key: `q:${qExtId}`,
      method: "PATCH",
      url: `iacrm_carrierquestions(iacrm_amsexternalid='${esc(qExtId)}')`,
      body: {
        iacrm_carrierquestion_name: label.slice(0, 300),
        iacrm_questionid: canon.slice(0, 100),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_answertype: field.source.slice(0, 50),
        iacrm_amsexternalid: qExtId,
        iacrm_lastseen: now
      }
    });
    const aExtId = `capture:${accountId}:${canon}`;
    ops.push({
      key: `a:${aExtId}`,
      method: "PATCH",
      url: `iacrm_riskanswers(iacrm_amsexternalid='${esc(aExtId)}')`,
      body: {
        iacrm_riskanswer_name: label.slice(0, 300),
        iacrm_value: value.slice(0, 500),
        iacrm_source: app.source.system.slice(0, 100),
        iacrm_capturedon: app.capturedAt,
        iacrm_sourceapplicationid: sourceApp.slice(0, 100),
        iacrm_amsexternalid: aExtId,
        [`${navs.accountNav}@odata.bind`]: `/accounts(${accountId})`,
        [`${navs.questionNav}@odata.bind`]: `/iacrm_carrierquestions(iacrm_amsexternalid='${esc(qExtId)}')`
      }
    });
  }

  if (ops.length) {
    const results = await api.executeBatch(env, ops);
    const failed = results.filter(r => r.error != null);
    if (failed.length) throw new Error(`${failed.length} knowledge op(s) failed: ${failed[0]!.error}`);
  }
  return { questionsUpserted: seen.size, answersUpserted: seen.size, skipped: null };
}
