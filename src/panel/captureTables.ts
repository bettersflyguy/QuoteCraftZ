import type { CapturedAppField } from '@/boldpenguin/types';
import { isGridRow } from '@/boldpenguin/normalize';
import { recordRefOf, recordTables, type RecordTable } from '@/boldpenguin/recordTables';
import { ROW_TABLES } from '@/portal/assetTables';

const titles: Record<string,string>={contact:'Contacts',address:'Addresses',policy:'Policies',...Object.fromEntries(ROW_TABLES.map(t=>[t.slot,t.label.replace(/ \(all rows\)$/,'')]))};

/** Display native form controls as records too: their stored capture shape
 * and CRM destinations remain untouched. Existing repeated tables retain
 * their row/identity reconciliation rules. */
export function captureTables(fields: CapturedAppField[]): RecordTable[] {
  return recordTables(fields.map(f=>{
    if(isGridRow(f))return f;
    const ref=recordRefOf(f.mapped);
    if(ref)return {...f,section:titles[ref.kind]??ref.kind,group:`Row ${ref.slot}`};
    const native=/^(?:DriverCtlHeader|DriverCtlBody)_(\d+)\$/.exec(f.name??'');
    if(native && !f.mapped)return {...f,section:'Contacts',group:`Row ${native[1]}`};
    const entity=/^crm:(account|opportunity|quote|priorcoverage)\./.exec(f.mapped??'')?.[1];
    const section=entity?({account:'Insured',opportunity:'Opportunity',quote:'Quote',priorcoverage:'Prior coverage'}[entity]!):(f.section||'Page');
    return {...f,section,group:'Row 1'};
  }));
}

/** The secured preview pivots masked values only; raw identifiers never
 * enter a display table or export through this helper. */
export function securedCaptureTable(fields:{path:string;label:string;masked:string}[]):RecordTable {
  const columns=['Record'];
  const rows=new Map<string,Record<string,string>>();
  const order=(path:string)=>path.startsWith('secure:primarycontact.')?1:Number(/^secure:contact(\d+)\./.exec(path)?.[1]??99);
  for(const f of [...fields].sort((a,b)=>order(a.path)-order(b.path))){
    const parts=f.label.replace(/^Secured: /,'').split(': ');
    const record=parts.length>1?parts.slice(0,-1).join(': '):'Insured';
    const column=parts.at(-1)||'Identifier';
    if(!columns.includes(column))columns.push(column);
    const row=rows.get(record)??{Record:record};
    row[column]=f.masked;rows.set(record,row);
  }
  return {title:'Secured',columns,rows:[...rows.values()],hasPrimary:false};
}
