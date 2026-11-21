// @vitest-environment jsdom
import { beforeAll, afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const g=globalThis as unknown as {
  __bettersPortalScan(app:unknown,map:unknown): {key:string;label:string}[];
  __bettersPortalIngest(t?:unknown,c?:unknown,one?:boolean): {fields:{label:string;value:string}[]};
  __bettersOneLead:boolean;
  __bettersLead:{get():{el:Element;key:string}};
};
beforeAll(()=>{
  HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:200,bottom:24,width:200,height:24,toJSON:()=>({})};};
  (globalThis as {CSS?:{escape(s:string):string}}).CSS??={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,"\\$&")};
  for(const script of ["portal-mapper.js","portal-ingest.js","portal-fill.js"])new Function(readFileSync(path.resolve(__dirname,"../public/portal",script),"utf8"))();
});
afterEach(()=>{g.__bettersOneLead=false;document.body.innerHTML="";});
const markup=(name:string)=>`<ul><li>Name</li><li>${name}</li></ul><ul><li>Home Number</li><li>2175550148</li></ul><ul><li>Street</li><li>504 South St</li></ul>`;
it("discovers Datalot-style read-only label/value lists before any field is taught",()=>{
  document.body.innerHTML=`<main><section>${markup("Jordan Miller")}</section></main>`;
  const rows=g.__bettersPortalScan(null,{});
  expect(rows.map(r=>r.label)).toEqual(expect.arrayContaining(["Name","Home Number","Street"]));
  expect(rows.every(r=>r.key.startsWith("field:"))).toBe(true);
  expect(g.__bettersPortalIngest().fields).toEqual(expect.arrayContaining([expect.objectContaining({label:"Name",value:"Jordan Miller"})]));
});
it("discovers only the selected lead and captures the newly saved mapping",()=>{
  document.body.innerHTML=`<section id=other>${markup("Jordan Miller")}</section><section id=chosen>${markup("Alex Rivera")}</section>`;
  g.__bettersOneLead=true;g.__bettersLead={get:()=>({el:document.querySelector("#chosen")!,key:"chosen"})};
  const rows=g.__bettersPortalScan(null,{});
  const name=rows.find(r=>r.label==="Name")!;
  expect(rows).toHaveLength(3);
  expect(name.key).toBe("field:name");
  const fields=g.__bettersPortalIngest([{byLabel:name.key.slice(6),label:"Full Name",path:"contact.fullName"}],undefined,true).fields;
  expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({label:"Full Name",value:"Alex Rivera"})]));
  expect(fields.some(f=>f.value==="Jordan Miller")).toBe(false);
});
it("does not turn navigation links or editable controls into read-only discoveries",()=>{
  document.body.innerHTML=`<nav><ul><li>Home</li><li>Settings</li></ul></nav><ul><li>Carrier</li><li><select><option>Safeco</option></select></li></ul>`;
  const rows=g.__bettersPortalScan(null,{});
  expect(rows.some(r=>r.key.startsWith("pick:"))).toBe(false);
});
it("uses the detail labels inside a colspan row rather than the ancestor Call Time header",()=>{
  document.body.innerHTML=`<table><thead><tr><th>Call Time</th><th>Caller Name</th><th>Caller #</th></tr></thead><tbody><tr><td>Today</td><td>Jordan Miller</td><td>2175550148</td></tr><tr><td colspan=3><section id=detail>${markup("Jordan Miller")}</section></td></tr></tbody></table>`;
  g.__bettersOneLead=true;g.__bettersLead={get:()=>({el:document.querySelector("#detail")!,key:"detail"})};
  const rows=g.__bettersPortalScan(null,{});
  expect(rows.map(r=>r.label)).toEqual(["Name","Home Number","Street"]);
  expect(rows.some(r=>r.label==="Call Time")).toBe(false);
  const name=rows.find(r=>r.label==="Name")!;
  const result=g.__bettersPortalIngest([{byLabel:name.key.slice(6),label:"",path:"note"}],undefined,true);
  expect(result.fields).toEqual(expect.arrayContaining([expect.objectContaining({label:"Name",value:"Jordan Miller"})]));
});
it("keeps label bindings correct across optional fields, reordered leads and a scoped vehicle array",()=>{
  const pair=(label:string,value:string)=>`<div><li>${label}</li><li>${value}</li></div>`;
  document.body.innerHTML=`<table><tbody>
    <tr><td>First call</td></tr><tr><td colspan=3><section id=first><ul>${pair("Receipt Code","A")}${pair("Name","Alex Rivera")}${pair("Own Home","No")}</ul></section></td></tr>
    <tr><td>Second call</td></tr><tr><td colspan=3><section id=second><ul>${pair("Receipt Code","B")}${pair("Email","alex@example.test")}${pair("Name","Ana López Pérez")}${pair("Own Home","Yes")}</ul><ul>${pair("Year","2016")}${pair("Make","JEEP")}</ul><ul>${pair("Year","2011")}${pair("Make","FORD")}</ul></section></td></tr>
  </tbody></table>`;
  const scan=g.__bettersPortalScan(null,{});
  expect(scan.filter(r=>r.key==="field:name")).toHaveLength(1);
  expect(()=>g.__bettersPortalIngest([{byLabel:"name",label:"Name",path:"contact.fullName"}])).toThrow("multiple leads");
  g.__bettersOneLead=true;g.__bettersLead={get:()=>({el:document.querySelector("#second")!,key:"B"})};
  const teachings=[{byLabel:"name",label:"Full name",path:"contact.fullName"},{byLabel:"own home",label:"Own Home",path:"note:contact"},{byLabel:"year",label:"Year",path:"crm:vehicles[].iacrm_year"},{byLabel:"make",label:"Make",path:"crm:vehicles[].iacrm_make"}];
  const fields=g.__bettersPortalIngest(teachings,undefined,true).fields as {label:string;value:string;mapped?:string}[];
  expect(fields.filter(f=>f.mapped).map(f=>[f.value,f.mapped])).toEqual([["Ana López Pérez","contact.fullName"],["Yes","note:contact"],["2016","crm:vehicle1.iacrm_year"],["2011","crm:vehicle2.iacrm_year"],["JEEP","crm:vehicle1.iacrm_make"],["FORD","crm:vehicle2.iacrm_make"]]);
  document.querySelector("#second li:nth-of-type(2)")!.textContent="C";
  expect(g.__bettersPortalIngest(teachings,undefined,true).fields.filter(f=>f.label==="Own Home" && (f as {mapped?:string}).mapped).map(f=>f.value)).toEqual(["Yes"]);
});
