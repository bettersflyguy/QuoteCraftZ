import {getAllFieldMaps,setAllFieldMaps} from "@/portal/fieldMaps";
import {getDataServiceMaps,setDataServiceMap,effectiveTargets} from "@/sources/ezlynxSource";
import type {GraphField} from "./mappingGraph";

/** Re-read before changing one binding; retain other screens and targets. */
export async function saveRelationship(origin:string,field:GraphField,binding:string):Promise<void> {
  if(field.source==="ezlynx") {
    const maps=await getDataServiceMaps();
    if(effectiveTargets(maps.ezlynx)[field.key]!==field.binding)throw new Error("This mapping changed elsewhere. Close and reopen it before saving.");
    await setDataServiceMap("ezlynx",{...maps.ezlynx,[field.key]:binding});
  } else {
    const maps=await getAllFieldMaps();
    if(!maps[origin] || maps[origin]![field.key]!==field.binding)throw new Error("This mapping changed elsewhere. Close and reopen it before saving.");
    await setAllFieldMaps({...maps,[origin]:{...maps[origin],[field.key]:binding}});
  }
}
