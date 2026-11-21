import {MissingAnswerInput} from "./MissingAnswerInput";
import {send} from "./api";
import {useEffect,useMemo,useState} from "react";
import {Button,Popover,PopoverTrigger,PopoverSurface,ProgressBar,Tooltip} from "@fluentui/react-components";
import {CartRegular,OpenRegular,FormRegular,InfoRegular,CheckmarkCircleRegular,DismissRegular} from "@fluentui/react-icons";
import type {CapturedApplication} from "@/boldpenguin/types";
import {getAllFieldMaps} from "@/portal/fieldMaps";
import {getDataServiceMaps} from "@/sources/ezlynxSource";
import {getActiveEnvironment} from "@/crm/environments";
import {cachedFieldCatalog,type FieldCatalog} from "@/crm/fieldCatalog";
import {mappingServices,type GraphService} from "@/options/mappingGraph";
import {destinationReadiness} from "@/portal/destinationReadiness";

export function DestinationCart({app,busy=false,onFill,onSaved}:{app:CapturedApplication|null;busy?:boolean;onFill?:()=>void;onSaved?:(app:CapturedApplication)=>void}) {
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const saveAnswer=async(target:string,value:string)=>{
    if(!app)throw new Error("Capture an application first.");
    setSaving(true);
    try{const updated=await send<CapturedApplication>({type:"panel/saveApplicationAnswer",target,value,revision:app.capturedAt,leadKey:app.source.leadKey||app.source.url});onSaved?.(updated);setNotice("Answer saved to this application.");}
    finally{setSaving(false);}
  };
  const [open,setOpen]=useState(false);
  const [services,setServices]=useState<GraphService[]>([]);
  const [catalog,setCatalog]=useState<FieldCatalog|null>(null);
  const [activeOrigin,setActiveOrigin]=useState("");
  const [error,setError]=useState("");
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(!open)return;
    let disposed=false;
    const load=async()=>{try {
      const [maps,ds,env,tabs]=await Promise.all([getAllFieldMaps(),getDataServiceMaps(),getActiveEnvironment(),chrome.tabs.query({active:true,currentWindow:true})]);
      const meta=await cachedFieldCatalog(env.id);
      if(disposed)return;
      setServices(mappingServices(maps,ds));setCatalog(meta);
      setActiveOrigin(tabs[0]?.url?.startsWith("https:")?new URL(tabs[0].url).origin:"");setError("");setLoaded(true);
    }catch(e){if(!disposed){setError((e as Error).message);setLoaded(true);}}};
    void load();
    const changed=()=>{void load();};chrome.storage.onChanged.addListener(changed);
    return()=>{disposed=true;chrome.storage.onChanged.removeListener(changed);};
  },[open]);
  const destinations=useMemo(()=>destinationReadiness(services,app,catalog),[services,app,catalog]);
  const openDestination=async(origin:string)=>{try {
    const tabs=await chrome.tabs.query({currentWindow:true});
    const existing=tabs.find(t=>t.id&&t.url?.startsWith("https:")&&new URL(t.url).origin===origin);
    if(existing?.id)await chrome.tabs.update(existing.id,{active:true});
    else await chrome.tabs.create({url:origin,active:true});
    setOpen(false);
  }catch(e){setError((e as Error).message);}};
  return <Popover open={open} onOpenChange={(_,d)=>setOpen(d.open)} positioning="below-end">
    <PopoverTrigger disableButtonEnhancement><Tooltip content="Ready to quote: mapped data available by destination" relationship="label"><Button icon={<CartRegular/>} appearance={open?"primary":"secondary"} aria-label="Ready to quote" disabled={busy}/></Tooltip></PopoverTrigger>
    <PopoverSurface style={{width:350,maxWidth:"calc(100vw - 32px)",boxSizing:"border-box",padding:6,backgroundColor:"#eef5ff",border:"2px solid #4977af",borderTop:"3px solid #245b9b",boxShadow:"0 6px 24px #15395b40"}} aria-label="Destination readiness">
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
        <strong style={{fontSize:12,flex:1}}>Ready to quote</strong>
        {notice&&<span role="status" aria-label="Answer saved" title="Answer saved" style={{color:"#107c10",display:"flex"}}><CheckmarkCircleRegular/></span>}
        <Tooltip content="Mapped answers available, not complete carrier requirements. Text saves on Enter or blur; choices save immediately." relationship="label"><Button size="small" appearance="subtle" icon={<InfoRegular/>} aria-label="About readiness and saving" style={{minWidth:22,height:22,padding:1}}/></Tooltip>
        <Button size="small" appearance="subtle" icon={<DismissRegular/>} aria-label="Close readiness" title="Close" style={{minWidth:22,height:22,padding:1}} onClick={()=>setOpen(false)}/>
      </div>
      {!app&&<div style={{fontSize:11,marginBottom:4}}>No application captured.</div>}
      {error&&<p role="alert" style={{fontSize:12}}>{error}</p>}
      {!loaded?<p>Loading destinations…</p>:<div style={{maxHeight:"70vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
        {destinations.map(d=><section key={d.id} style={{border:"1px solid #dce2eb",borderRadius:2,padding:4,backgroundColor:"white"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
            <strong title={d.id} style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</strong>
            <span title="Mapped answers available" style={{whiteSpace:"nowrap"}}>{d.percent===null?"—":`${d.available}/${d.total} · ${d.percent}%`}</span>
            <Tooltip content="Open destination" relationship="label"><Button size="small" appearance="subtle" icon={<OpenRegular/>} aria-label={`Open ${d.name}`} style={{minWidth:22,height:22,padding:1}} onClick={()=>void openDestination(d.id)}/></Tooltip>
            {onFill&&activeOrigin===d.id&&<Tooltip content="Fill this page" relationship="label"><Button size="small" appearance="subtle" icon={<FormRegular/>} aria-label={`Fill ${d.name}`} style={{minWidth:22,height:22,padding:1}} disabled={!app||!d.available||d.nameReview||busy} onClick={()=>{setOpen(false);onFill();}}/></Tooltip>}
          </div>
          {d.total>0&&<ProgressBar thickness="medium" value={d.available/d.total} color={d.available===d.total?"success":"brand"} style={{margin:"2px 0"}} aria-label={`${d.name}: ${d.available} of ${d.total} mapped answers available`}/>}
          {!d.total&&<div style={{fontSize:11}}>No fillable mappings.</div>}
          {d.nameReview&&<div style={{fontSize:11}}>Name review needed.</div>}
          {d.missing.length>0&&<details style={{marginTop:3,fontSize:11}}><summary style={{cursor:"pointer"}}>{d.missing.length} missing</summary>
            {[...new Set(d.missing.map(f=>f.group))].map(group=><div key={group} style={{marginTop:4,fontSize:11}}><strong>{group}</strong>{[...new Map(d.missing.filter(f=>f.group===group).map(f=>[f.target,f])).values()].map(f=><MissingAnswerInput key={f.target} field={f} catalog={catalog} disabled={!app||saving||busy} onSave={saveAnswer}/>)}</div>)}
          </details>}

        </section>)}
        {!destinations.length&&<p style={{fontSize:12}}>No mapped destinations.</p>}
      </div>}
    </PopoverSurface>
  </Popover>;
}
