import {useEffect,useRef,useState} from "react";
import {Button,Spinner} from "@fluentui/react-components";
import {PlugConnectedRegular,PlugDisconnectedRegular} from "@fluentui/react-icons";
import {send} from "./api";

export function CrmConnection({onBusy,onNotice}:{onBusy:(busy:boolean)=>void;onNotice:(message:string)=>void}) {
  const [connected,setConnected]=useState(false);
  const [busy,setBusy]=useState(false);
  const [label,setLabel]=useState("Checking CRM connection");
  const connecting=useRef(false);
  useEffect(()=>{
    let disposed=false;
    let version=0;
    const check=()=>{
      const current=++version;
      void send<{environment:string}>({type:"auth/status"})
        .then(r=>{if(!disposed&&current===version&&!connecting.current){setConnected(true);setLabel(`CRM connected · ${r.environment}`);}})
        .catch(()=>{if(!disposed&&current===version&&!connecting.current){setConnected(false);setLabel("Reconnect to CRM");}});
    };
    check();
    const changed=(changes:Record<string,unknown>)=>{
      if(Object.keys(changes).some(k=>k.startsWith("token:")||k.startsWith("env/")))check();
    };
    chrome.storage.onChanged.addListener(changed);
    return()=>{disposed=true;chrome.storage.onChanged.removeListener(changed);};
  },[]);
  const connect=async()=>{
    if(connecting.current)return;
    connecting.current=true;
    setBusy(true);onBusy(true);setLabel("Complete Microsoft sign-in");onNotice("Complete the Microsoft sign-in window to connect CRM.");
    try{
      await send({type:"auth/signIn"});
      const result=await send<{environment:string}>({type:"auth/status"});
      setConnected(true);setLabel(`CRM connected · ${result.environment}`);onNotice("");
    }catch(e){const message=(e as Error).message;setConnected(false);setLabel(message);onNotice(message);}
    finally{connecting.current=false;setBusy(false);onBusy(false);}
  };
  return <Button size="small" appearance="subtle" disabled={busy} title={label} aria-label={label}
    style={{color:connected?"#107c10":"#c4314b",minWidth:28}}
    icon={busy?<Spinner size="tiny"/>:connected?<PlugConnectedRegular/>:<PlugDisconnectedRegular/>}
    onClick={()=>void connect()}/>;
}
