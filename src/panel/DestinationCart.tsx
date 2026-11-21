import {useEffect,useMemo,useState} from "react";
import {Button,Popover,PopoverTrigger,PopoverSurface,ProgressBar,Tooltip} from "@fluentui/react-components";
import {CartRegular} from "@fluentui/react-icons";
import type {CapturedApplication} from "@/boldpenguin/types";
import {getAllFieldMaps} from "@/portal/fieldMaps";
import {getDataServiceMaps} from "@/sources/ezlynxSource";
import {getActiveEnvironment} from "@/crm/environments";
import {cachedFieldCatalog,type FieldCatalog} from "@/crm/fieldCatalog";
import {mappingServices,type GraphService} from "@/options/mappingGraph";
import {destinationReadiness} from "@/portal/destinationReadiness";

export function DestinationCart({app,busy=false,onFill}:{app:CapturedApplication|null;busy?:boolean;onFill?:()=>void}) {
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
    <PopoverSurface style={{width:330,maxWidth:"calc(100vw - 32px)",padding:12}} aria-label="Destination readiness">
      <strong>Ready to quote</strong>
      <p style={{fontSize:11,margin:"4px 0 10px"}}>Mapped data available for the current application. Carrier requirements and unmapped questions may vary.</p>
      {!app&&<p style={{fontSize:12}}>Capture a prospect or pull their CRM information to check availability.</p>}
      {error&&<p role="alert" style={{fontSize:12}}>{error}</p>}
      {!loaded?<p>Loading destinations…</p>:<div style={{maxHeight:"60vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        {destinations.map(d=><section key={d.id} style={{border:"1px solid #dce2eb",borderRadius:3,padding:8}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12}}><strong title={d.id}>{d.name}</strong><strong>{d.percent===null?"Not assessed":`${d.percent}%`}</strong></div>
          {d.total>0&&<><ProgressBar value={d.available/d.total} color={d.available===d.total?"success":"brand"} style={{margin:"6px 0"}} aria-label={`${d.name}: ${d.available} of ${d.total} mapped answers available`}/><div style={{fontSize:11}}>{d.available}/{d.total} mapped answers available</div></>}
          {!d.total&&<p style={{fontSize:11}}>No fillable mappings yet.</p>}
          {d.nameReview&&<p style={{fontSize:11}}>Confirm the name split before filling.</p>}
          {d.missing.length>0&&<details style={{marginTop:6,fontSize:12}}><summary style={{cursor:"pointer"}}>View {d.missing.length} missing answers</summary>
            {[...new Set(d.missing.map(f=>f.group))].map(group=><div key={group} style={{marginTop:6}}><strong>{group}</strong><ul style={{margin:"3px 0",paddingLeft:18}}>{d.missing.filter(f=>f.group===group).map((f,i)=><li key={i} title={f.target}>{f.label}{f.row?` · ${f.row}`:""}</li>)}</ul></div>)}
          </details>}
          <div style={{display:"flex",gap:6,marginTop:8}}><Button size="small" onClick={()=>void openDestination(d.id)}>Open destination</Button>
            {onFill&&activeOrigin===d.id&&<Button size="small" appearance="primary" disabled={!app||!d.available||d.nameReview||busy} onClick={()=>{setOpen(false);onFill();}}>Fill this page</Button>}
          </div>
        </section>)}
        {!destinations.length&&<p style={{fontSize:12}}>Map a field on a destination site to add it here.</p>}
      </div>}
    </PopoverSurface>
  </Popover>;
}
