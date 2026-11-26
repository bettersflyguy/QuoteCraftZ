import {useId,useState} from "react";
import {answerColumn,validateAnswer} from "@/portal/expressAnswers";
import type {FieldCatalog} from "@/crm/fieldCatalog";
import type {MissingAnswer} from "@/portal/destinationReadiness";
export function MissingAnswerInput({field,catalog,disabled,onSave}:{field:MissingAnswer;catalog:FieldCatalog|null;disabled:boolean;onSave:(target:string,value:string)=>Promise<void>}) {
  const inputId=useId();
  const [value,setValue]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const col=answerColumn(field.target,catalog);
  const options=col?.type==="Boolean"?["Yes","No"]:col?.type==="Picklist"?col.options?.map(o=>o.label):null;
  const type=col?.type==="DateTime"||/\.(dateOfBirth|effectiveDate|expirationDate|purchaseDate)$/.test(field.target)?"date":col&&["Integer","BigInt","Decimal","Double","Money"].includes(col.type)?"number":"text";
  const save=async(next=value)=>{
    if(!next.trim()||saving)return;
    try{const valid=validateAnswer(field.target,next,catalog);setSaving(true);setError("");await onSave(field.target,valid);}
    catch(e){setError((e as Error).message);}
    finally{setSaving(false);}
  };
  return <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 120px",gap:4,alignItems:"start",marginTop:1,borderBottom:"1px solid #edf1f6"}}>
    <label htmlFor={inputId} style={{fontSize:11,lineHeight:"22px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={`${field.label}${field.row?` · ${field.row}`:""} — ${field.target}`}>{field.label}{field.row?` · ${field.row}`:""}</label>
    <div style={{minWidth:0}}>
      {options?<select id={inputId} aria-label={`${field.label}${field.row?` ${field.row}`:""}`} value={value} disabled={disabled||saving} onChange={e=>{setValue(e.target.value);void save(e.target.value);}} style={{width:"100%",height:22,fontSize:11,background:"white",border:"1px solid #8eabc9",borderRadius:2}}><option value="">—</option>{options.map(option=><option key={option} value={option}>{option}</option>)}</select>:
        <input id={inputId} aria-label={`${field.label}${field.row?` ${field.row}`:""}`} type={type} step={col?.type==="Integer"||col?.type==="BigInt"?1:"any"} maxLength={col?.maxLength??4000} value={value} disabled={disabled||saving} onChange={e=>{setValue(e.target.value);setError("");}} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save();}}} style={{width:"100%",boxSizing:"border-box",height:22,fontSize:11,background:"white",border:"1px solid #8eabc9",borderRadius:2,padding:"2px 4px"}}/>}
      {saving&&<small role="status">Saving…</small>}{error&&<div role="alert" style={{fontSize:10,color:"#a4262c"}}>{error}</div>}
    </div>
  </div>;
}
