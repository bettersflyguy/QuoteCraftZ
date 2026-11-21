// @vitest-environment jsdom
import {act,useState,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {NameReview} from "@/panel/NameReview";
import {confirmNameSplit,pendingNameReviews,withReviewedNames} from "@/boldpenguin/nameReview";
import {mergeIngestedFields} from "@/boldpenguin/ingest";
const mock=vi.hoisted(()=>({send:vi.fn()}));
vi.mock("@/panel/api",()=>({send:mock.send}));
vi.mock("@fluentui/react-components",()=>({
  tokens:{},
  Text:({children}:{children:ReactNode})=><span>{children}</span>,
  Button:({children,onClick,disabled}:{children:ReactNode;onClick:()=>void;disabled?:boolean})=><button onClick={onClick} disabled={disabled}>{children}</button>,
  Input:({value,onChange,...props}:{value:string;onChange:(e:unknown,d:{value:string})=>void;"aria-label":string})=><input aria-label={props["aria-label"]} value={value} onChange={e=>onChange(e,{value:e.target.value})}/>
}));

it("lets a lead choose either boundary and saves only that person's split",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const fields=["contact.fullName","crm:account.name"].map(mapped=>({label:"Full name",value:"Carlos García Márquez",mapped,section:"Lead",group:"",source:"taught" as const}));
  let app=mergeIngestedFields(null,fields,{system:"Datalot",url:"https://app.datalot.com",title:"Lead"}).app;
  mock.send.mockImplementation(async input=>{app=confirmNameSplit(app,input);return app;});
  function Harness(){const [held,setHeld]=useState(app);return <NameReview app={held} onChange={setHeld}/>;}
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent===label)!;
  await act(async()=>root.render(<Harness/>));
  expect(pendingNameReviews(app)).toHaveLength(1);
  await act(async()=>button("Two surnames").click());
  expect(Array.from(container.querySelectorAll("input")).map(i=>i.value)).toEqual(["Carlos","García Márquez"]);
  await act(async()=>button("Confirm name split").click());
  expect(container.textContent).toContain("Confirmed: Carlos / García Márquez");
  expect(pendingNameReviews(app)).toHaveLength(0);
  expect(withReviewedNames(app).normalized.contact).toMatchObject({firstName:"Carlos",lastName:"García Márquez"});
  await act(async()=>button("Edit split").click());
  await act(async()=>button("One surname").click());
  expect(Array.from(container.querySelectorAll("input")).map(i=>i.value)).toEqual(["Carlos García","Márquez"]);
  await act(async()=>button("Confirm name split").click());
  expect(withReviewedNames(app).normalized.contact).toMatchObject({firstName:"Carlos García",lastName:"Márquez"});
  expect(app.fields).toEqual(fields);
  expect(mock.send.mock.calls.every(([request])=>request.type==="panel/confirmNameSplit")).toBe(true);
  await act(async()=>root.unmount());container.remove();
});
