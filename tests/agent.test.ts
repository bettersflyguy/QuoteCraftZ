vi.mock("@/crm/auth",()=>({getAccessToken:vi.fn(async()=>"TOKEN"),clearToken:vi.fn(async()=>{}),AuthRequiredError:class extends Error{}}));
import {beforeEach,it,expect,vi} from "vitest";
import {backing,reset} from "./helpers/chromeStub";
import {getCrmAgent,crmAgentKey,ownedCreate} from "@/crm/agent";
const env={id:"dev",name:"DEV",orgUrl:"https://dev.crm.dynamics.com",color:"green" as const};
const agent={userId:"11111111-1111-1111-1111-111111111111",fullName:"Agent One"};
beforeEach(reset);
it("isolates the selected CRM Agent by environment",async()=>{
 backing[crmAgentKey(env.orgUrl)]=agent;
 expect(await getCrmAgent(env)).toEqual(agent);
 expect(await getCrmAgent({...env,orgUrl:"https://prod.crm.dynamics.com"})).toBeNull();
});
it("owns only new business records, leaving updates, reference data and input objects untouched",()=>{
 const body={name:"Insured"};
 for(const path of ["accounts?$select=accountid","contacts","leads","opportunities","iacrm_quotes","iacrm_properties","iacrm_vehicles"])
   expect(ownedCreate(path,body,agent)).toEqual({...body,"ownerid@odata.bind":`/systemusers(${agent.userId})`});
 for(const path of ["accounts(existing)","iacrm_quotes(existing)","customeraddresses","iacrm_carriers","iacrm_quotingmethods"])
   expect(ownedCreate(path,body,agent)).toBe(body);
 expect(body).toEqual({name:"Insured"});expect(ownedCreate("accounts",body,null)).toBe(body);
});

it("puts the chosen owner on the account POST and only POST parts of a mixed batch",async()=>{
 const {createAccount,executeBatch}=await import("@/crm/dataverse");
 backing[crmAgentKey(env.orgUrl)]=agent;
 const requests:{url:string;body:string}[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,body:String(init.body)});return {ok:true,status:200,headers:new Headers(),json:async()=>({accountid:"a",name:"Insured"}),text:async()=>"--batchresponse--"} as Response;}));
 await createAccount(env,{name:"Insured",street:null,city:null,state:null,postalCode:null,phone:null,email:null});
 expect(JSON.parse(requests[0]!.body)["ownerid@odata.bind"]).toBe(`/systemusers(${agent.userId})`);
 await executeBatch(env,[{key:"new",method:"POST",url:"iacrm_quotes",body:{name:"new"}},{key:"existing",method:"PATCH",url:"iacrm_quotes(existing)",body:{name:"existing"}}]);
 expect(requests[1]!.body.match(/ownerid@odata.bind/g)).toHaveLength(1);
});
it("ensures an insured servicing-team entry for an intake load with no quotes, without reassigning an existing owner",async()=>{
 const {routeMessage}=await import("@/workerRouter");
 backing[crmAgentKey(env.orgUrl)]=agent;
 const createServicingTeamMember=vi.fn(async()=>{}),assignOwner=vi.fn(async()=>{});
 const result=await routeMessage({type:"panel/appCommit",accountId:"existing",insuredType:null,applicant:{coApplicants:[]} as never},{getActiveEnvironment:async()=>env,getCapturedApplication:async()=>({fields:[],normalized:{},source:{system:"Datalot",url:"https://app.datalot.com",title:"Lead"}}),getFieldCatalog:async()=>({entities:[]}),hasServicingTeamMember:async()=>false,createServicingTeamMember,assignOwner,getAccountEnrichmentState:async()=>{throw new Error("unavailable");}} as never);
 expect(result.ok).toBe(true);
 expect(createServicingTeamMember).toHaveBeenCalledWith(env,{accountId:"existing",userId:agent.userId,name:agent.fullName});
 expect(assignOwner).not.toHaveBeenCalled();
});
