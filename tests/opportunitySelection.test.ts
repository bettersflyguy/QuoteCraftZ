import {it,expect} from "vitest";
import {resolveOpportunitySelections,suggestedOpportunityLines} from "@/crm/opportunitySelection";
import type {CapturedApplication} from "@/boldpenguin/types";
const routes=[{source:"Home",lobId:"home"},{source:"Auto",lobId:"auto"}];
const open=[
  {opportunityId:"h1",name:"Renewal",lobId:"home",lobName:"Homeowners",desiredEffectiveDate:"2027-01-01"},
  {opportunityId:"h2",name:"New purchase",lobId:"home",lobName:"Homeowners",desiredEffectiveDate:"2026-12-01"},
  {opportunityId:"a1",name:"Auto",lobId:"auto",lobName:"Personal Auto",desiredEffectiveDate:null}
];
it("uses the explicitly chosen second opportunity and a separate new line",()=>{
  const result=resolveOpportunitySelections(routes,open,{Home:"h2",Auto:"new"});
  expect(result[0]!.opportunity?.opportunityId).toBe("h2");
  expect(result[1]!.opportunity).toBeNull();
});
it("does not choose an opportunity automatically, even when only one exists",()=>{
  expect(()=>resolveOpportunitySelections([routes[0]!],[open[0]!],{})).toThrow("Choose an open opportunity");
  expect(()=>resolveOpportunitySelections([routes[0]!],[],{})).toThrow("Choose an open opportunity");
});
it("rejects a closed, other-account, or wrong-line opportunity instead of silently creating one",()=>{
  expect(()=>resolveOpportunitySelections([routes[0]!],open.slice(1),{Home:"h1"})).toThrow();
  expect(()=>resolveOpportunitySelections([routes[0]!],[],{Home:"h2"})).toThrow();
  expect(()=>resolveOpportunitySelections([routes[0]!],open,{Home:"a1"})).toThrow();
});
it("requires explicit new choices for new accounts and a line for every group",()=>{
  expect(resolveOpportunitySelections(routes,[],{Home:"new",Auto:"new"})).toHaveLength(2);
  expect(()=>resolveOpportunitySelections([{source:"Home",lobId:null}],[],{Home:"new"})).toThrow("Choose a CRM line");
});
it("suggests Auto from vehicle capture alongside Home quotes and supports arbitrary CRM lines",()=>{
  const app:Pick<CapturedApplication,"fields"|"normalized">={fields:["Travel: Application","Life: Insured","Auto: Vehicles"].map(section=>({section,label:"",value:"",group:"",source:"taught"})),normalized:{"crm:vehicle1":{}}};
  const rows=suggestedOpportunityLines(app,[{lobId:"home",name:"Homeowners"},{lobId:"auto",name:"Personal Auto"},{lobId:"travel",name:"Travel"},{lobId:"life",name:"Life"}],["home"]);
  expect(rows.map(r=>r.lobId).sort()).toEqual(["auto","life","travel"]);
});

