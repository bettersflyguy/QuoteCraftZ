// @vitest-environment jsdom
import {act,type ButtonHTMLAttributes} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@fluentui/react-components",()=>({
  Button:({icon:_,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:unknown})=><button {...props}/>,Spinner:()=>null
}));
vi.mock("@fluentui/react-icons",()=>({PlugConnectedRegular:()=>null,PlugDisconnectedRegular:()=>null}));
vi.mock("@/panel/api",()=>({send:vi.fn()}));
import {send} from "@/panel/api";
import {CrmConnection} from "@/panel/CrmConnection";
it("shows click progress and a failed reconnect beyond a tooltip, then permits retry",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal("chrome",{storage:{onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}});
  let rejectSignIn!:(e:Error)=>void;
  vi.mocked(send).mockImplementation(async msg=>{
    if(msg.type==="auth/signIn")return new Promise((_,reject)=>{rejectSignIn=reject;});
    throw new Error("Sign-in required");
  });
  const notice=vi.fn();const busy=vi.fn();const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<CrmConnection onBusy={busy} onNotice={notice}/>));
    await act(async()=>host.querySelector("button")!.click());
    expect(notice).toHaveBeenLastCalledWith("Complete the Microsoft sign-in window to connect CRM.");
    expect(host.querySelector("button")!.disabled).toBe(true);
    await act(async()=>rejectSignIn(new Error("Another Microsoft sign-in is already open.")));
    expect(notice).toHaveBeenLastCalledWith("Another Microsoft sign-in is already open.");
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(host.querySelector("button")!.disabled).toBe(false);
  }finally{await act(async()=>root.unmount());host.remove();}
});
