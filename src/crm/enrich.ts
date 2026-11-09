import type { CapturedApplicant } from "@/types";
import type { CrmEnvironment } from "./environments";

/** Account fields the enrichment reads and may fill. Custom iacrm_ columns are
 * what the Insured form actually displays (verified against solution source) -
 * writing only OOB telephone1 leaves the form looking empty. */
export interface AccountEnrichmentState {
  telephone1: string | null;
  emailaddress1: string | null;
  address1_line1: string | null;
  address1_city: string | null;
  address1_stateorprovince: string | null;
  address1_postalcode: string | null;
  iacrm_mobilephone: string | null;
  iacrm_insuredfirstname: string | null;
  iacrm_insuredlastname: string | null;
  primaryContactId: string | null;
}

export interface ContactRow {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobilePhone: string | null;
  telephone1: string | null;
}

export interface NewContact {
  accountId: string;
  firstName: string;
  lastName: string;
  mobilePhone: string | null;
  email: string | null;
  birthdate: string | null;
  dlNumber?: string | null;
  dlState?: string | null;
  /** Catalog-coerced CRM column values captured for this person; explicit
   * fields above win over them. */
  extra?: Record<string, unknown>;
}

export interface EnrichApi {
  getAccountEnrichmentState(env: CrmEnvironment, accountId: string): Promise<AccountEnrichmentState>;
  updateAccount(env: CrmEnvironment, accountId: string, patch: Record<string, unknown>): Promise<void>;
  getAccountContacts(env: CrmEnvironment, accountId: string): Promise<ContactRow[]>;
  createContact(env: CrmEnvironment, c: NewContact): Promise<string>;
  /** true when the field-secured DL columns are deployed on contact */
  contactHasDlColumns(env: CrmEnvironment): Promise<boolean>;
}

/** Create with secured DL fields when possible; if the write is rejected
 * (typically: agent not in the field security profile), retry without them so
 * a missing profile membership never blocks contact creation. */
async function createContactSafe(env: CrmEnvironment, api: EnrichApi, c: NewContact): Promise<string> {
  // secured DL fields and captured extra columns are both optional riders: a
  // rejected rider must never block creating the person
  const attempts: NewContact[] = [c];
  if (c.dlNumber || c.dlState) attempts.push({ ...c, dlNumber: null, dlState: null });
  if (c.extra && Object.keys(c.extra).length) attempts.push({ ...c, dlNumber: null, dlState: null, extra: undefined });
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try { return await api.createContact(env, attempt); } catch (e) { lastError = e; }
  }
  throw lastError;
}

