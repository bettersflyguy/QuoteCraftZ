import {it,expect} from "vitest";
import {captureDisplayFields} from "@/panel/captureDisplay";
import type {CapturedAppField} from "@/boldpenguin/types";
it("shows a source value once while retaining the original per-target facts",()=>{
 const source={label:"Home Number",value:"2175550148",section:"",group:"",source:"taught" as const};
 const fields=[{...source,mapped:"contact.phone"},{...source,mapped:"crm:account.telephone1"}];
 expect(captureDisplayFields(fields)).toHaveLength(1);expect(fields).toHaveLength(2);
 expect(captureDisplayFields([...fields,{...source,value:"7085550193"},{...source,group:"Other person"}])).toHaveLength(3);
});
it("does not collapse equal values belonging to different people or grid rows",()=>{
 const field:CapturedAppField={label:"Name",value:"Alex Smith",section:"Contacts",group:"Row 1",source:"taught",mapped:"contact2.fullName"};
 expect(captureDisplayFields([field,{...field,group:"Row 2",mapped:"contact3.fullName"}])).toHaveLength(2);
});
