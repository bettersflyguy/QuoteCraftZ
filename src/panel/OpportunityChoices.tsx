import type {OppSummary} from "@/crm/dataverse";
export function OpportunityChoices({routes,open,choices,onChange,disabled}:{
  routes:{source:string;lobId:string|null;label:string}[];open:OppSummary[];
  choices:Record<string,string>;onChange:(source:string,value:string)=>void;disabled:boolean;
}) {
  return <>{routes.map(route=><label key={route.source} style={{display:"grid",gap:4,fontSize:12}}>
    <b>{route.label}</b>
    <select aria-label={`${route.label}: Opportunity`} disabled={disabled} value={choices[route.source]??""}
      style={{width:"100%",minWidth:0,height:28,fontSize:12}}
      onChange={e=>onChange(route.source,e.target.value)}>
      <option value="" disabled>Choose opportunity</option>
      <option value="new">＋ New opportunity</option>
      {open.length>0&&<optgroup label="Open opportunities">{open.map(o=><option key={o.opportunityId} value={o.opportunityId} disabled={o.lobId!==route.lobId}>
        {[o.name,o.lobName,o.desiredEffectiveDate?.slice(0,10)].filter(Boolean).join(" · ")}
      </option>)}</optgroup>}
    </select>
  </label>)}</>;
}
