import {useEffect,useRef,useState} from "react";
import {Combobox,Option} from "@fluentui/react-components";
import {getActiveEnvironment,type CrmEnvironment} from "@/crm/environments";
import {crmAgentKey,getCrmAgent} from "@/crm/agent";
import type {UserRow} from "@/crm/dataverse";
import {send} from "./api";
export function CrmAgentPicker({onBusy}:{onBusy:(busy:boolean)=>void}) {
  const [env,setEnv]=useState<CrmEnvironment|null>(null);
  const [agent,setAgent]=useState<UserRow|null>(null);
  const [query,setQuery]=useState("");
  const [options,setOptions]=useState<UserRow[]>([]);
  const [error,setError]=useState("");
  const request=useRef(0);
  const pending=useRef(0);
  const [searching,setSearching]=useState(false);
  useEffect(()=>{
    let disposed=false;
    const load=async()=>{const e=await getActiveEnvironment();const selected=await getCrmAgent(e);if(!disposed){setEnv(e);setAgent(selected);setQuery(selected?.fullName??"");setOptions([]);request.current++;}};
    void load().catch(e=>setError(String(e)));
    const changed=(changes:Record<string,unknown>)=>{if(Object.keys(changes).some(k=>k.startsWith("owner/default:")||k.startsWith("env/")))void load().catch(e=>setError(String(e)));};
    chrome.storage.onChanged.addListener(changed);
    return()=>{disposed=true;request.current++;chrome.storage.onChanged.removeListener(changed);};
  },[]);
  const search=async(value:string)=>{
    setQuery(value);setError("");setOptions([]);const version=++request.current;
    if(value.trim().length<2){setSearching(false);if(!value.trim()&&env){setAgent(null);await chrome.storage.local.remove(crmAgentKey(env.orgUrl));}return;}
    setSearching(true);pending.current++;onBusy(true);
    try{const rows=await send<UserRow[]>({type:"panel/searchUsers",query:value.trim()});if(version===request.current)setOptions(rows);}
    catch(e){if(version===request.current)setError((e as Error).message);}
    finally{pending.current--;onBusy(pending.current>0);if(version===request.current)setSearching(false);}
  };
  const pick=async(id:string)=>{const selected=options.find(o=>o.userId===id);if(!selected||!env)return;try{await chrome.storage.local.set({[crmAgentKey(env.orgUrl)]:selected});setAgent(selected);setQuery(selected.fullName);setOptions([]);setError("");}catch(e){setError((e as Error).message);}};
  return <div style={{flex:1,minWidth:80,maxWidth:210}} title={error||`CRM Agent${env?` · ${env.name}`:""}: ${agent?.fullName??"Select an agent"}. Owns newly created records and joins the insured servicing team.`}>
    <Combobox listbox={{style:{minWidth:320,maxWidth:350}}} size="small" aria-label="CRM Agent" placeholder="CRM Agent" value={query} selectedOptions={agent?[agent.userId]:[]} style={{minWidth:0,width:"100%"}}
      onInput={e=>void search((e.target as HTMLInputElement).value)} onOptionSelect={(_,d)=>{if(d.optionValue)void pick(d.optionValue);}}>
      {options.map(u=><Option key={u.userId} value={u.userId} text={u.fullName}>{u.fullName}{u.email?` (${u.email})`:""}</Option>)}
      {!options.length&&<Option disabled value="hint">{error||(searching?"Searching CRM…":query.trim().length>=2?"No matching CRM users":"Type at least two letters to find a CRM Agent")}</Option>}
    </Combobox>
  </div>;
}
