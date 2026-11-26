import type {CapturedAppField} from "@/boldpenguin/types";
import {isGridRow} from "@/boldpenguin/normalize";
/** Hide fan-out copies in the source-value list only. Stored target facts and
 * entity grids stay intact so CRM writes and person/asset rows never collapse. */
export function captureDisplayFields(fields:CapturedAppField[]):CapturedAppField[] {
  const seen=new Set<string>();
  return fields.filter(f=>{
    if(isGridRow(f))return true;
    const key=JSON.stringify([f.source,f.name??"",f.section,f.group,f.label,f.value]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}
