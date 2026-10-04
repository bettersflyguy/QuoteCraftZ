/** CRM -> portal direction: turns an insured's CRM records into captured
 * fields, so the held application can fill any carrier quote sheet. Labels
 * are chosen to hit the normalizer's alias sets exactly. */
import type { CapturedAppField } from "@/boldpenguin/types";

export interface CrmSourceRecords {
  account: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  /** iacrm_riskanswer rows (label/value), when the knowledge tables exist. */
  riskAnswers: { label: string; value: string }[];
}

const GENDER: Record<number, string> = { 1: "Male", 2: "Female" };
const MARITAL: Record<number, string> = { 1: "Single", 2: "Married", 3: "Divorced", 4: "Widowed" };

function s(record: Record<string, unknown> | null, key: string): string {
  const v = record?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function usDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : iso;
}

export function buildCrmCaptureFields(records: CrmSourceRecords): CapturedAppField[] {
  const { account, contact } = records;
  const fields: CapturedAppField[] = [];
  const push = (label: string, value: string, section = "Insured profile") => {
    if (value) fields.push({ label, value, section, group: "", source: "review-row" });
  };

  let firstName = s(contact, "firstname") || s(account, "iacrm_insuredfirstname");
  let lastName = s(contact, "lastname") || s(account, "iacrm_insuredlastname");
  // dirty records (early imports) sometimes hold the FULL name in one or both
  // name columns — repair rather than propagate
  if (firstName.includes(" ") && (firstName === lastName || !lastName)) {
    const parts = firstName.split(/\s+/);
    firstName = parts[0]!;
    lastName = parts[parts.length - 1]!;
  } else if (!firstName && lastName.includes(" ")) {
    const parts = lastName.split(/\s+/);
    firstName = parts[0]!;
    lastName = parts[parts.length - 1]!;
  }
  push("First Name", firstName);
  push("Last Name", lastName);
  const accountName = s(account, "name");
  // commercial accounts carry a business name distinct from the person
  if (accountName && (account?.["iacrm_insuredtype"] === 2 || (lastName && !accountName.toLowerCase().includes(lastName.toLowerCase())))) {
    push("Legal Business Name", accountName);
  }
  const addr = account ?? contact;
  push("Address", s(addr, "address1_line1"));
  push("Address Line 2", s(addr, "address1_line2"));
  push("City", s(addr, "address1_city"));
  push("State", s(addr, "address1_stateorprovince"));
  push("ZIP Code", s(addr, "address1_postalcode"));
  const mobile = s(account, "iacrm_mobilephone") || s(contact, "mobilephone");
  if (mobile) push("Mobile Phone Number", mobile);
  else push("Phone Number", s(account, "telephone1") || s(contact, "telephone1"));
  push("Email Address", s(account, "emailaddress1") || s(contact, "emailaddress1"));
  const dob = s(contact, "birthdate");
  if (dob) push("Date of Birth", usDate(dob));
  const gender = GENDER[Number(contact?.["gendercode"])];
  if (gender) push("Gender", gender);
  const marital = MARITAL[Number(contact?.["familystatuscode"])];
  if (marital) push("Marital Status", marital);

  for (const r of records.riskAnswers) {
    if (r.label && r.value) fields.push({ label: r.label, value: r.value, section: "Risk data", group: "", source: "review-row" });
  }
  return fields;
}
