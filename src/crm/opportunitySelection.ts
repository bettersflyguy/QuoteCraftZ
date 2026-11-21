import type {OppSummary} from "./dataverse";
import type {CapturedApplication} from "@/boldpenguin/types";
import {quoteLobMatch} from "./lobMatch";

export interface QuoteRoute {source:string;lobId:string|null}
/** Captured sections suggest lines independently of selected quotes. */
export function suggestedOpportunityLines(app:Pick<CapturedApplication,"fields"|"normalized">,lobs:{lobId:string;name:string}[],existing:(string|null)[]) {
  const names=new Set(app.fields.map(f=>f.section.split(":")[0]?.trim()??""));
  if(Object.keys(app.normalized).some(k=>/^(crm:)?vehicle\d+$/.test(k)))names.add("Auto");
  if(Object.keys(app.normalized).some(k=>/^(crm:)?property\d+$/.test(k)))names.add("Home");
  const seen=new Set(existing);const result:{source:string;lobId:string}[]=[];
  for(const name of names){const match=quoteLobMatch(lobs,name);if(match&&!seen.has(match.lobId)){seen.add(match.lobId);result.push({source:`extra:${match.lobId}`,lobId:match.lobId});}}
  return result;
}
/** Resolve explicit choices against a fresh account-scoped list before writing. */
export function resolveOpportunitySelections(routes:QuoteRoute[],open:OppSummary[],choices:Record<string,string>) {
  return routes.map(route=>{
    if(!route.lobId)throw new Error(`Choose a CRM line of business for ${route.source || "Quote"}.`);
    const choice=choices[route.source];
    if(choice==="new")return {...route,opportunity:null};
    const opportunity=open.find(o=>o.opportunityId===choice&&o.lobId===route.lobId);
    if(!opportunity)throw new Error(`Choose an open opportunity or New opportunity for ${route.source || "Quote"}. The previous selection may have closed or changed.`);
    return {...route,opportunity};
  });
}
