import {useRef,type ReactNode} from "react";
import {clampWidth,clampOffset} from "./relationshipLayout";
export function ResizableLane({id,label,width,offset,onMove,onMoveCommit,onResize,onCommit,children,className=""}:{id:string;label:string;width:number;offset:number;onMove:(id:string,offset:number)=>void;onMoveCommit:(id:string,offset:number)=>void;onResize:(id:string,width:number)=>void;onCommit:(id:string,width:number)=>void;children:ReactNode;className?:string}) {
  const drag=useRef<{x:number;width:number;value:number}|null>(null);
  const moving=useRef<{x:number;offset:number;minimum:number;value:number}|null>(null);
  const lane=useRef<HTMLDivElement>(null);
  const minimum=()=>{const el=lane.current;return el?.parentElement?offset-(el.getBoundingClientRect().left-el.parentElement.getBoundingClientRect().left):0;};
  return <div className={`qr-lane qr-resizable ${className}`} ref={lane} style={{width,left:offset}}>
    <button type="button" className="qr-mover" aria-label={`Move ${label} left or right`} title="Drag to reposition. Arrow keys move this column."
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();moving.current={x:e.clientX,offset,minimum:minimum(),value:offset};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!moving.current)return;const next=Math.max(moving.current.minimum,clampOffset(moving.current.offset+e.clientX-moving.current.x));moving.current.value=next;onMove(id,next);}}
      onPointerUp={e=>{if(!moving.current)return;const next=moving.current.value;moving.current=null;e.currentTarget.releasePointerCapture(e.pointerId);onMoveCommit(id,next);}}
      onPointerCancel={()=>{if(moving.current){onMoveCommit(id,moving.current.value);moving.current=null;}}}
      onKeyDown={e=>{if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft")return;e.preventDefault();onMoveCommit(id,Math.max(minimum(),clampOffset(offset+(e.key==="ArrowRight"?20:-20))));}}>↔ Move</button>
    {children}
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={900} aria-valuenow={width} tabIndex={0} className="qr-resizer" title="Drag to resize. Arrow keys adjust width."
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={x:e.clientX,width,value:width};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!drag.current)return;const next=clampWidth(drag.current.width+e.clientX-drag.current.x);drag.current.value=next;onResize(id,next);}}
      onPointerUp={e=>{if(!drag.current)return;const next=drag.current.value;drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);onCommit(id,next);}}
      onPointerCancel={()=>{if(drag.current){onCommit(id,drag.current.value);drag.current=null;}}}
      onKeyDown={e=>{if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft")return;e.preventDefault();onCommit(id,clampWidth(width+(e.key==="ArrowRight"?20:-20)));}}/>
  </div>;
}
