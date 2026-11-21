import {CATALOG_ENTITIES,type FieldCatalog} from "@/crm/fieldCatalog";
import {SLOT_ENTITY} from "@/portal/assetTables";
import {isNoteTarget,noteLabelOf} from "@/portal/fieldMaps";

export const LAYOUT_KEY="settings/relationshipLayout";
export const clampWidth=(value:number)=>Math.max(180,Math.min(900,Math.round(value)));
export const clampOffset=(value:number)=>Math.max(-3000,Math.min(3000,Math.round(value)));
export interface Layout {widths:Record<string,number>;offsets:Record<string,number>;gap:number}
export function readLayout(raw:unknown):Layout {
  const saved=raw&&typeof raw==="object"?raw as Partial<Layout>:{};
  const widths=Object.fromEntries(Object.entries(saved.widths??{}).filter(([,v])=>typeof v==="number"&&Number.isFinite(v)).map(([k,v])=>[k,clampWidth(v)]));
  const offsets=Object.fromEntries(Object.entries(saved.offsets??{}).filter(([,v])=>typeof v==="number"&&Number.isFinite(v)).map(([k,v])=>[k,clampOffset(v)]));
  return {widths,offsets,gap:typeof saved.gap==="number"&&Number.isFinite(saved.gap)?Math.max(40,Math.min(240,saved.gap)):80};
}
export function entityGroup(target:string,catalog:FieldCatalog|null):{id:string;label:string;logical:string} {
  if(isNoteTarget(target))return {id:target,label:noteLabelOf(target),logical:"annotation · timeline"};
  const crm=/^crm:([a-z]+)(\d*)(\[\])?\./.exec(target);
  const semantic=/^([a-zA-Z]+)(\d*)(\[\])?\./.exec(target);
  const parsed=crm??semantic;
  let key=parsed?.[1]??"other";
  const slot=parsed?.[2];
  if(slot)key=SLOT_ENTITY[key]??key;
  if(!crm)key=({contact:"primarycontact",address:"account",priorCoverage:"priorcoverage"} as Record<string,string>)[key]??key;
  const entity=catalog?.entities.find(e=>e.key===key);
  const fallback=CATALOG_ENTITIES.find(e=>e.key===key);
  const label=entity?.label??fallback?.label??key;
  const logical=entity?.logical??fallback?.logical??"";
  return {id:`${key}${slot?`:${slot}`:""}`,label:slot?`${label.replace(/ \(all rows\)$/," ")} · row ${slot}`:label,logical};
}
