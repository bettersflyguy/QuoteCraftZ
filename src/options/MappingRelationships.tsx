import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {Button,Input,Text} from "@fluentui/react-components";
import {getAllFieldMaps,isNoteTarget,PATH_LABEL,noteLabelOf} from "@/portal/fieldMaps";
import {getDataServiceMaps} from "@/sources/ezlynxSource";
import {cachedFieldCatalog,catalogLabel,type FieldCatalog} from "@/crm/fieldCatalog";
import {getActiveEnvironment} from "@/crm/environments";
import {mappingServices,type GraphService} from "./mappingGraph";
import { RelationshipEditor } from "./RelationshipEditor";
import "./mappingRelationships.css";

const VIEW_KEY="settings/relationshipView";
type View={inputs:string[];outputs:string[]};
const safeList=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==="string"):[];

export function MappingRelationships() {
  const [services,setServices]=useState<GraphService[]>([]);
  const [catalog,setCatalog]=useState<FieldCatalog|null>(null);
  const [environment,setEnvironment]=useState("");
  const [view,setView]=useState<View>({inputs:[],outputs:[]});
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [all,setAll]=useState(true);
  const [error,setError]=useState("");
  const [loaded,setLoaded]=useState(false);
  const canvas=useRef<HTMLDivElement>(null);
  const marker=useId().replace(/:/g,"");
  const [paths,setPaths]=useState<{d:string;target:string}[]>([]);
  useEffect(()=>{
    let disposed=false;
    const load=async()=>{
      try {
        const [maps,ds,env,prefs]=await Promise.all([getAllFieldMaps(),getDataServiceMaps(),getActiveEnvironment(),chrome.storage.local.get(VIEW_KEY)]);
        const meta=await cachedFieldCatalog(env.id);
        if(disposed)return;
        setServices(mappingServices(maps,ds));setCatalog(meta);setEnvironment(env.name);
        const saved=prefs[VIEW_KEY] as Partial<View>|undefined;
        setView({inputs:safeList(saved?.inputs),outputs:safeList(saved?.outputs)});setError("");setLoaded(true);
      }catch(e){if(!disposed){setError(String((e as Error).message||e));setLoaded(true);}}
    };
    void load();
    const change=(_changes:unknown,area:string)=>{if(area==="local")void load();};
    chrome.storage.onChanged.addListener(change);
    return()=>{disposed=true;chrome.storage.onChanged.removeListener(change);};
  },[]);
  const label=(target:string)=>isNoteTarget(target)?noteLabelOf(target):PATH_LABEL.get(target)||catalogLabel(catalog,target)||target;
  const displayName=(target:string)=>label(target).replace(/^[^:]+:\s*/, "");
  const nodes=useMemo(()=>{
    const targets=new Map<string,string>();
    for(const service of services)for(const field of service.fields) {
      if(!field.target)continue;
      const existing=targets.get(field.canonical);
      if(!existing||field.target.startsWith("crm:"))targets.set(field.canonical,field.target);
    }
    return [...targets].filter(([key,target])=>{
      const q=query.toLowerCase().trim();
      return !q || `${label(target)} ${target} ${services.flatMap(s=>s.fields.filter(f=>f.canonical===key).map(f=>`${s.name} ${f.label}`)).join(" ")}`.toLowerCase().includes(q);
    }).sort((a,b)=>label(a[1]).localeCompare(label(b[1])));
  },[services,catalog,query,selected,all]);
  const shown=new Set(nodes.map(([key])=>key));
  const inputs=services.filter(s=>!view.inputs.includes(s.id));
  const outputs=services.filter(s=>!view.outputs.includes(s.id));
  const toggle=async(kind:keyof View,id:string)=>{
    const next={...view,[kind]:view[kind].includes(id)?view[kind].filter(s=>s!==id):[...view[kind],id]};
    try{await chrome.storage.local.set({[VIEW_KEY]:next});setView(next);}catch(e){setError(String(e));}
  };
  useLayoutEffect(()=>{
    const el=canvas.current;if(!el)return;
    const draw=()=>{
      const bounds=el.getBoundingClientRect();
      const centers=new Map([...el.querySelectorAll<HTMLElement>("[data-crm]")].map(n=>[n.dataset.crm!,n.getBoundingClientRect()]));
      const edges:{d:string;target:string}[]=[];
      el.querySelectorAll<HTMLElement>("[data-connection]").forEach(n=>{
        const target=n.dataset.connection!;const c=centers.get(target);if(!c)return;
        const r=n.getBoundingClientRect();const input=n.dataset.lane==="input";
        const x1=(input?r.right:c.right)-bounds.left,y1=(input?r.top+r.height/2:c.top+c.height/2)-bounds.top;
        const x2=(input?c.left:r.left)-bounds.left,y2=(input?c.top+c.height/2:r.top+r.height/2)-bounds.top;
        const mid=(x1+x2)/2;
        edges.push({target,d:`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`});
      });setPaths(edges);
    };
    const observer=new ResizeObserver(draw);observer.observe(el);draw();
    return()=>observer.disconnect();
  },[services,view,query,all,selected,catalog]);
  const serviceCard=(s:GraphService,lane:"input"|"output")=><article key={s.id} className="qr-service">
    <header><strong>{s.name}</strong><Button size="small" appearance="subtle" onClick={()=>void toggle(lane==="input"?"inputs":"outputs",s.id)} aria-label={`Hide ${s.name} ${lane}`}>Hide</Button></header>
    <div className="qr-fields">{s.fields.filter((f,i,fields)=>
      (lane!=="input"||fields.findIndex(other=>other.source===f.source&&other.key===f.key)===i)&&
      ((lane==="input"?s.fields.some(other=>other.source===f.source&&other.key===f.key&&shown.has(other.canonical)):shown.has(f.canonical))||(!f.target&&lane==="input"&&(!query||f.label.toLowerCase().includes(query.toLowerCase()))))&&(lane==="input"||f.output)
    ).map(f=>lane==="input"?<div key={`${f.source}:${f.key}`} className={`qr-input-row ${f.target?"qr-mapped":"qr-unmapped"} ${selected===f.canonical?"qr-selected":""}`} data-connection={f.canonical} data-lane="input">
      {s.fields.filter(other=>other.source===f.source&&other.key===f.key&&other.id!==f.id).map(other=><span key={other.id} className="qr-extra-edge" data-connection={other.canonical} data-lane="input"/>)}
      <button className="qr-source-label" type="button" onClick={()=>setSelected(selected===f.canonical?null:f.canonical)} title={f.label}>{f.label}</button>
      <RelationshipEditor service={s} field={f} catalog={catalog}/>
    </div>:<button type="button" key={f.id} className={`qr-node qr-mapped ${selected===f.canonical?"qr-selected":""}`} data-connection={f.canonical} data-lane={lane} onClick={()=>setSelected(selected===f.canonical?null:f.canonical)} title={`${s.name} · ${f.label}\nSource: ${f.key}\n${label(f.target)}\n${f.target}${f.canonical!==f.target?`\n${f.canonical}`:""}\nPreferred fill source`} aria-pressed={selected===f.canonical}>
      {f.label.replace(/^[^:]+:\s*/, "")}
    </button>)}{!s.fields.some(f=>((lane==="input"?s.fields.some(other=>other.source===f.source&&other.key===f.key&&shown.has(other.canonical)):shown.has(f.canonical))||(!f.target&&lane==="input"&&(!query||f.label.toLowerCase().includes(query.toLowerCase()))))&&(lane==="input"||f.output))&&<p className="qr-muted">No matching mappings.</p>}</div>
  </article>;
  return <section className="qr-workspace" aria-label="Mapping relationships">
    <div className="qr-title"><div><Text as="h2" size={600} weight="semibold">Mapping relationships</Text><p>Any mapped service can supply inputs. CRM stores the data and supplies mapped outputs when you change sites.</p></div><span className="qr-badge">CRM · {environment}</span></div>
    <div className="qr-toolbar"><Input aria-label="Find a mapping" placeholder="Find a field or service…" value={query} onChange={(_,d)=>setQuery(d.value)}/><Button onClick={()=>setAll(!all)} aria-pressed={all}>All connections: {all?"on":"off"}</Button>{selected&&<Button onClick={()=>setSelected(null)}>Clear selection</Button>}<span>{nodes.length} CRM destinations · {services.length} service{services.length===1?"":"s"}</span></div>
    {error&&<p role="alert">{error}</p>}
    {!loaded?<p>Loading saved mappings…</p>:!services.length?<p>Map a field on a site using the extension’s field selector. Its relationships will appear here automatically.</p>:<>
      <div className="qr-hidden">
        <section aria-label="Hidden inputs"><strong>Hidden inputs</strong>{services.filter(s=>view.inputs.includes(s.id)).map(s=><Button size="small" key={s.id} onClick={()=>void toggle("inputs",s.id)}>Show {s.name}</Button>)}{!view.inputs.some(id=>services.some(s=>s.id===id))&&<span>None</span>}</section>
        <section aria-label="Hidden outputs"><strong>Hidden outputs</strong>{services.filter(s=>view.outputs.includes(s.id)).map(s=><Button size="small" key={s.id} onClick={()=>void toggle("outputs",s.id)}>Show {s.name}</Button>)}{!view.outputs.some(id=>services.some(s=>s.id===id))&&<span>None</span>}</section>
      </div>
      <div className="qr-scroll"><div className="qr-canvas" ref={canvas} style={{gridTemplateColumns:`${inputs.length?"450px 48px ":""}260px${outputs.map(()=>" 48px 290px").join("")}`}}>
        <svg className="qr-edges" aria-hidden="true"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="context-stroke"/></marker></defs>{paths.filter(p=>all||p.target===selected).map((p,i)=><path key={i} d={p.d} fill="none" stroke={selected===p.target?"#e000b0":"#96a4b9"} strokeWidth={selected===p.target?3:1.3} opacity={selected&&selected!==p.target?0.18:0.8} markerEnd={`url(#${marker})`}/>)}</svg>
        {inputs.length>0&&<><div className="qr-lane qr-inputs"><h3>Inputs</h3>{inputs.map(s=>serviceCard(s,"input"))}</div><div/></>}
        <div className="qr-lane qr-crm"><h3>CRM data storage</h3>{nodes.map(([key,target])=><button type="button" key={key} data-crm={key} className={`qr-node qr-mapped ${isNoteTarget(target)?"qr-note":""} ${selected===key?"qr-selected":""}`} onClick={()=>setSelected(selected===key?null:key)} aria-pressed={selected===key} title={`${label(target)}\n${target}${key!==target?`\n${key}`:""}${isNoteTarget(target)?"\nCapture only · labelled note entries":""}`}>{displayName(target)}</button>)}</div>
        {outputs.map(s=><FragmentColumn key={s.id} service={s} card={serviceCard(s,"output")}/>)}
      </div></div>
      <p className="qr-muted">Click a mapping cell to change its target; changes save automatically. Green bars mark mapped fields. Click a field label to trace its relationships; other fields remain visible. Output lists use each field’s preferred fill source. Read-only fields can be captured; filling skips them. Notes retain captured answers and do not fill output fields. Hidden sections stay mapped.</p>
    </>}
  </section>;
}
function FragmentColumn({service,card}:{service:GraphService;card:ReactNode}) {return <><div/><div className="qr-lane"><h3>Output · {service.name}</h3>{card}</div></>;}
