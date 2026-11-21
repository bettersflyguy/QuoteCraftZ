import { useState, type ComponentProps, type ReactNode } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { AddRegular, DeleteRegular, StarFilled, StarRegular } from "@fluentui/react-icons";
import { TargetPicker } from "./TargetPicker";
import { mappingTargets, packMappingTargets, MAX_MAPPING_TARGETS } from "@/portal/mappingTargets";

type Props = Omit<ComponentProps<typeof TargetPicker>, "currentText"> & {
  currentText?: (target:string)=>string|undefined;
  allowAdd?: boolean;
  extra?: (target:string,change:(target:string)=>void)=>ReactNode;
  pickerTarget?: (target:string)=>string;
};
export function MultiTargetPicker({value,onChange,groups,specials,currentText,allowAdd=true,extra,pickerTarget=t=>t,...rest}:Props) {
  const [adding,setAdding]=useState(false);
  const targets=mappingTargets(value);
  const listed=targets.length ? targets : [""];
  const change=(index:number,next:string)=>{
    if (next === "skip" || next.startsWith("secure:")) { onChange(next); setAdding(false); return; }
    const updated=[...targets]; updated[index]=next;
    onChange(packMappingTargets(updated)); setAdding(false);
  };
  return <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:4}}>
    {[...listed,...(adding ? [""] : [])].map((target,index)=><div key={index} style={{display:"flex",gap:3,alignItems:"start"}}>
      <TargetPicker {...rest} value={pickerTarget(target)} onChange={next=>change(index,next)}
        defaultOpen={adding && index === listed.length}
        groups={groups.map(g=>({...g,paths:g.paths.filter(p=>p.path===target || !targets.includes(p.path))}))}
        specials={index > 0 ? specials.filter(s=>s.value !== "skip" && !targets.includes(s.value)) : specials}
        currentText={currentText?.(target)} />
      {extra?.(target,next=>change(index,next))}
      {target && targets.length > 1 && <>
        <Tooltip content={index === 0 ? "Preferred fill source" : "Use this target as the preferred fill source"} relationship="label">
          <Button size="small" appearance="subtle" icon={index===0 ? <StarFilled/> : <StarRegular/>}
            aria-label={index===0 ? "Preferred fill source" : "Use as preferred fill source"} aria-pressed={index===0}
            onClick={()=>onChange(packMappingTargets([target,...targets.filter(t=>t!==target)]))}/>
        </Tooltip>
        <Button size="small" appearance="subtle" icon={<DeleteRegular/>} aria-label="Remove target"
          onClick={()=>onChange(packMappingTargets(targets.filter((_,i)=>i!==index)))}/>
      </>}
    </div>)}
    {allowAdd && targets.length > 0 && targets[0] !== "skip" && !targets.some(t=>t.startsWith("secure:")) && targets.length < MAX_MAPPING_TARGETS && !adding &&
      <Button size="small" appearance="subtle" icon={<AddRegular/>} style={{alignSelf:"start"}} onClick={()=>setAdding(true)}>Add target</Button>}
    {adding && <Button size="small" appearance="subtle" style={{alignSelf:"start"}} onClick={()=>setAdding(false)}>Cancel added target</Button>}
  </div>;
}
