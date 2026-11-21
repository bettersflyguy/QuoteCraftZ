import {useState} from "react";
import {Button,Dialog,DialogSurface,DialogBody,DialogTitle,DialogContent,DialogActions} from "@fluentui/react-components";
import {MultiTargetPicker} from "@/panel/MultiTargetPicker";
import {captureGroups} from "@/panel/captureGroups";
import {NOTE_TARGETS,PATH_LABEL,noteLabelOf,isNoteTarget} from "@/portal/fieldMaps";
import {catalogLabel,type FieldCatalog} from "@/crm/fieldCatalog";
import {saveRelationship} from "./relationshipSave";
import type {GraphField,GraphService} from "./mappingGraph";

export function RelationshipEditor({service,field,catalog,onClose}:{service:GraphService;field:GraphField;catalog:FieldCatalog|null;onClose:()=>void}) {
  const [binding,setBinding]=useState(field.binding);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const save=async()=>{
    setBusy(true);setError("");
    try{await saveRelationship(service.id,field,binding);onClose();}
    catch(e){setError((e as Error).message);setBusy(false);}
  };
  return <Dialog open onOpenChange={(_,d)=>{if(!d.open&&!busy)onClose();}}>
    <DialogSurface><DialogBody>
      <DialogTitle>Edit input mapping</DialogTitle>
      <DialogContent>
        <p>{service.name} · {field.label}</p>
        <MultiTargetPicker value={binding} onChange={setBinding} groups={captureGroups(catalog)}
          specials={[{value:"",label:"Not mapped"},...NOTE_TARGETS]}
          currentText={t=>isNoteTarget(t)?noteLabelOf(t):PATH_LABEL.get(t)||catalogLabel(catalog,t)||t}/>
        <p>The first target supplies this field when filling from CRM. Additional targets also receive captured values.</p>
        {error&&<p role="alert">{error}</p>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>Cancel</Button><Button appearance="primary" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save mapping"}</Button></DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
}
