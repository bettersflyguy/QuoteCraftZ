import {useEffect,useState} from "react";
import {Button,Spinner} from "@fluentui/react-components";
import {PlugConnectedRegular,PlugDisconnectedRegular} from "@fluentui/react-icons";
import {send} from "./api";

export function CrmConnection({onBusy}:{onBusy:(busy:boolean)=>void}) {
  const [connected,setConnected]=useState(false);
  const [busy,setBusy]=useState(false);
  const [label,setLabel]=useState("Checking CRM connection");
  useEffect(()=>{
    let disposed=false;
    const check=()=>void send<{environment:string}>({type:"auth/status"})
      .then(r=>{if(!disposed){setConnected(true);setLabel(`CRM connected · ${r.environment}`);}})
      .catch(()=>{if(!disposed){setConnected(false);setLabel("Reconnect to CRM");}});
    check();
    const changed=(changes:Record<string,unknown>)=>{
      if(Object.keys(changes).some(k=>k.startsWith("token:")||k.startsWith("env/")))check();
    };
    chrome.storage.onChanged.addListener(changed);
    return()=>{disposed=true;chrome.storage.onChanged.removeListener(changed);};
  },[]);
  const connect=async()=>{
    setBusy(true);onBusy(true);setLabel("Complete Microsoft sign-in");
    try{
      await send({type:"auth/signIn"});
      const result=await send<{environment:string}>({type:"auth/status"});
      setConnected(true);setLabel(`CRM connected · ${result.environment}`);
    }catch(e){setConnected(false);setLabel((e as Error).message);}
    finally{setBusy(false);onBusy(false);}
  };
  return <Button size="small" appearance="subtle" disabled={busy} title={label} aria-label={label}
    style={{color:connected?"#107c10":"#c4314b",minWidth:28}}
    icon={busy?<Spinner size="tiny"/>:connected?<PlugConnectedRegular/>:<PlugDisconnectedRegular/>}
    onClick={()=>void connect()}/>;
}
