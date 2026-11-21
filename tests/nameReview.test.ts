import {it,expect,vi} from "vitest";
import "./helpers/chromeStub";
import {mergeIngestedFields} from "@/boldpenguin/ingest";
import {confirmNameSplit,nameReviewItems,nameSplit,pendingNameReviews,requireReviewedNames,withReviewedNames} from "@/boldpenguin/nameReview";
import {identityFromCapture,coApplicantsFromCapture} from "@/crm/appCommit";
import {buildFillValues} from "@/portal/fillValues";
import {routeMessage} from "@/workerRouter";
import type {CapturedApplication} from "@/boldpenguin/types";
const site={system:"Datalot",url:"https://app.datalot.com/client",title:"Lead"};
const field=(value:string,mapped="contact.fullName")=>({label:"Full name",value,mapped,section:"Lead",group:"",source:"taught" as const});
const capture=(name:string)=>mergeIngestedFields(null,[field(name),field(name,"crm:account.name")],site).app;
function reviewed(app:CapturedApplication,group="contact",format:"auto"|"two-surnames"="two-surnames") {
  const item=nameReviewItems(app).find(n=>n.group===group)!;
  return confirmNameSplit(app,{group,fingerprint:item.fingerprint,...nameSplit(item.original,format)});
}

it("handles different formats using the same source mapping without a site setting",()=>{
  const simple=capture("Raymond Hendricks");
  expect(pendingNameReviews(simple)).toHaveLength(0);
  expect(identityFromCapture(simple)).toMatchObject({firstName:"Raymond",lastName:"Hendricks"});
  const compound=capture("José Luis García Márquez");
  expect(pendingNameReviews(compound)).toHaveLength(1);
  const confirmed=reviewed(compound);
  expect(pendingNameReviews(confirmed)).toHaveLength(0);
  expect(identityFromCapture(confirmed)).toMatchObject({firstName:"José Luis",lastName:"García Márquez"});
  expect(buildFillValues(confirmed)).toMatchObject({"contact.firstName":"José Luis","contact.lastName":"García Márquez","crm:account.name":"José Luis García Márquez"});
  expect(confirmed.fields).toEqual(compound.fields);
});
it("offers distinct per-person interpretations of three-part names without discarding tokens",()=>{
  expect(nameSplit("Carlos García Márquez","auto")).toEqual({firstName:"Carlos García",lastName:"Márquez"});
  expect(nameSplit("Carlos García Márquez","two-surnames")).toEqual({firstName:"Carlos",lastName:"García Márquez"});
  expect(nameSplit("John Michael Smith","auto")).toEqual({firstName:"John Michael",lastName:"Smith"});
  expect(nameSplit("María del Carmen de la Cruz","auto")).toEqual({firstName:"María del Carmen",lastName:"de la Cruz"});
});
it("keeps independent choices for related contacts and does not overwrite structured names",()=>{
  const app=mergeIngestedFields(null,[field("Raymond Hendricks"),field("Ana María López Pérez","contact2.fullName"),field("John Michael Smith","contact3.fullName")],site).app;
  const confirmed=reviewed(reviewed(app,"contact2"),"contact3","auto");
  expect(coApplicantsFromCapture(confirmed)).toEqual(expect.arrayContaining([expect.objectContaining({firstName:"Ana María",lastName:"López Pérez"}),expect.objectContaining({firstName:"John Michael",lastName:"Smith"})]));
  const structured=mergeIngestedFields(null,[field("José Luis García Márquez"),field("José Luis","contact.firstName"),field("García Márquez","contact.lastName")],site).app;
  expect(pendingNameReviews(structured)).toHaveLength(0);
  expect(identityFromCapture(structured)).toMatchObject({firstName:"José Luis",lastName:"García Márquez"});
});
it("preserves a confirmed split on reread, and invalidates it for a new source name or lead",()=>{
  const raw=capture("Carlos García Márquez");
  const first=reviewed(raw);
  const reread=mergeIngestedFields(first,[field("Carlos García Márquez")],site).app;
  expect(pendingNameReviews(reread)).toHaveLength(0);
  expect(withReviewedNames(withReviewedNames(first)).normalized).toEqual(withReviewedNames(first).normalized);
  const changed={...first,fields:[field("Juan García Márquez")],normalized:first.normalized};
  expect(pendingNameReviews(changed)[0]?.original).toBe("Juan García Márquez");
  expect(()=>requireReviewedNames(changed)).toThrow("Confirm");
  expect(()=>confirmNameSplit(changed,{group:"contact",fingerprint:nameReviewItems(raw)[0]!.fingerprint,firstName:"Carlos",lastName:"García Márquez"})).toThrow("changed");
  expect(pendingNameReviews({...first,source:{...first.source,leadKey:"another-lead"}})).toHaveLength(1);
  expect(pendingNameReviews(capture("Ana María López Pérez"))).toHaveLength(1);
});
it("prevents ambiguous names reaching fill or CRM writes before confirmation",async()=>{
  let app=capture("Carlos García Márquez");
  const fillPortalTab=vi.fn(async(_id:number,_app:CapturedApplication,_overwrite:boolean,_advance:boolean)=>({filledCount:1}));
  const createAccount=vi.fn(async()=>({accountId:"a",name:"x"}));
  const createLead=vi.fn(async()=>({leadId:"l",name:"x"}));
  const deps={getCapturedApplication:async()=>app,setCapturedApplication:async(next:CapturedApplication)=>{app=next;},fillPortalTab,createAccount,createLead,getActiveEnvironment:async()=>({id:"dev"})};
  const fill={type:"panel/portalFill" as const,tabId:1,overwrite:false,autoAdvance:false};
  expect(await routeMessage(fill,deps as never)).toMatchObject({ok:false,error:expect.stringContaining("Confirm")});
  expect(fillPortalTab).not.toHaveBeenCalled();
  expect(await routeMessage({type:"panel/appCommit",accountId:"a",applicant:{} as never,insuredType:1},deps as never)).toMatchObject({ok:false,error:expect.stringContaining("Confirm")});
  for(const type of ["panel/createAccount","panel/createLead"] as const) expect(await routeMessage({type,fromCapture:true,fields:{} as never},deps as never)).toMatchObject({ok:false,error:expect.stringContaining("Confirm")});
  expect(createAccount).not.toHaveBeenCalled();expect(createLead).not.toHaveBeenCalled();
  const item=nameReviewItems(app)[0]!;
  expect(await routeMessage({type:"panel/confirmNameSplit",group:"contact",fingerprint:item.fingerprint,...nameSplit(item.original,"two-surnames")},deps as never)).toMatchObject({ok:true});
  expect(await routeMessage(fill,deps as never)).toMatchObject({ok:true});
  expect(fillPortalTab.mock.calls[0]?.[1].normalized.contact).toMatchObject({firstName:"Carlos",lastName:"García Márquez"});
});
