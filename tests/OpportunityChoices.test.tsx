// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {OpportunityChoices} from "@/panel/OpportunityChoices";
it("provides compact line, add, remove and new-name entry controls for non-quote opportunities",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const add=vi.fn(),remove=vi.fn(),line=vi.fn();
  try{
    await act(async()=>root.render(<OpportunityChoices routes={[{source:"extra:life",lobId:"life",label:"Life"}]} open={[]} lobs={[{lobId:"life",name:"Life"},{lobId:"health",name:"Health"},{lobId:"business",name:"Commercial Package"}]} choices={{"extra:life":"new"}} names={{"extra:life":"Family protection"}} disabled={false} onChange={()=>{}} onNameChange={()=>{}} onLineChange={line} onAdd={add} onRemove={remove}/>));
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("Family protection");
    await act(async()=>host.querySelector<HTMLButtonElement>("button[aria-label='Add opportunity']")!.click());
    expect(add).toHaveBeenCalledOnce();
    const select=host.querySelector<HTMLSelectElement>("select[aria-label='Life: Line']")!;
    await act(async()=>{select.value="business";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(line).toHaveBeenCalledWith("extra:life","business");
    await act(async()=>host.querySelector<HTMLButtonElement>("button[aria-label='Remove Life']")!.click());
    expect(remove).toHaveBeenCalledWith("extra:life");
  }finally{await act(async()=>root.unmount());host.remove();}
});
it("shows open opportunity context and New without defaulting a choice",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const changed=vi.fn();
  try{
    await act(async()=>root.render(<OpportunityChoices lobs={[{lobId:"home",name:"Homeowners"}]} names={{}} onAdd={()=>{}} onRemove={()=>{}} onLineChange={()=>{}} onNameChange={()=>{}} routes={[{source:"Home",lobId:"home",label:"Homeowners"}]} choices={{}} disabled={false} onChange={changed} open={[
      {opportunityId:"renew",name:"Home renewal",lobId:"home",lobName:"Homeowners",desiredEffectiveDate:"2027-01-01T00:00:00Z"},
      {opportunityId:"purchase",name:"New house",lobId:"home",lobName:"Homeowners",desiredEffectiveDate:"2026-12-01"},
      {opportunityId:"auto",name:"Auto renewal",lobId:"auto",lobName:"Auto",desiredEffectiveDate:null}
    ]}/>));
    const select=host.querySelector<HTMLSelectElement>("select[aria-label='Homeowners: Opportunity']")!;
    expect(select.value).toBe("");expect(select.options.length).toBe(5);
    expect(select.options[2]!.textContent).toContain("Home renewal · Homeowners · 2027-01-01");
    expect(select.options[4]!.disabled).toBe(true);
    await act(async()=>{select.value="purchase";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(changed).toHaveBeenLastCalledWith("Home","purchase");
    await act(async()=>{select.value="new";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(changed).toHaveBeenLastCalledWith("Home","new");
  }finally{await act(async()=>root.unmount());host.remove();}
});