export interface EnrichResult {
  filledFields: string[];
  contactsCreated: string[];
  primaryContactSet: boolean;
  /** The contact representing the captured applicant (matched or created). */
  applicantContactId: string | null;
  /** Related people that matched EXISTING contacts - their captured column
   * values still need a fill-if-empty pass (created ones got them on create). */
  matchedCoContacts: { contactId: string; extra: Record<string, unknown> }[];
  /** Every related person's CRM contact (matched or created), by the slot
   * they came from - their own timeline note goes there. */
  coContactIds: { slot: number | null; contactId: string }[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

interface Candidate { firstName: string; lastName: string; phone: string | null; email: string | null }

/** Dedup rule (Nathan, 2026-08-15): an existing contact matches ONLY when
 *  - email matches exactly (case-insensitive), OR
 *  - first AND last AND phone all match exactly.
 * Name alone never merges two people (same-name relatives are common in
 * insurance). Fallback: when NEITHER side carries an email or phone there is
 * nothing to compare, so name-only decides - otherwise every re-import would
 * duplicate data-poor contacts. */
function contactMatches(existing: ContactRow, cand: Candidate): boolean {
  if (existing.email && cand.email && norm(existing.email) === norm(cand.email)) return true;

  const nameEq = norm(existing.firstName) === norm(cand.firstName) && norm(existing.lastName) === norm(cand.lastName);
  const candPhone = digits(cand.phone);
  const existingPhones = [existing.mobilePhone, existing.telephone1].map(digits).filter(Boolean);
  if (nameEq && candPhone && existingPhones.includes(candPhone)) return true;

  const candHasSignals = Boolean(cand.email || candPhone);
  const existingHasSignals = Boolean(existing.email || existingPhones.length);
  if (nameEq && (!candHasSignals || !existingHasSignals)) return true;

  return false;
}

/** Who becomes the account's primary contact: a person's slot (1 = the
 * applicant, N = related contact slot N). `explicit`: the agent picked it -
 * only then may an account that already HAS a primary contact change. */
export interface PrimaryChoice { slot: number; explicit: boolean }

/** Fill-if-empty enrichment of the matched/created insured from the EZLynx
 * applicant, plus find-or-create Contacts (applicant + co-applicants). The
 * primary contact pointer is set to the chosen person (default the
 * applicant) when the account has none, and changed on an existing account
 * ONLY when the agent explicitly picked someone else. The named insured
 * (insured first/last name) stays the applicant either way. NEVER
 * overwrites a non-empty value - agent-entered data always wins. */
export async function ensureInsuredData(
  env: CrmEnvironment,
  accountId: string,
  applicant: CapturedApplicant,
  api: EnrichApi,
  primary: PrimaryChoice = { slot: 1, explicit: false }
): Promise<EnrichResult> {
  const state = await api.getAccountEnrichmentState(env, accountId);

  const mobile = applicant.phones.find(p => /mobile/i.test(p.type ?? ""))?.number ?? null;
  const anyPhone = applicant.phones[0]?.number ?? null;
  const email = applicant.emails[0] ?? null;

  const patch: Record<string, unknown> = {};
  const fill = (field: keyof AccountEnrichmentState & string, value: string | null) => {
    if (value && !state[field]) patch[field] = value;
  };
  fill("telephone1", anyPhone);
  fill("iacrm_mobilephone", mobile);
  fill("emailaddress1", email);
  fill("address1_line1", applicant.address?.street ?? null);
  fill("address1_city", applicant.address?.city ?? null);
  fill("address1_stateorprovince", applicant.address?.state ?? null);
  fill("address1_postalcode", applicant.address?.postalCode ?? null);
  fill("iacrm_insuredfirstname", applicant.firstName);
  fill("iacrm_insuredlastname", applicant.lastName);

  const existing = await api.getAccountContacts(env, accountId);
  const dlColumns = await api.contactHasDlColumns(env);

  const contactsCreated: string[] = [];
  const applicantCand: Candidate = { firstName: applicant.firstName, lastName: applicant.lastName, phone: mobile ?? anyPhone, email };
  let applicantContactId = existing.find(c => contactMatches(c, applicantCand))?.contactId ?? null;
  if (!applicantContactId) {
    applicantContactId = await createContactSafe(env, api, {
      accountId,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      mobilePhone: mobile,
      email,
      birthdate: applicant.dateOfBirth,
      dlNumber: dlColumns ? applicant.dlNumber : null,
      dlState: dlColumns ? applicant.dlState : null
    });
    contactsCreated.push(`${applicant.firstName} ${applicant.lastName}`);
  }
  const matchedCoContacts: EnrichResult["matchedCoContacts"] = [];
  const coContactIds: EnrichResult["coContactIds"] = [];
  for (const co of applicant.coApplicants) {
    const cand: Candidate = { firstName: co.firstName, lastName: co.lastName, phone: co.phone, email: co.email };
    const hit = existing.find(c => contactMatches(c, cand));
    if (hit) {
      if (co.extra && Object.keys(co.extra).length) matchedCoContacts.push({ contactId: hit.contactId, extra: co.extra });
      coContactIds.push({ slot: co.slot ?? null, contactId: hit.contactId });
      continue;
    }
    const createdId = await createContactSafe(env, api, {
      accountId,
      firstName: co.firstName,
      lastName: co.lastName,
      mobilePhone: co.phone,
      email: co.email,
      birthdate: co.dateOfBirth,
      dlNumber: dlColumns ? co.dlNumber : null,
      dlState: dlColumns ? co.dlState : null,
      extra: co.extra
    });
    contactsCreated.push(`${co.firstName} ${co.lastName}`);
    if (createdId) coContactIds.push({ slot: co.slot ?? null, contactId: createdId });
  }

  let primaryContactSet = false;
  const chosenId = primary.slot === 1 ? applicantContactId : coContactIds.find(c => c.slot === primary.slot)?.contactId ?? null;
  const target = chosenId ?? (primary.explicit ? null : applicantContactId);
  if (target && (!state.primaryContactId || (primary.explicit && target !== state.primaryContactId))) {
    patch["primarycontactid@odata.bind"] = `/contacts(${target})`;
    primaryContactSet = true;
  }

  if (Object.keys(patch).length > 0) await api.updateAccount(env, accountId, patch);

  return {
    filledFields: Object.keys(patch).filter(k => k !== "primarycontactid@odata.bind"),
    contactsCreated,
    primaryContactSet,
    applicantContactId,
    matchedCoContacts,
    coContactIds
  };
}

export interface ServicingApi {
  assignOwner(env: CrmEnvironment, entitySet: string, id: string, ownerId: string): Promise<void>;
  hasServicingTeamMember(env: CrmEnvironment, accountId: string, userId: string): Promise<boolean>;
  createServicingTeamMember(env: CrmEnvironment, m: { accountId: string; userId: string; name: string }): Promise<void>;
}

export interface ServicingInput {
  accountId: string;
  ownerId: string;
  ownerName: string;
  accountCreatedByPanel: boolean;
  createdOpportunityIds: string[];
}

export interface ServicingResult { ownersAssigned: number; teamMemberCreated: boolean }

/** Ownership follows the chosen servicing agent - but only onto records THIS
 * import created. Matched/pre-existing records keep their owner (agent data
 * wins). The servicing-team row is ensured on the account either way. */
export async function ensureServicingAssignment(
  env: CrmEnvironment,
  input: ServicingInput,
  api: ServicingApi
): Promise<ServicingResult> {
  let ownersAssigned = 0;
  if (input.accountCreatedByPanel) {
    await api.assignOwner(env, "accounts", input.accountId, input.ownerId);
    ownersAssigned++;
  }
  for (const oppId of input.createdOpportunityIds) {
    await api.assignOwner(env, "opportunities", oppId, input.ownerId);
    ownersAssigned++;
  }
  let teamMemberCreated = false;
  if (!(await api.hasServicingTeamMember(env, input.accountId, input.ownerId))) {
    await api.createServicingTeamMember(env, {
      accountId: input.accountId,
      userId: input.ownerId,
      name: input.ownerName
    });
    teamMemberCreated = true;
  }
  return { ownersAssigned, teamMemberCreated };
}
