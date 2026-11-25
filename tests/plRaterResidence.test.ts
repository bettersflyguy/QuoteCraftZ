import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {collectionFieldMap} from '@/portal/mappingTargets';
import {getOptionMaps,toCrmChoice} from '@/portal/optionMaps';
import {translateCapturedChoices,translateFillChoices} from '@/portal/choiceRouting';
import {coerce,type FieldCatalog} from '@/crm/fieldCatalog';
const site='https://rating.vertafore.com',column='iacrm_property.iacrm_residencetype';
const choices=[['Single Family Dwelling',298400000,'Dwelling'],['Apartment',298400001,'Apartment'],['Condo',298400002,'Condominium'],['Townhouse',298400003,'Townhouse'],['Rowhouse',298400004,'Rowhouse'],['Co-op',298400005,'Co-op'],['Mobile Home',298400006,'Mobile Home'],['Other',298400007,'Other']] as const;
const options=choices.map(([,value,label])=>({value,label}));
const catalog:FieldCatalog={envId:'test',fetchedAt:0,entities:[{key:'properties',logical:'iacrm_property',set:'iacrm_properties',label:'Properties',array:true,columns:[{name:'iacrm_residencetype',label:'Residence type',type:'Picklist',options}]}]};
afterEach(()=>vi.unstubAllGlobals());
it('maps every observed residence choice to the exact CRM value and back to the source option',()=>{
  const manifest=JSON.parse(readFileSync('public/mappings/quotecraftz-pl-rater.json','utf8'));
  const scope=manifest.options[site];
  expect(manifest.maps[site]['select:cmbResType']).toBe('crm:property1.iacrm_residencetype');
  for(const [source,value,label] of choices){
    expect(scope[column][source]).toBe(value);
    const fields=translateCapturedChoices([{label:'Res Type',value:source,mapped:'crm:property1.iacrm_residencetype',section:'Home',group:'',source:'control'}],scope,catalog);
    expect(fields[0]!.value).toBe(label);
    expect(coerce(catalog.entities[0]!.columns[0]!,fields[0]!.value)).toBe(value);
    expect(translateFillChoices({'crm:property1.iacrm_residencetype':label},{'select:cmbResType':'crm:property1.iacrm_residencetype'},scope,catalog)['crm:property1.iacrm_residencetype']).toBe(source);
  }
  expect(toCrmChoice('<select>',scope[column],options)).toBeNull();
});
it('removes only the residence types redundant note binding from existing saved mappings',()=>{
  const map=collectionFieldMap({'select:cmbResType':'targets:["crm:property1.iacrm_residencetype","note:property1"]','select:cmbOwnership':'note:property1'});
  expect(map).toEqual({'select:cmbResType':'crm:property1.iacrm_residencetype','select:cmbOwnership':'note:property1'});
  expect(collectionFieldMap(map)).toEqual(map);
  expect(collectionFieldMap({'select:cmbResType':'note:contact'})['select:cmbResType']).toBe('note:contact');
});
it('supplies the reviewed residence choices to an installed extension without changing unrelated maps or agent overrides',async()=>{
  const stored={[site]:{[column]:{Condo:298400007}},'https://other.example':{'contact.educationcode':{Example:1}}};
  const before=JSON.stringify(stored);
  vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async()=>({'portal/optionMap':stored}))}}});
  const result=await getOptionMaps();
  expect(result[site]![column]!['Single Family Dwelling']).toBe(298400000);
  expect(result[site]![column]!.Condo).toBe(298400007);
  expect(result['https://other.example']).toEqual(stored['https://other.example']);
  expect(JSON.stringify(stored)).toBe(before);
});
