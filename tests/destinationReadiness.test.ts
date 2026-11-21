import {it,expect} from "vitest";
import {destinationReadiness} from "@/portal/destinationReadiness";
import {mappingServices} from "@/options/mappingGraph";
import {packMappingTargets} from "@/portal/mappingTargets";
import type {CapturedApplication} from "@/boldpenguin/types";
const site="https://rater.example";
const app=(normalized:CapturedApplication["normalized"]):CapturedApplication=>({schemaVersion:"1.1",capturedAt:"",source:{system:"Test",url:site,title:"Application"},completion:{likelyCompleted:false,matchedPhrases:[],hasReviewStep:false},scannedSections:[],normalized,fields:[]});
const score=(map:Record<string,string>,data:CapturedApplication|null)=>destinationReadiness(mappingServices({[site]:map},{}),data).find(d=>d.id===site)!;
it("counts each destination field once using only its preferred fill target, and excludes capture-only/secured mappings",()=>{
 const result=score({"field:email":"crm:primarycontact.emailaddress1","field:name":packMappingTargets(["crm:account.name","contact.fullName"]),"field:notes":"note:properties[]","field:skip":"skip","field:ssn":"secure:primarycontact.iacrm_ssn"},app({contact:{email:"a@example.test",fullName:"Alex Smith"}}));
 expect(result).toMatchObject({available:1,total:2,percent:50,mappedFields:2});
 expect(result.missing).toEqual([expect.objectContaining({label:"name",target:"crm:account.name"})]);
});
it("requires an answer for every known vehicle row without treating another row's answer as available",()=>{
 const result=score({"field:vin":"vehicles[].vin"},app({vehicle1:{vin:"VIN-ONE"},vehicle2:{make:"Toyota"}}));
 expect(result).toMatchObject({available:1,total:2,percent:50});
 expect(result.missing[0]).toMatchObject({target:"vehicle2.vin",row:"Row 2"});
});
it("includes the applicant and related contacts in Contacts all rows",()=>{
 const result=score({"field:email":"crm:contacts[].emailaddress1"},app({contact:{email:"first@example.test"},contact2:{firstName:"Alex",lastName:"Smith"}}));
 expect(result).toMatchObject({available:1,total:2});
 expect(result.missing[0]).toMatchObject({target:"crm:contact2.emailaddress1",row:"Contact 2"});
});
it("does not show 100% for an empty mapping list and does not invent missing vehicle data",()=>{
 expect(score({"field:note":"note"},null)).toMatchObject({available:0,total:0,percent:null});
 expect(score({"field:year":"vehicles[].year"},null)).toMatchObject({available:0,total:1,percent:0});
});
it("keeps false/zero answers and blocks unconfirmed parsed first/last names",()=>{
 expect(score({"field:year":"crm:property1.iacrm_numberofclaims"},app({"crm:property1":{iacrm_numberofclaims:"0"}}))).toMatchObject({available:1,total:1,percent:100});
 const data=app({contact:{fullName:"Carlos García Márquez"}});
 data.fields=[{label:"Name",value:"Carlos García Márquez",mapped:"contact.fullName",section:"",group:"",source:"taught"}];
 expect(score({"field:first":"contact.firstName"},data)).toMatchObject({available:0,total:1,nameReview:true});
});
