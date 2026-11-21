// @vitest-environment jsdom
import { beforeAll,it,expect } from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {packMappingTargets} from "@/portal/mappingTargets";
type Field={label:string;value:string;mapped?:string;source?:string};
const g=globalThis as unknown as {
  __bettersPortalIngest(t:unknown,c:unknown):{fields:Field[]};
  __bettersPortalFill(p:unknown,overwrite:boolean,advance:boolean,map:unknown):Promise<unknown>;
  __bettersControlKey(el:Element):string;
};
beforeAll(()=>{
  (globalThis as {CSS?:{escape(s:string):string}}).CSS??={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,"\\$&")};
  HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:200,bottom:24,width:200,height:24,toJSON:()=>({})};};
  for(const f of ["mapping-targets.js","person-name.js","portal-mapper.js","portal-ingest.js","portal-fill.js"]) new Function(readFileSync(path.resolve(__dirname,"../public/portal",f),"utf8"))();
});
it("fans a control into both CRM targets and fills only from the preferred target",async()=>{
  document.body.innerHTML='<label for="name">Full Name</label><input id="name" name="name" value="Ana María López Pérez">';
  const el=document.querySelector("input")!;
  const key=g.__bettersControlKey(el);
  const target=packMappingTargets(["crm:account.name","contact.fullName"]);
  expect(g.__bettersPortalIngest([], {[key]:target}).fields.filter(f=>f.mapped).map(f=>f.mapped)).toEqual(["crm:account.name","contact.fullName"]);
  el.value="";
  await g.__bettersPortalFill({normalized:{},fields:[],values:{"crm:account.name":"Account value","contact.fullName":"Contact value"}},false,false,{[key]:target});
  expect(el.value).toBe("Account value");
  el.value="";
  const reversed=packMappingTargets(["contact.fullName","crm:account.name"]);
  await g.__bettersPortalFill({normalized:{},fields:[],values:{"crm:account.name":"Account value","contact.fullName":"Contact value"}},false,false,{[key]:reversed});
  expect(el.value).toBe("Contact value");
});
it("keeps each target's row alignment for repeated read-only contact values",()=>{
  document.body.innerHTML='<table id="people"><tbody><tr><td>Ana López Pérez</td></tr><tr><td>José García Márquez</td></tr></tbody></table>';
  const taught=["contacts[].latinFullName","crm:contacts[].nickname"].map(path=>({selector:"#people > tbody > tr:nth-of-type(1) > td",label:"Name",path}));
  expect(g.__bettersPortalIngest(taught,{}).fields.filter(f=>f.source==="taught").map(f=>f.mapped)).toEqual(["contact2.latinFullName","contact3.latinFullName","crm:contact2.nickname","crm:contact3.nickname"]);
});
