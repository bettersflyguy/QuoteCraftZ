import {beforeEach,it,expect,vi} from "vitest";
import {saveRelationship} from "@/options/relationshipSave";
import {mappingServices} from "@/options/mappingGraph";
import {FIELDMAP_STORAGE_KEY} from "@/portal/fieldMaps";
import {DATA_SERVICE_STORAGE_KEY} from "@/sources/ezlynxSource";
let stored:Record<string,unknown>;
beforeEach(()=>{
  stored={};
  vi.stubGlobal("chrome",{storage:{local:{get:vi.fn(async(key:string)=>({[key]:stored[key]})),set:vi.fn(async(patch:Record<string,unknown>)=>{Object.assign(stored,patch);})}}});
});
it("changes one page binding without losing other screens, sites, or choice maps",async()=>{
  const origin="https://app.datalot.com";
  const maps={[origin]:{"field:name":"contact.fullName","field:car":"vehicles[].vin"},"https://rater.example":{"field:email":"contact.email"}};
  stored[FIELDMAP_STORAGE_KEY]=maps;stored.choices={unchanged:true};
  const field=mappingServices(maps,{})[0]!.fields[0]!;
  await saveRelationship(origin,field,"crm:account.name");
  expect(stored[FIELDMAP_STORAGE_KEY]).toEqual({...maps,[origin]:{...maps[origin],"field:name":"crm:account.name"}});
  expect(stored.choices).toEqual({unchanged:true});
});
it("changes a service field without copying defaults over existing overrides",async()=>{
  const ds={ezlynx:{"person.email":"contacts[].email","custom":"note:properties[]"},other:{value:"contact.email"}};
  stored[DATA_SERVICE_STORAGE_KEY]=ds;
  const field=mappingServices({},ds)[0]!.fields.find(f=>f.key==="person.email")!;
  await saveRelationship("https://app.ezlynx.com",field,"");
  expect(stored[DATA_SERVICE_STORAGE_KEY]).toEqual({...ds,ezlynx:{...ds.ezlynx,"person.email":""}});
});
it("refuses to overwrite a mapping edited elsewhere while its editor was open",async()=>{
  const origin="https://app.datalot.com";
  const field=mappingServices({[origin]:{"field:name":"contact.fullName"}},{})[0]!.fields[0]!;
  stored[FIELDMAP_STORAGE_KEY]={[origin]:{"field:name":"crm:account.name"}};
  await expect(saveRelationship(origin,field,"contact.lastName")).rejects.toThrow("changed elsewhere");
  expect(stored[FIELDMAP_STORAGE_KEY]).toEqual({[origin]:{"field:name":"crm:account.name"}});
});
