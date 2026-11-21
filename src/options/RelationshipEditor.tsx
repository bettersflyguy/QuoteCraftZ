import {useEffect,useState} from "react";
import {Button} from "@fluentui/react-components";
import {MultiTargetPicker} from "@/panel/MultiTargetPicker";
import {captureGroups} from "@/panel/captureGroups";
import {NOTE_TARGETS,PATH_LABEL,noteLabelOf,isNoteTarget} from "@/portal/fieldMaps";
import {catalogLabel,type FieldCatalog} from "@/crm/fieldCatalog";
import {saveRelationship} from "./relationshipSave";
import type {GraphField,GraphService} from "./mappingGraph";

/** The original mapping picker, embedded in its source row; saves on change. */
export function RelationshipEditor({service,field,catalog}:{service:GraphService;field:GraphField;catalog:FieldCatalog|null}) {
  const [binding,setBinding]=useState(field.binding);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{setBinding(field.binding);},[field.binding]);
  const save=async(next:string)=>{
    setBinding(next);setBusy(true);setError("");
    try{await saveRelationship(service.id,field,next);}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  return <div className="qr-inline-editor">
    <fieldset disabled={busy} aria-label={`Mapping for ${field.label}`}>
      <MultiTargetPicker value={binding} allowAdd={false} onChange={next=>void save(next)} groups={captureGroups(catalog)}
        specials={[{value:"",label:"Not mapped"},...NOTE_TARGETS]}
        currentText={t=>isNoteTarget(t)?noteLabelOf(t):PATH_LABEL.get(t)||catalogLabel(catalog,t)||t}/>
    </fieldset>
    {busy&&<small role="status">Saving…</small>}
    {error&&<div role="alert">{error}<Button size="small" onClick={()=>void save(binding)}>Retry save</Button></div>}
  </div>;
}
