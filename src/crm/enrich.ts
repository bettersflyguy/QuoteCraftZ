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
}

export interface NewContact {
  accountId: string;
  firstName: string;
  lastName: string;
  mobilePhone: string | null;
  email: string | null;
  birthdate: string | null;
}

export interface EnrichApi {
  getAccountEnrichmentState(env: CrmEnvironment, accountId: string): Promise<AccountEnrichmentState>;
  updateAccount(env: CrmEnvironment, accountId: string, patch: Record<string, unknown>): Promise<void>;
  getAccountContacts(env: CrmEnvironment, accountId: string): Promise<ContactRow[]>;
  createContact(env: CrmEnvironment, c: NewContact): Promise<string>;
}

export interface EnrichResult {
  filledFields: string[];
  contactsCreated: string[];
  primaryContactSet: boolean;
}

const nameKey = (first: string, last: string) => `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;

/** Fill-if-empty enrichment of the matched/created insured from the EZLynx
 * applicant, plus find-or-create Contacts (applicant + co-applicants) with the
 * applicant as primary contact when none is set. NEVER overwrites a non-empty
 * value - agent-entered data always wins over rater data. */
export async function ensureInsuredData(
  env: CrmEnvironment,
  accountId: string,
  applicant: CapturedApplicant,
  api: EnrichApi
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
  const byName = new Map(existing.map(c => [nameKey(c.firstName, c.lastName), c.contactId]));

  const contactsCreated: string[] = [];
  let applicantContactId = byName.get(nameKey(applicant.firstName, applicant.lastName)) ?? null;
  if (!applicantContactId) {
    applicantContactId = await api.createContact(env, {
      accountId,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      mobilePhone: mobile,
      email,
      birthdate: applicant.dateOfBirth
    });
    contactsCreated.push(`${applicant.firstName} ${applicant.lastName}`);
  }
  for (const co of applicant.coApplicants) {
    if (byName.has(nameKey(co.firstName, co.lastName))) continue;
    await api.createContact(env, {
      accountId,
      firstName: co.firstName,
      lastName: co.lastName,
      mobilePhone: null,
      email: null,
      birthdate: null
    });
    contactsCreated.push(`${co.firstName} ${co.lastName}`);
  }

  let primaryContactSet = false;
  if (!state.primaryContactId && applicantContactId) {
    patch["primarycontactid@odata.bind"] = `/contacts(${applicantContactId})`;
    primaryContactSet = true;
  }

  if (Object.keys(patch).length > 0) await api.updateAccount(env, accountId, patch);

  return {
    filledFields: Object.keys(patch).filter(k => k !== "primarycontactid@odata.bind"),
    contactsCreated,
    primaryContactSet
  };
}
