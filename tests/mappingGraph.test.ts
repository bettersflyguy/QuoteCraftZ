import {it,expect} from "vitest";
import {mappingServices,graphTarget} from "@/options/mappingGraph";
import {packMappingTargets} from "@/portal/mappingTargets";

it("shows configured services and every capture target while limiting output to the preferred target",()=>{
  const services=mappingServices({"https://app.datalot.com":{
    "field:name":packMappingTargets(["contact.fullName","crm:account.name"]),
    "field:email":"crm:primarycontact.emailaddress1","field:dui":"note:contact",
    "field:ssn":"secure:primarycontact.iacrm_ssn","field:ignored":"skip"
  }},{});
  expect(services).toHaveLength(2);
  expect(services[0]?.fields.map(f=>[f.target,f.output])).toEqual([["contact.fullName",true],["crm:account.name",false],["crm:primarycontact.emailaddress1",true],["note:contact",false]]);
  expect(graphTarget("crm:primarycontact.emailaddress1")).toBe(graphTarget("contact.email"));
  expect(graphTarget("crm:contacts[].emailaddress1")).not.toBe(graphTarget("contact.email"));
});
it("integrates the built-in service defaults and combines service and page mappings",()=>{
  expect(mappingServices({},{}).map(s=>s.id)).toEqual(["https://app.ezlynx.com"]);
  const services=mappingServices({"https://app.ezlynx.com":{"field:zip":"address.postalCode"}},{ezlynx:{"person.email":"contacts[].email"}});
  expect(services).toHaveLength(1);
  expect(services[0]?.fields).toEqual(expect.arrayContaining([expect.objectContaining({label:"zip"}),expect.objectContaining({target:"contacts[].email"})]));
});

it("retains editable source identity, full multi-target bindings, and unmapped service fields",()=>{
  const binding=packMappingTargets(["contact.fullName","crm:account.name"]);
  const services=mappingServices({"https://app.ezlynx.com":{"field:name":binding}},{ezlynx:{"person.email":""}});
  const page=services[0]!.fields.filter(f=>f.key==="field:name");
  expect(page).toHaveLength(2);
  expect(page.every(f=>f.binding===binding&&f.source==="page")).toBe(true);
  expect(services[0]!.fields.find(f=>f.key==="person.email")).toMatchObject({source:"ezlynx",binding:"",target:"",output:false});
});
