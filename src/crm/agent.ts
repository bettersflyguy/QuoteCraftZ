import type {CrmEnvironment} from "./environments";
import type {UserRow} from "./dataverse";
import {ROW_TABLES} from "@/portal/assetTables";
export const crmAgentKey=(orgUrl:string)=>`owner/default:${orgUrl}`;
export async function getCrmAgent(env:CrmEnvironment):Promise<UserRow|null> {
  const key=crmAgentKey(env.orgUrl);
  const value=(await chrome.storage.local.get(key))[key] as UserRow|undefined;
  return value?.userId&&value.fullName?value:null;
}
const OWNED_CREATES=new Set(["accounts","contacts","leads","opportunities","iacrm_quotes","iacrm_policies","iacrm_priorcoverages",...ROW_TABLES.map(t=>t.set)]);
/** Only new business records receive the selected owner. Updates and shared
 * reference tables must never inherit this preference. */
export function ownedCreate(path:string,body:unknown,agent:UserRow|null):unknown {
  if(!agent||!OWNED_CREATES.has(path.split("?")[0]!)||!body||typeof body!=="object")return body;
  return {...body,"ownerid@odata.bind":`/systemusers(${agent.userId})`};
}
