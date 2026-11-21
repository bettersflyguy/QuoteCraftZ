import {CRM_BRIDGE} from "@/boldpenguin/normalize";
import {mappingTargets} from "@/portal/mappingTargets";
import {isNoteTarget,type FieldMaps} from "@/portal/fieldMaps";
import {EZLYNX_FIELDS,effectiveTargets,type DataServiceMaps} from "@/sources/ezlynxSource";

export interface GraphField {id:string;key:string;binding:string;source:"page"|"ezlynx";label:string;target:string;canonical:string;output:boolean;note:boolean}
export interface GraphService {id:string;name:string;fields:GraphField[]}
export function graphTarget(target:string):string {
  // Use only bridges the runtime actually supports. Array rows stay distinct
  // from a primary contact; sharing a caption is not a relationship.
  return CRM_BRIDGE[target] || target;
}
function fields(entries:{key:string;label:string;binding:string}[],source:"page"|"ezlynx"="page"):GraphField[] {
  return entries.flatMap(({key,label,binding})=>(mappingTargets(binding).length ? mappingTargets(binding) : [""]).flatMap((target,index)=>
    target==="skip" || target.startsWith("secure:") ? [] : [{id:`${source}:${key}:${index}`,key,binding,source,label,target,canonical:graphTarget(target),output:!!target&&index===0&&!isNoteTarget(target),note:isNoteTarget(target)}]));
}
export function mappingServices(maps:FieldMaps,services:DataServiceMaps):GraphService[] {
  const out=Object.entries(maps).sort(([a],[b])=>a.localeCompare(b)).map(([origin,map])=>({
    id:origin,name:new URL(origin).hostname,
    fields:fields(Object.entries(map).map(([key,binding],i)=>({key,binding,label:key.startsWith("field:") ? key.slice(6).replace(/\|/g," / ").replace(/>/g,": ") : key.startsWith("pick:") ? `Selected page field ${i+1}` : key.replace(/^[^:]+:/,"")})))
  }));
  // Built-in service mappings use the same relationship editor as page fields.
  {
    const effective=effectiveTargets(services.ezlynx);
    const ds=fields(EZLYNX_FIELDS.filter(f=>!f.secured).map(f=>({key:f.id,label:`${f.section}: ${f.label}`,binding:effective[f.id]||""})),"ezlynx");
    const page=out.find(s=>s.id==="https://app.ezlynx.com");
    if(page) page.fields.push(...ds);
    else out.push({id:"https://app.ezlynx.com",name:"app.ezlynx.com",fields:ds});
  }
  return out.filter(s=>s.fields.length);
}
