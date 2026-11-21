// @vitest-environment jsdom
import {act,useState,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@fluentui/react-components",()=>({
  Button:({children,onClick}:{children?:ReactNode;onClick?:()=>void})=><button onClick={onClick}>{children}</button>,
  Tooltip:({children}:{children:ReactNode})=><>{children}</>,
  makeStyles:(styles:Record<string,unknown>)=>()=>Object.fromEntries(Object.keys(styles).map(k=>[k,k])),
  tokens:{}
}));
import {MultiTargetPicker} from "@/panel/MultiTargetPicker";

it("opens and focuses the new target search on Add target, keeping the existing mapping",async()=>{
  HTMLElement.prototype.scrollIntoView=()=>{};
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  let saved="crm:account.name";
  function Harness(){const [value,setValue]=useState(saved);return <MultiTargetPicker value={value} onChange={v=>{saved=v;setValue(v);}} groups={[{group:"CRM",paths:[{path:"crm:account.name",label:"Account name"},{path:"crm:primarycontact.fullname",label:"Contact name"}]}]} specials={[{value:"",label:"Not captured"}]}/>;}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Harness/>));
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Add target")!.click());
    const search=host.querySelector<HTMLInputElement>("input[placeholder^='Search fields']");
    expect(search).not.toBeNull();expect(document.activeElement).toBe(search);
    expect(saved).toBe("crm:account.name");
    await act(async()=>Array.from(host.querySelectorAll("[role='option']")).find(el=>el.textContent?.includes("Contact name"))!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
    expect(saved).toContain("crm:account.name");expect(saved).toContain("crm:primarycontact.fullname");
  } finally {await act(async()=>root.unmount());host.remove();}
});
