import {afterEach,it,expect,vi} from "vitest";
import {reset} from "./helpers/chromeStub";
import {realDeps} from "@/workerRouter";

afterEach(()=>{delete (globalThis as {__bettersPortalIngest?:unknown}).__bettersPortalIngest;});
it("surfaces a lead-selection failure even when another frame returns an empty capture",async()=>{
  reset();
  const empty={fields:[],secure:[],title:"blank",url:"about:blank"};
  Object.assign(chrome,{tabs:{get:async()=>({url:"https://app.datalot.com/client"})},scripting:{executeScript:vi.fn(async(o:{func?:(...a:unknown[])=>unknown;args?:unknown[]})=>o.func ? [{frameId:0,result:o.func(...(o.args||[]))},{frameId:1,result:empty}] : [])}});
  Object.assign(globalThis,{__bettersPortalIngest:()=>{throw new Error("This page contains multiple leads. Use 1 Lead to select one expanded lead before ingesting.");}});
  await expect(realDeps.ingestPortalTab(7)).rejects.toThrow("Use 1 Lead");
});
it("ignores missing frame results and retains successful fields",async()=>{
  reset();
  const field={label:"Name",value:"Alex Rivera",section:"",group:"",source:"taught",mapped:"contact.fullName"};
  Object.assign(chrome,{tabs:{get:async()=>({url:"https://app.datalot.com/client"})},scripting:{executeScript:vi.fn(async(o:{func?:unknown})=>o.func ? [{frameId:0},{frameId:1,result:{fields:[field],title:"Lead",url:"https://app.datalot.com/client"}}] : [])}});
  expect(await realDeps.ingestPortalTab(7)).toMatchObject({fields:[field],title:"Lead"});
});
