import {useRef,type ReactNode} from "react";
import {clampWidth} from "./relationshipLayout";
export function ResizableLane({id,label,width,onResize,onCommit,children,className=""}:{id:string;label:string;width:number;onResize:(id:string,width:number)=>void;onCommit:(id:string,width:number)=>void;children:ReactNode;className?:string}) {
  const drag=useRef<{x:number;width:number;value:number}|null>(null);
  return <div className={`qr-lane qr-resizable ${className}`} style={{width}}>
    {children}
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={900} aria-valuenow={width} tabIndex={0} className="qr-resizer" title="Drag to resize. Arrow keys adjust width."
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:e.clientX,width,value:width};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!drag.current)return;const next=clampWidth(drag.current.width+e.clientX-drag.current.x);drag.current.value=next;onResize(id,next);}}
      onPointerUp={e=>{if(!drag.current)return;const next=drag.current.value;drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);onCommit(id,next);}}
      onPointerCancel={()=>{if(drag.current){onCommit(id,drag.current.value);drag.current=null;}}}
      onKeyDown={e=>{if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft")return;e.preventDefault();onCommit(id,clampWidth(width+(e.key==="ArrowRight"?20:-20)));}}/>
  </div>;
}
