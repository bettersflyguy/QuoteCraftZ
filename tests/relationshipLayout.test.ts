import {it,expect} from "vitest";
import {entityGroup,readLayout} from "@/options/relationshipLayout";
it("groups by stored entity, preserving account/contact distinctions despite runtime aliases",()=>{
  expect(entityGroup("crm:account.emailaddress1",null)).toMatchObject({id:"account",logical:"account"});
  expect(entityGroup("crm:primarycontact.emailaddress1",null)).toMatchObject({id:"primarycontact",logical:"contact"});
  expect(entityGroup("crm:contacts[].firstname",null)).toMatchObject({id:"contacts",label:"Contacts (all rows)"});
  expect(entityGroup("crm:property2.iacrm_yearbuilt",null)).toMatchObject({id:"properties:2",logical:"iacrm_property"});
  expect(entityGroup("priorCoverage.carrier",null)).toMatchObject({id:"priorcoverage",logical:"iacrm_priorcoverage"});
  expect(entityGroup("crm:addresses[].city",null).logical).toBe("customeraddress");
  expect(entityGroup("note:properties[]",null).logical).toContain("timeline");
});
it("restores independent widths and arrow spacing within usable bounds",()=>{
  expect(readLayout({widths:{crm:400,"https://rater.example":600,bad:NaN,tiny:1},gap:150})).toEqual({widths:{crm:400,"https://rater.example":600,tiny:180},offsets:{},gap:150});
  expect(readLayout(null)).toEqual({widths:{},offsets:{},gap:80});
  expect(readLayout({widths:{crm:9000},gap:999}).gap).toBe(240);
});

it("restores column positions independently from widths with bounded offsets",()=>{
  expect(readLayout({widths:{crm:360},offsets:{crm:-120,"https://rater.example":440,bad:Infinity}})).toEqual({widths:{crm:360},offsets:{crm:-120,"https://rater.example":440},gap:80});
});
