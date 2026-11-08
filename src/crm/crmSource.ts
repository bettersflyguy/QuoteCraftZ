/** CRM -> portal direction: turns an insured's CRM records into captured
 * fields, so the held application can fill any carrier quote sheet. Labels
 * are chosen to hit the normalizer's alias sets exactly. */
import type { CapturedAppField } from "@/boldpenguin/types";
import type { CatalogColumn, FieldCatalog } from "./fieldCatalog";
import { displayDate } from "@/portal/fillValues";

export interface CrmSourceRecords {
  account: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  /** iacrm_riskanswer rows (label/value), when the knowledge tables exist. */
  riskAnswers: { label: string; value: string }[];
  /** Every active contact on the account - agent context in the panel;
   * the portal mapper skips this section so they never fill forms. */
  relatedContacts?: Record<string, unknown>[];
  /** Full records (all columns) for column-level fill. */
  full?: {
    account: Record<string, unknown> | null;
    primary: Record<string, unknown> | null;
    /** Related (non-primary) contacts in slot order: [0] = contact2. */
    related: Record<string, unknown>[];
  };
}

/** One CRM column's text for a form: the display value for choices, yes/no
 * and money, M/D/YYYY for dates, the raw text otherwise. */
function columnText(rec: Record<string, unknown>, col: CatalogColumn): string {
  const raw = rec[col.name];
  if (raw === null || raw === undefined || raw === "") return "";
  const formatted = rec[`${col.name}@OData.Community.Display.V1.FormattedValue`];
  if ((col.type === "Picklist" || col.type === "Boolean" || col.type === "Money") && typeof formatted === "string") return formatted.trim();
  if (col.type === "DateTime" && typeof raw === "string") return displayDate(raw.slice(0, 10));
  return String(raw).trim().slice(0, 1000);
}

/** Every catalog column the insured's CRM records hold, as captured fields
 * routed to their exact "crm:" target - so a carrier form mapped to ANY CRM
 * column fills from Fill from CRM. Secured columns are never included (the
 * catalog's columns list excludes them; they fill by pass-through only). */
export function buildCrmColumnFields(records: CrmSourceRecords, catalog: FieldCatalog | null): CapturedAppField[] {
  const out: CapturedAppField[] = [];
  if (!catalog || !records.full) return out;
  const entity = (key: string) => catalog.entities.find(e => e.key === key);
  const add = (rec: Record<string, unknown> | null, key: string, target: string, section: string, group = "") => {
    const e = entity(key);
    if (!rec || !e) return;
    for (const col of e.columns) {
      const value = columnText(rec, col);
      if (value) out.push({ label: col.label, value, section, group, source: "review-row", mapped: `${target}.${col.name}` });
    }
  };
  add(records.full.account, "account", "crm:account", "CRM: Insured (account)");
  add(records.full.primary, "primarycontact", "crm:primarycontact", "CRM: Primary contact");
  records.full.related.forEach((c, i) => add(c, "contacts", `crm:contact${i + 2}`, "Related contacts (CRM)", `Row ${i + 1}`));
  return out;
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

  // the ACCOUNT's insured name columns are the named insured; the primary
  // contact can be a spouse/co-insured (Tracey Dittrich's account lists
  // Alexander as primary contact) - it only speaks for the insured when the
  // names agree, and person-specific fields (DOB/gender/marital, contact
  // phone/email fallbacks) are suppressed otherwise
  const insuredFirst = s(account, "iacrm_insuredfirstname");
  const insuredLast = s(account, "iacrm_insuredlastname");
  const contactIsInsured =
    (!insuredFirst && !insuredLast) ||
    (s(contact, "firstname").toLowerCase() === insuredFirst.toLowerCase() &&
      s(contact, "lastname").toLowerCase() === insuredLast.toLowerCase());
  let firstName = insuredFirst || s(contact, "firstname");
  let lastName = insuredLast || s(contact, "lastname");
  // dirty records (early imports) sometimes hold the FULL name in one or both
  // name columns - repair rather than propagate
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
  const mobile = s(account, "iacrm_mobilephone") || (contactIsInsured ? s(contact, "mobilephone") : "");
  if (mobile) push("Mobile Phone Number", mobile);
  else push("Phone Number", s(account, "telephone1") || (contactIsInsured ? s(contact, "telephone1") : ""));
  push("Email Address", s(account, "emailaddress1") || (contactIsInsured ? s(contact, "emailaddress1") : ""));
  if (contactIsInsured) {
    const dob = s(contact, "birthdate");
    if (dob) push("Date of Birth", usDate(dob));
    const gender = GENDER[Number(contact?.["gendercode"])];
    if (gender) push("Gender", gender);
    const marital = MARITAL[Number(contact?.["familystatuscode"])];
    if (marital) push("Marital Status", marital);
  }

  for (const r of records.riskAnswers) {
    if (r.label && r.value) fields.push({ label: r.label, value: r.value, section: "Risk data", group: "", source: "review-row" });
  }

  const primaryId = account?.["_primarycontactid_value"];
  for (const c of records.relatedContacts ?? []) {
    const name = s(c, "fullname");
    if (!name) continue;
    const dob = s(c, "birthdate");
    const detail = [
      s(c, "emailaddress1"),
      s(c, "mobilephone") || s(c, "telephone1"),
      dob ? `DOB ${usDate(dob)}` : "",
      s(c, "jobtitle")
    ].filter(Boolean).join(" · ");
    const label = c["contactid"] === primaryId ? `${name} (primary)` : name;
    fields.push({ label, value: detail || "-", section: "Related contacts", group: "", source: "entity-card" });
  }
  return fields;
}
