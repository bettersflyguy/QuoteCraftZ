import type {LobRow,OppSummary} from "@/crm/dataverse";
export function OpportunityChoices({routes,open,lobs,choices,names,onChange,onLineChange,onNameChange,onAdd,onRemove,disabled}:{
  routes:{source:string;lobId:string|null;label:string;required?:boolean}[];open:OppSummary[];lobs:LobRow[];
  choices:Record<string,string>;names:Record<string,string>;onChange:(source:string,value:string)=>void;
  onLineChange:(source:string,value:string)=>void;onNameChange:(source:string,value:string)=>void;
  onAdd:()=>void;onRemove:(source:string)=>void;disabled:boolean;
}) {
  const control={width:"100%",minWidth:0,height:24,fontSize:12,boxSizing:"border-box" as const};
  return <div style={{display:"grid",gridTemplateColumns:"minmax(85px, .8fr) minmax(140px, 1.5fr) 24px",gap:3,fontSize:11,alignItems:"start"}}>
    <b>Line</b><b>Opportunity</b><button type="button" title="Add opportunity" aria-label="Add opportunity" disabled={disabled} onClick={onAdd}>＋</button>
    {routes.map(route=><div key={route.source} style={{display:"contents"}}>
      <select title={route.required?`Captured quotes: ${route.source}`:"Line of business"} aria-label={`${route.label}: Line`} style={control} disabled={disabled} value={route.lobId??""} onChange={e=>onLineChange(route.source,e.target.value)}>
        <option value="" disabled>Choose line</option>{lobs.map(l=><option key={l.lobId} value={l.lobId}>{l.name}</option>)}
      </select>
      <div style={{minWidth:0,display:"grid",gap:2}}>
        <select aria-label={`${route.label}: Opportunity`} disabled={disabled||!route.lobId} value={choices[route.source]??""} style={control}
          onChange={e=>onChange(route.source,e.target.value)}>
          <option value="" disabled>Choose opportunity</option><option value="new">＋ New opportunity</option>
          {open.length>0&&<optgroup label="Open opportunities">{open.map(o=><option key={o.opportunityId} value={o.opportunityId} disabled={o.lobId!==route.lobId}>
            {[o.name,o.lobName,o.desiredEffectiveDate?.slice(0,10)].filter(Boolean).join(" · ")}
          </option>)}</optgroup>}
        </select>
        {choices[route.source]==="new"&&<input aria-label={`${route.label}: New opportunity name`} placeholder="New opportunity name" style={control} disabled={disabled} value={names[route.source]??""} onChange={e=>onNameChange(route.source,e.target.value)}/>}
      </div>
      <button type="button" style={{height:24}} aria-label={`Remove ${route.label}`} title={route.required?"Deselect this line's quotes on the Quotes tab to remove":"Remove opportunity"} disabled={disabled||route.required} onClick={()=>onRemove(route.source)}>×</button>
    </div>)}
  </div>;
}
