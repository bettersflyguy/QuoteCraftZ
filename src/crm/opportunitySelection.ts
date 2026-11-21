import type {OppSummary} from "./dataverse";

export interface QuoteRoute {source:string;lobId:string|null}
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
