import { afterEach, expect, it, vi } from "vitest";
import { grantActiveTab } from "@/panel/portalAccess";
afterEach(()=>vi.unstubAllGlobals());
it("grants the panel's site instead of the last-focused CRM sign-in popup",async()=>{
  const query=vi.fn(async(options:{currentWindow?:boolean})=>options.currentWindow?[{id:7,url:"https://app.datalot.com/client"}]:[{id:99,url:"https://login.microsoftonline.com/auth"}]);
  vi.stubGlobal("chrome",{tabs:{query},permissions:{contains:vi.fn(async()=>true)}});
  expect(await grantActiveTab()).toEqual({id:7,url:"https://app.datalot.com/client"});
  expect(query).toHaveBeenCalledWith({active:true,currentWindow:true});
});
