import type { CapturedAppField } from './types';
import { isGridRow } from './normalize';
import { recordRefOf, recordTables, type RecordTable } from './recordTables';

const TYPES: Record<string, {title:string;singular:string}> = {
  vehicle:{title:'Vehicles',singular:'Vehicle'}, property:{title:'Properties',singular:'Property'},
  contact:{title:'Drivers / contacts',singular:'Contact'}
};
const destinationTitle=(target:string|undefined)=>({note:'Insured','note:opportunity':'Opportunity','note:quote':'Quote','note:policy':'Policy'} as Record<string,string>)[target??''] || 'Other risks';
const policyContext=(section:string|undefined)=>/^(?:(?:prior|new) .{1,30} policy|opportunity policy - .{1,30})$/i.test(section??'');

function recordIdentity(kind:string,slot:number,context:CapturedAppField[]):string {
  const values=new Map<string,string>();
  for(const f of context){
    const ref=recordRefOf(f.mapped);
    if(ref?.kind===kind && ref.slot===slot && f.value && !values.has(ref.column))values.set(ref.column,f.value);
  }
  const joined=(keys:string[])=>keys.map(k=>values.get(k)).filter(Boolean).join(' ');
  if(kind==='contact')return joined(['firstname','lastname']) || values.get('fullname') || '';
  if(kind==='vehicle')return joined(['year','make','model']) || values.get('vin') || '';
  if(kind==='property')return values.get('addressline1') || values.get('line1') || values.get('street1') || '';
  return '';
}

/** One fallback table per record type, shared by Intake and CRM note HTML.
 * Target slots define rows even when different records have different fields
 * or were captured on different pages. Display grouping never changes routing. */
export function noteTables(fields:CapturedAppField[],context:CapturedAppField[]=fields):RecordTable[] {
  const display:CapturedAppField[]=[];
  const records=new Set<string>();
  const contextual=new Set(fields.filter(f=>!isGridRow(f)&&policyContext(f.section)).map(f=>destinationTitle(f.mapped)));
  const contextRows=new Map<string,Map<string,number>>();
  for(const f of fields){
    const m=/^note:(vehicle|property|contact)(\d+)?$/.exec(f.mapped??'');
    const array=/^note:(vehicles|properties|contacts)\[\]$/.exec(f.mapped??'');
    const kind=m?.[1] || (array?({vehicles:'vehicle',properties:'property',contacts:'contact'}[array[1]!]!):'');
    if(kind){
      const slot=m?Number(m[2]||1):Number(/^Row (\d+)$/.exec(f.group??'')?.[1]||1);
      const cfg=TYPES[kind]!;
      const group=`Row ${slot}`, key=`${kind}:${slot}`;
      if(!records.has(key)){
        records.add(key);
        const name=recordIdentity(kind,slot,context);
        const label=kind==='contact'&&slot===1?'Primary contact':`${cfg.singular} ${slot}`;
        display.push({...f,section:cfg.title,group,mapped:undefined,label:'Record',value:name?`${label} · ${name}`:label});
      }
      display.push({...f,section:cfg.title,group,mapped:undefined});
      continue;
    }
    // Existing grids of other risks retain their real row structure. Single
    // fallback controls share their destination's table across source pages.
    const title=destinationTitle(f.mapped);
    let group=isGridRow(f)?f.group:'Row 1';
    if(!isGridRow(f)&&contextual.has(title)){
      const scope=policyContext(f.section)?f.section:'General';
      const rows=contextRows.get(title)??new Map<string,number>();
      if(!rows.has(scope))rows.set(scope,rows.size+1);
      contextRows.set(title,rows);
      group=`Row ${rows.get(scope)}`;
      const key=`generic:${title}:${scope}`;
      if(!records.has(key)){
        records.add(key);
        display.push({...f,section:title,group,mapped:undefined,label:'Record',value:scope});
      }
    }
    display.push({...f,section:isGridRow(f)?f.section||title:title,group,mapped:undefined});
  }
  return recordTables(display);
}
