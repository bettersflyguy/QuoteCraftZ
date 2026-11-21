import type {LeadSelection} from "@/messages";

/** Report the winning frame directly; executeScript waits for every frame's
 * promise, including idle advertising frames and their selection timeouts. */
export function pickLeadFrame(tabId:number):Promise<LeadSelection|"timeout"|null> {
  const token=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(value:LeadSelection|"timeout"|null,error?:unknown)=>{
      if(settled)return;
      settled=true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      // Cancel listeners in idle frames. cancel() preserves the chosen boundary.
      void chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>{
        (globalThis as {__bettersLead?:{cancel():void}}).__bettersLead?.cancel();
      }}).catch(()=>{});
      if(error)reject(error);else resolve(value);
    };
    const listener=(msg:unknown,sender:chrome.runtime.MessageSender)=>{
      const m=msg as {type?:string;token?:string;result?:{label:string;key:string}|null};
      if(m.type!=="portal/leadPicked"||m.token!==token||sender.tab?.id!==tabId||sender.frameId===undefined)return false;
      if(m.result===null)finish(null);
      else if(m.result&&typeof m.result.label==="string"&&typeof m.result.key==="string")
        finish({...m.result,frameId:sender.frameId});
      return false;
    };
    const timer=setTimeout(()=>finish("timeout"),22000);
    chrome.runtime.onMessage.addListener(listener);
    void chrome.scripting.executeScript({target:{tabId,allFrames:true},args:[token],func:async(requestToken:string)=>{
      const scope=(globalThis as {__bettersLead?:{pick():Promise<{label:string;key:string}|"timeout"|null>}}).__bettersLead;
      if(!scope)return;
      const result=await scope.pick();
      if(result!=="timeout")await chrome.runtime.sendMessage({type:"portal/leadPicked",token:requestToken,result}).catch(()=>{});
    }}).then(()=>finish("timeout"),error=>finish(null,error));
  });
}
