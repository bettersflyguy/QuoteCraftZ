import type {CapturedApplication} from "@/boldpenguin/types";
import {pendingNameReviews} from "@/boldpenguin/nameReview";
import {buildFillValues} from "./fillValues";
import {rowTargetOf,toRowTarget,ARRAY_ROW_MAX} from "./fieldMaps";
import type {GraphService} from "@/options/mappingGraph";
import {entityGroup} from "@/options/relationshipLayout";
import type {FieldCatalog} from "@/crm/fieldCatalog";

export interface MissingAnswer {label:string;target:string;group:string;row:string}
export interface DestinationReadiness {id:string;name:string;available:number;total:number;percent:number|null;missing:MissingAnswer[];mappedFields:number;nameReview:boolean}
const family=(path:string)=>path.split("[].")[0]!.replace(/^crm:/,"");
/** Resolve the same concrete fill paths used by the filler, counting all
 * known rows in a collection, not just whichever row happens to be complete. */
export function readinessPaths(target:string,values:Record<string,string>):{path:string;row:string}[] {
  if(!target.includes("[]."))return [{path:target,row:""}];
  const kind=family(target);
  const rows=new Set<number>();
  for(const path of Object.keys(values)) {
    const slot=rowTargetOf(path);
    if(slot&&family(slot.arrayPath)===kind)rows.add(slot.row);
  }
  const suffix=target.split("[].")[1]!;
  if(kind==="contacts") {
    const primary=target.startsWith("crm:")?`crm:primarycontact.${suffix}`:`contact.${suffix}`;
    return [{path:primary,row:"Applicant"},...[...rows].sort((a,b)=>a-b).filter(r=>r<=ARRAY_ROW_MAX).map(r=>({path:toRowTarget(target,r)!,row:`Contact ${r+1}`}))];
  }
  if(!rows.size)rows.add(1);
  return [...rows].sort((a,b)=>a-b).filter(r=>r<=ARRAY_ROW_MAX).flatMap(r=>{const path=toRowTarget(target,r);return path?[{path,row:`Row ${r}`}]:[];});
}
export function destinationReadiness(services:GraphService[],app:CapturedApplication|null,catalog:FieldCatalog|null=null):DestinationReadiness[] {
  const values=buildFillValues(app);
  const reviews=app?pendingNameReviews(app):[];
  const blockedNames=new Set(reviews.flatMap(r=>{const crm=r.group==="contact"?"crm:primarycontact":`crm:${r.group}`;return [`${r.group}.firstName`,`${r.group}.lastName`,`${crm}.firstname`,`${crm}.lastname`,...(r.group==="contact"?["crm:account.iacrm_insuredfirstname","crm:account.iacrm_insuredlastname"]:[])];}));
  return services.map(service=>{
    let available=0,total=0;
    const missing:MissingAnswer[]=[];
    // Graph output fields already exclude notes, Never fill, secured fields,
    // and additional capture targets that aren't the preferred fill source.
    const fields=service.fields.filter(f=>f.output);
    for(const field of fields)for(const item of readinessPaths(field.target,values)) {
      total++;
      if(!blockedNames.has(item.path)&&typeof values[item.path]==="string"&&values[item.path]!.trim())available++;
      else missing.push({label:field.label.replace(/^[^:]+:\s*/,""),target:item.path,group:entityGroup(field.target,catalog).label,row:item.row});
    }
    return {id:service.id,name:service.name,available,total,percent:total?Math.floor(available*100/total):null,missing,mappedFields:fields.length,nameReview:reviews.length>0};
  });
}
