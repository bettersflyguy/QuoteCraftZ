// @vitest-environment jsdom
import {act,useState,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {mappingTargets} from "@/portal/mappingTargets";
import {MultiTargetPicker} from "@/panel/MultiTargetPicker";
vi.mock("@fluentui/react-components",()=>({
  Button:({children,onClick,...props}:{children?:ReactNode;onClick?:()=>void;"aria-label"?:string;"aria-pressed"?:boolean})=><button onClick={onClick} aria-label={props["aria-label"]} aria-pressed={props["aria-pressed"]}>{children}</button>,
  Tooltip:({children}:{children:ReactNode})=><>{children}</>
}));
vi.mock("@fluentui/react-icons",()=>({AddRegular:()=>null,DeleteRegular:()=>null,StarFilled:()=>null,StarRegular:()=>null}));
vi.mock("@/panel/TargetPicker",()=>({TargetPicker:({value,onChange,groups,specials}:{value:string;onChange:(v:string)=>void;groups:{paths:{path:string;label:string}[]}[];specials:{value:string;label:string}[]})=><select aria-label="Target" value={value} onChange={e=>onChange(e.target.value)}>{specials.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}{groups.flatMap(g=>g.paths).map(p=><option key={p.path} value={p.path}>{p.label}</option>)}</select>}));

it("adds, persists, prefers and removes a second destination without replacing the first",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  let saved="crm:account.name";
  function Harness(){const [value,set]=useState(saved);return <MultiTargetPicker value={value} onChange={v=>{saved=v;set(v);}} groups={[{group:"CRM",paths:[{path:"crm:account.name",label:"Account"},{path:"contact.fullName",label:"Contact"}]}]} specials={[{value:"",label:"Not mapped"}]}/>;}
  const container=document.createElement("div");document.body.append(container);
  const root=createRoot(container);
  await act(async()=>root.render(<Harness/>));
  const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent===label || b.getAttribute("aria-label")===label)!;
  await act(async()=>button("Add target").click());
  expect(container.querySelectorAll("select")).toHaveLength(2);
  expect(saved).toBe("crm:account.name");
  await act(async()=>{const select=container.querySelectorAll("select")[1]!;select.value="contact.fullName";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(mappingTargets(saved)).toEqual(["crm:account.name","contact.fullName"]);
  await act(async()=>button("Use as preferred fill source").click());
  expect(mappingTargets(saved)).toEqual(["contact.fullName","crm:account.name"]);
  await act(async()=>button("Remove target").click());
  expect(saved).toBe("crm:account.name");
  await act(async()=>root.unmount());container.remove();
});
