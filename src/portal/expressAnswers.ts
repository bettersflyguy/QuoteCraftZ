import type {CapturedApplication,CapturedAppField} from "@/boldpenguin/types";
import {normalize,CRM_BRIDGE} from "@/boldpenguin/normalize";
import {buildFillValues} from "./fillValues";
import {entityKeyOf} from "./optionMaps";
import {isRoutablePath,isIdentifierColumn} from "./fieldMaps";
import {coerce,type CatalogColumn,type FieldCatalog} from "@/crm/fieldCatalog";

export function answerColumn(target:string,catalog:FieldCatalog|null):CatalogColumn|null {
  const paths=[target,...Object.keys(CRM_BRIDGE).filter(p=>CRM_BRIDGE[p]===target)];
  const related=/^contact(\d+)\.(.+)$/.exec(target);
  const relatedCols:Record<string,string>={firstName:"firstname",lastName:"lastname",email:"emailaddress1",phone:"mobilephone",dateOfBirth:"birthdate",gender:"gendercode",maritalStatus:"familystatuscode"};
  if(related&&relatedCols[related[2]!])paths.push(`crm:contact${related[1]}.${relatedCols[related[2]!]}`);
  for(const path of paths){const key=entityKeyOf(path),name=path.split(".").at(-1);const col=catalog?.entities.find(e=>e.key===key)?.columns.find(c=>c.name===name);if(col)return col;}
  return null;
}
export function validateAnswer(target:string,raw:string,catalog:FieldCatalog|null):string {
  const value=raw.trim();
  if(!isRoutablePath(target)||target.includes("[]")||target.startsWith("secure:")||isIdentifierColumn(target.split(".").at(-1)??"")||/\.(ssn|dlNumber|socialSecurityNumber)$/i.test(target))throw new Error("This field needs its dedicated secure entry flow.");
  if(!value||value.length>4000)throw new Error("Enter a value between 1 and 4,000 characters.");
  const col=answerColumn(target,catalog);
  if(col?.maxLength&&value.length>col.maxLength)throw new Error(`Maximum ${col.maxLength} characters.`);
  if(col&&["Integer","BigInt","Decimal","Double","Money"].includes(col.type)){
    const integer=col.type==="Integer"||col.type==="BigInt";
    if(!(integer?/^-?\d+$/:/^-?\d+(?:\.\d+)?$/).test(value)||!Number.isFinite(Number(value)))throw new Error(integer?"Enter a whole number.":"Enter a number.");
  }
  if(col?.type==="DateTime"||/\.(dateOfBirth|effectiveDate|expirationDate|purchaseDate)$/.test(target)) {
    const date=new Date(`${value}T00:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error("Enter a valid date.");
  }
  if(col?.type==="Picklist"&&!col.options?.some(o=>o.label===value))throw new Error("Choose one of the listed values.");
  if(col&&coerce(col,value)===undefined)throw new Error("Enter a value valid for this CRM field.");
  return value;
}
/** Adds one missing concrete target without row realignment or overwriting
 * captured answers. Explicit target facts remain available to normal CRM load. */
export function addExpressAnswer(app:CapturedApplication,target:string,raw:string,label:string,catalog:FieldCatalog|null):CapturedApplication {
  if(buildFillValues(app)[target]?.trim())throw new Error("An answer already exists. Refresh the flyout before editing it.");
  const value=validateAnswer(target,raw,catalog);
  const field:CapturedAppField={label,value,mapped:target,section:"Express entry",group:"",source:"control",name:`quotecraftz:express:${target}`};
  const fields=[...app.fields,field];
  const fresh=normalize([field]);
  const normalized={...app.normalized};
  for(const [group,values] of Object.entries(fresh)){
    const merged={...normalized[group]};
    for(const [key,v] of Object.entries(values))if(!merged[key]||(typeof merged[key]==="string"&&!merged[key]!.trim()))merged[key]=v;
    normalized[group]=merged;
  }
  return {...app,fields,normalized,capturedAt:new Date().toISOString(),scannedSections:[...new Set([...app.scannedSections,"Express entry"])]};
}
