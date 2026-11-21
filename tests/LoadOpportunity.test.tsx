// @vitest-environment jsdom
import {act,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi,beforeEach} from "vitest";
import type {CapturedApplication} from "@/boldpenguin/types";
const mock=vi.hoisted(()=>({send:vi.fn()}));
beforeEach(()=>{mock.send.mockClear();});
vi.mock("@/panel/api",async importOriginal=>({...await importOriginal<object>(),send:mock.send}));
vi.mock("@fluentui/react-components",()=>({
  tokens:{},makeStyles:()=>()=>({}),Spinner:()=>null,
  Button:({children,onClick,disabled}:{children:ReactNode;onClick:()=>void;disabled?:boolean})=><button onClick={onClick} disabled={disabled}>{children}</button>,
  Input:({value,placeholder}:{value:string;placeholder?:string})=><input readOnly value={value} placeholder={placeholder}/>,
  Checkbox:()=>null,Radio:()=>null,RadioGroup:({children}:{children:ReactNode})=><div>{children}</div>,
  Dropdown:({children}:{children:ReactNode})=><div>{children}</div>,
  Combobox:()=>null,Option:({children}:{children:ReactNode})=><span>{children}</span>
}));
vi.mock("@/crm/environments",()=>({getActiveEnvironment:async()=>({id:"dev",name:"DEV",orgUrl:"https://dev.test",color:"green"}),crmRecordUrl:()=>"https://dev.test"}));
import {LoadToCrm} from "@/panel/steps/LoadToCrm";
it("creates multiple named opportunities without any captured quotes",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  mock.send.mockClear();
  vi.stubGlobal("chrome",{storage:{local:{get:async(key:string)=>({[key]:{userId:"agent",fullName:"Agent"}})},onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}});
  mock.send.mockImplementation(async msg=>{
    if(msg.type==="panel/getLobs")return [{lobId:"life",name:"Life"},{lobId:"travel",name:"Travel"}];
    if(msg.type==="panel/findMatches")return [{kind:"account",id:"insured",name:"Alex Smith",matchedBy:"name"}];
    if(msg.type==="panel/createOpportunity")return {opportunityId:`created-${msg.lobId}`,name:msg.name,lobId:msg.lobId};
    if(msg.type==="panel/getStagesForLob")return null;
    return [];
  });
  const app:CapturedApplication={schemaVersion:"1.1",capturedAt:"",source:{system:"Test",url:"https://source.test",title:""},completion:{likelyCompleted:false,matchedPhrases:[],hasReviewStep:false},scannedSections:[],fields:[],normalized:{contact:{firstName:"Alex",lastName:"Smith"}}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text)!;
  const change=async(select:HTMLSelectElement,value:string)=>act(async()=>{select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});
  try{
    await act(async()=>root.render(<LoadToCrm app={app}/>));
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.startsWith("Load into CRM"))!.click());
    await act(async()=>{await new Promise(r=>setTimeout(r,450));});
    await act(async()=>button("Select account").click());
    for(const [lob,name] of [["life","Family protection"],["travel","Europe trip"]]){
      await act(async()=>host.querySelector<HTMLButtonElement>("button[aria-label='Add opportunity']")!.click());
      const lines=host.querySelectorAll<HTMLSelectElement>("select[aria-label$=': Line']");await change(lines[lines.length-1]!,lob!);
      const choices=host.querySelectorAll<HTMLSelectElement>("select[aria-label$=': Opportunity']");await change(choices[choices.length-1]!,"new");
      const inputs=host.querySelectorAll<HTMLInputElement>("input[aria-label$=': New opportunity name']");
      await act(async()=>{const input=inputs[inputs.length-1]!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,name);input.dispatchEvent(new Event("input",{bubbles:true}));});
    }
    expect(mock.send.mock.calls.some(([m])=>m.type==="panel/appCommit")).toBe(false);
    await act(async()=>button("Save to CRM").click());
    expect(mock.send.mock.calls.filter(([m])=>m.type==="panel/createOpportunity").map(([m])=>({lobId:m.lobId,name:m.name}))).toEqual([{lobId:"life",name:"Family protection"},{lobId:"travel",name:"Europe trip"}]);
    expect(mock.send.mock.calls.some(([m])=>m.type==="panel/writeQuotes")).toBe(false);
  }finally{await act(async()=>root.unmount());host.remove();}
});
it("does no account or quote writes when an insured is picked, then writes to the selected second opportunity",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal("chrome",{storage:{local:{get:async(key:string)=>({[key]:{userId:"agent",fullName:"Agent"}})},onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}});
  const opportunities=["first","second"].map(opportunityId=>({opportunityId,name:opportunityId,lobId:"home",lobName:"Homeowners",desiredEffectiveDate:null}));
  mock.send.mockImplementation(async msg=>{
    if(msg.type==="panel/getLobs")return [{lobId:"home",name:"Homeowners"}];
    if(msg.type==="panel/findMatches")return [{kind:"account",id:"insured",name:"Alex Smith",matchedBy:"name"}];
    if(msg.type==="panel/getOpportunities")return opportunities;
    return [];
  });
  const app:CapturedApplication={schemaVersion:"1.1",capturedAt:"",source:{system:"Test",url:"https://source.test",title:""},completion:{likelyCompleted:false,matchedPhrases:[],hasReviewStep:false},scannedSections:[],fields:[],normalized:{contact:{firstName:"Alex",lastName:"Smith"}},quotes:[{key:"q",provider:"Portal",source:"Test",lob:"Home",carrierName:"Test",carrierRef:null,carrierId:"carrier",kind:"requested",quoteNumber:null,premium:100,termMonths:12,premiumStatus:"estimated",coverageSummary:"",coverageLines:[],link:null,selected:true}]};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text)!;
  try{
    await act(async()=>root.render(<LoadToCrm app={app}/>));
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.startsWith("Load into CRM"))!.click());
    await act(async()=>{await new Promise(r=>setTimeout(r,450));});
    await act(async()=>button("Select account").click());
    expect(mock.send.mock.calls.some(([m])=>m.type==="panel/appCommit")).toBe(false);
    const select=host.querySelector("select[aria-label='Homeowners: Opportunity']")! as HTMLSelectElement;
    expect(select).not.toBeNull();expect(select.value).toBe("");expect(button("Save to CRM").disabled).toBe(true);
    await act(async()=>{select.value="second";select.dispatchEvent(new Event("change",{bubbles:true}));});
    await act(async()=>button("Save to CRM").click());
    const write=mock.send.mock.calls.find(([m])=>m.type==="panel/writeQuotes")?.[0];
    expect(write).toMatchObject({accountId:"insured",groups:[{opportunityId:"second",created:false}]});
    expect(mock.send.mock.calls.some(([m])=>m.type==="panel/createOpportunity")).toBe(false);
  }finally{await act(async()=>root.unmount());host.remove();}
});

