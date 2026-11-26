import { describe,it,expect } from "vitest";
import { mappingTargets,packMappingTargets,preferredFieldMap,expandedFieldMap } from "@/portal/mappingTargets";
import { arrayFamilyTargets,buildFieldMapExport,parseFieldMapImport } from "@/portal/fieldMaps";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import { identityFromCapture } from "@/crm/appCommit";
import { buildFillValues } from "@/portal/fillValues";
import { ezlynxFields,effectiveTargets } from "@/sources/ezlynxSource";
import type { CapturedApplicant } from "@/types";

const binding=packMappingTargets(["crm:account.name","contact.fullName"]);
describe("multiple targets for one source",()=>{
  it("keeps legacy strings, removes duplicates and retains the preferred order",()=>{
    expect(packMappingTargets(["contact.fullName"])).toBe("contact.fullName");
    expect(mappingTargets(binding)).toEqual(["crm:account.name","contact.fullName"]);
    expect(packMappingTargets(["contact.fullName","contact.fullName",""])).toBe("contact.fullName");
    expect(preferredFieldMap({name:binding})).toEqual({name:"crm:account.name"});
    expect(expandedFieldMap({name:binding})).toEqual([["name","crm:account.name"],["name","contact.fullName"]]);
  });
  it("moves every existing row target when a repeated field gains another array target",()=>{
    const current=packMappingTargets(["crm:contact3.firstname","crm:contacts[].nickname","crm:account.name"]);
    expect(mappingTargets(arrayFamilyTargets(current))).toEqual(["crm:contacts[].firstname","crm:contacts[].nickname","crm:account.name"]);
  });
  it("round trips page and data-service bindings with every target validated",()=>{
    const exported=buildFieldMapExport({"https://app.datalot.com":{"pick:#name":binding}},undefined,{ezlynx:{"person.firstName":packMappingTargets(["contacts[].firstName","crm:account.name"])}});
    const parsed=parseFieldMapImport(JSON.stringify(exported));
    expect(parsed.maps["https://app.datalot.com"]?.["pick:#name"]).toBe(binding);
    expect(mappingTargets(parsed.dataServices.ezlynx?.["person.firstName"])).toHaveLength(2);
    const bad={...exported,maps:{"https://app.datalot.com":{"pick:#name":'targets:["contact.fullName","evil:payload"]'}}};
    expect(parseFieldMapImport(JSON.stringify(bad),true).dropped).toBe(1);
  });
  it("rejects nested, malformed, disabled or secured fan-out",()=>{
    for(const bad of ['targets:no','targets:[]','targets:["contact.fullName","skip"]','targets:["contact.fullName","secure:primarycontact.governmentid"]','targets:["contact.fullName","targets:[]"]']) expect(mappingTargets(bad)).toEqual([]);
    expect(()=>packMappingTargets(["contact.fullName","secure:primarycontact.governmentid"])).toThrow();
    expect(()=>packMappingTargets(Array.from({length:9},(_,i)=>`contact.field${i}`))).toThrow();
    expect(preferredFieldMap({name:"targets:broken"})).toEqual({name:"skip"});
  });
  it("captures a personal name into account and contact without deduplicating either route",()=>{
    const fields=expandedFieldMap({name:binding}).map(([,mapped])=>({label:"Name",value:"José Luis García Márquez",mapped,section:"Lead",group:"",source:"taught" as const}));
    fields[1]!.mapped="contact.latinFullName";
    const {app}=mergeIngestedFields(null,fields,{system:"Datalot",url:"https://app.datalot.com",title:"Lead"});
    expect(app.fields).toHaveLength(2);
    expect(app.normalized["crm:account"]?.name).toBe("José Luis García Márquez");
    expect(identityFromCapture(app)).toMatchObject({firstName:"José Luis",lastName:"García Márquez"});
    expect(buildFillValues(app)["contact.fullName"]).toBe("José Luis García Márquez");
  });
  it("fans out data-service fields while preserving the row of every contact",()=>{
    const a:CapturedApplicant={ezlynxApplicantId:1,firstName:"Ana",lastName:"López Pérez",dateOfBirth:null,dlNumber:null,dlState:null,address:null,phones:[],emails:[],coApplicants:[{firstName:"José",lastName:"García Márquez",relationship:"",phone:null,email:null,dateOfBirth:null,dlNumber:null,dlState:null}],isCommercial:false};
    const map={"person.firstName":packMappingTargets(["contacts[].firstName","crm:contacts[].nickname"])};
    const fields=ezlynxFields(a,map).filter(f=>f.label==="First name");
    expect(fields.map(f=>[f.value,f.mapped])).toEqual([["Ana","contact.firstName"],["Ana","crm:primarycontact.nickname"],["José","contact2.firstName"],["José","crm:contact2.nickname"]]);
    const migrated=effectiveTargets({"applicant.firstName":packMappingTargets(["contact.firstName","crm:primarycontact.nickname"])});
    expect(mappingTargets(migrated["person.firstName"])).toEqual(["contacts[].firstName","crm:contacts[].nickname"]);
  });
});
