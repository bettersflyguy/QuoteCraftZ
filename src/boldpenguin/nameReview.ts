import type { CapturedApplication } from "./types";
import { parsePersonName, type NameFormat } from "@/util/personName";

export interface ReviewedName { fingerprint:string; firstName:string; lastName:string }
export interface NameReviewItem {
  group:string; original:string; fingerprint:string; firstName:string; lastName:string;
  confirmed:boolean; needsReview:boolean;
}
const text = (value:unknown) => typeof value === "string" ? value.normalize("NFC").replace(/\s+/g," ").trim() : "";
const personGroup = /^contact(?:[2-9]|[1-3]\d)?$/;
const columnGroup = (group:string) => group === "contact" ? "crm:primarycontact" : `crm:${group}`;
const explicitParts = (app:CapturedApplication,group:string) => app.fields.some(f=>
  [`${group}.firstName`,`${group}.lastName`,`${columnGroup(group)}.firstname`,`${columnGroup(group)}.lastname`].includes(f.mapped || ""));

function details(app:CapturedApplication, group:string) {
  const person=app.normalized[group] || {};
  const source=[...app.fields].reverse().find(f=>[`${group}.fullName`,`${group}.latinFullName`,`${columnGroup(group)}.fullname`].includes(f.mapped || "") && text(f.value));
  const original=text(source?.value || person.fullName || person.latinFullName);
  const fingerprint=JSON.stringify([app.source?.leadKey || "",group,original,text(person.dateOfBirth),text(person.email),text(person.phone)]);
  const review=app.nameReviews?.[group];
  const confirmed=Boolean(review && review.fingerprint===fingerprint && typeof review.firstName==="string" && typeof review.lastName==="string" && review.lastName.trim() && !explicitParts(app,group));
  return {person,original,fingerprint,review,confirmed};
}

/** Alternate boundaries are per captured person, never a site-wide locale. */
export function nameSplit(original:string,format:NameFormat) {
  const parsed=parsePersonName(original,format);
  return {firstName:[parsed.firstName,parsed.middleName].filter(Boolean).join(" "),lastName:parsed.lastName};
}

export function nameReviewItems(app:CapturedApplication):NameReviewItem[] {
  return Object.keys(app.normalized).filter(g=>personGroup.test(g)).flatMap(group=>{
    const {person,original,fingerprint,review,confirmed}=details(app,group);
    if (!original || explicitParts(app,group)) return [];
    const fullSource=Boolean(person.latinFullName) || app.fields.some(f=>
      f.mapped===`${group}.fullName` || f.mapped===`${group}.latinFullName` ||
      (/^(name|full name|contact name|applicant name|insured name)$/i.test(f.label.trim()) && text(f.value)===original));
    // Already structured CRM / data-service names need no new split.
    if (!confirmed && !fullSource && (person.firstName || person.lastName)) return [];
    const parsed=parsePersonName(original);
    const split=nameSplit(original,"auto");
    return [{group,original,fingerprint,firstName:confirmed ? review!.firstName : split.firstName,
      lastName:confirmed ? review!.lastName : split.lastName,confirmed,needsReview:parsed.needsReview && !confirmed}];
  });
}

export const pendingNameReviews = (app:CapturedApplication) => nameReviewItems(app).filter(n=>n.needsReview);
export function requireReviewedNames(app:CapturedApplication):void {
  if (pendingNameReviews(app).length) throw new Error("Confirm the captured name split in Intake before filling a form or loading CRM.");
}

/** This does not change the original field or the account-name target. */
export function withReviewedNames(app:CapturedApplication):CapturedApplication {
  const normalized={...app.normalized};
  for (const group of Object.keys(normalized).filter(g=>personGroup.test(g))) {
    const {confirmed,review,original,person}=details(app,group);
    if (original && !explicitParts(app,group) && original!==person.fullName) {
      normalized[group]={...normalized[group],fullName:original};
      delete normalized[group]!.firstName;delete normalized[group]!.lastName;
    }
    if (confirmed) normalized[group]={...normalized[group],firstName:review!.firstName,lastName:review!.lastName};
  }
  return {...app,normalized};
}

export function confirmNameSplit(app:CapturedApplication, input:{group:string;fingerprint:string;firstName:string;lastName:string}):CapturedApplication {
  const item=nameReviewItems(app).find(n=>n.group===input.group && n.fingerprint===input.fingerprint);
  if (!item) throw new Error("The captured person changed. Review the current name and try again.");
  const firstName=text(input.firstName),lastName=text(input.lastName);
  if (!lastName || firstName.length>100 || lastName.length>100) throw new Error("Enter a surname and keep each name field within 100 characters.");
  return {...app,capturedAt:new Date().toISOString(),nameReviews:{...app.nameReviews,[item.group]:{fingerprint:item.fingerprint,firstName,lastName}}};
}
