import {useState} from "react";
import {Button,Input,Text,tokens} from "@fluentui/react-components";
import type {CapturedApplication} from "@/boldpenguin/types";
import {nameReviewItems,nameSplit,type NameReviewItem} from "@/boldpenguin/nameReview";
import {send} from "./api";

function PersonNameReview({item,onChange}:{item:NameReviewItem;onChange:(app:CapturedApplication)=>void}) {
  const [editing,setEditing]=useState(!item.confirmed);
  const [given,setGiven]=useState(item.firstName);
  const [surname,setSurname]=useState(item.lastName);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const apply=(format:"auto"|"two-surnames")=>{
    const split=nameSplit(item.original,format);setGiven(split.firstName);setSurname(split.lastName);
  };
  const confirm=async()=>{
    setBusy(true);setError("");
    try {
      const next=await send<CapturedApplication>({type:"panel/confirmNameSplit",group:item.group,fingerprint:item.fingerprint,firstName:given,lastName:surname});
      onChange(next);setEditing(false);
    } catch(e) {setError(String((e as Error).message || e));}
    finally {setBusy(false);}
  };
  return <div style={{display:"flex",flexDirection:"column",gap:6,padding:8,border:`1px solid ${tokens.colorNeutralStroke2}`,borderRadius:4}}>
    <Text size={200}><b>{item.group==="contact" ? "Primary contact" : `Contact ${item.group.slice(7)}`}:</b> {item.original}</Text>
    {!editing ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <Text size={200}>Confirmed: {item.firstName} / {item.lastName}</Text>
      <Button size="small" appearance="subtle" onClick={()=>setEditing(true)}>Edit split</Button>
    </div> : <>
      <Text size={200}>Choose where the given names end and the surnames begin for this person.</Text>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        <Button size="small" disabled={busy} onClick={()=>apply("auto")}>One surname</Button>
        <Button size="small" disabled={busy} onClick={()=>apply("two-surnames")}>Two surnames</Button>
      </div>
      <label style={{display:"flex",flexDirection:"column",gap:2,fontSize:12}}>Given name(s)
        <Input value={given} disabled={busy} onChange={(_,d)=>setGiven(d.value)} aria-label={`Given names for ${item.original}`}/>
      </label>
      <label style={{display:"flex",flexDirection:"column",gap:2,fontSize:12}}>Surname(s)
        <Input value={surname} disabled={busy} onChange={(_,d)=>setSurname(d.value)} aria-label={`Surnames for ${item.original}`}/>
      </label>
      <Button size="small" appearance="primary" disabled={busy || !surname.trim()} onClick={()=>void confirm()}>{busy ? "Saving…" : "Confirm name split"}</Button>
      {error && <Text size={200} role="alert">{error}</Text>}
    </>}
  </div>;
}

export function NameReview({app,onChange}:{app:CapturedApplication;onChange:(app:CapturedApplication)=>void}) {
  const items=nameReviewItems(app).filter(item=>item.needsReview || item.confirmed);
  if (!items.length) return null;
  return <section aria-label="Review captured names" style={{display:"flex",flexDirection:"column",gap:6}}>
    <Text size={300} weight="semibold">Name split</Text>
    {items.map(item=><PersonNameReview key={`${item.group}:${item.fingerprint}`} item={item} onChange={onChange}/>)}
  </section>;
}
