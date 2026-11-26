import {expect,it} from 'vitest';
import {collectionFieldMap,nativeCollectionKey,resolveCollectionFieldMap} from '@/portal/mappingTargets';
it('keeps driver education on its Contact choice destination without a redundant note target',()=>{
  const map=collectionFieldMap({'select:DriverCtlBody_1$cmbEducationLevel':'targets:["crm:primarycontact.educationcode","note:contact"]','select:DriverCtlBody_2$cmbEducationLevel':'targets:["crm:contact2.educationcode","note:contact2"]'});
  expect(map).toEqual({'select:DriverCtlBody_*$cmbEducationLevel':'crm:contacts[].educationcode'});
  expect(collectionFieldMap(map)).toEqual(map);
});
it('maps current-employer and occupation tenure to their distinct Contact columns',()=>{
  const map=collectionFieldMap({'text:DriverCtlBody_1$rniYearsAtOccupation':'crm:primarycontact.iacrm_yearsemployed','text:DriverCtlBody_1$rniYearsCurrentEmployer':'note:contact'});
  expect(map['text:DriverCtlBody_*$rniYearsAtOccupation']).toBe('targets:["crm:contacts[].iacrm_yearsatoccupation","note:contacts[]"]');
  expect(map['text:DriverCtlBody_*$rniYearsCurrentEmployer']).toBe('crm:contacts[].iacrm_yearsemployed');
  expect(collectionFieldMap(map)).toEqual(map);
});
it('upgrades former vehicle and property note/count mappings to the new typed columns',()=>{
  const map=collectionFieldMap({
    'text:AutoCtlBody_1$txtLicensePlate':'note:vehicle1','checkbox:AutoCtlBody_2$chkFourWheel':'note:vehicle2',
    'select:cmbFoundationType':'targets:["crm:property1.iacrm_foundation","note:property1"]','checkbox:chkHotTub':'note:property1'
  });
  expect(map['text:AutoCtlBody_*$txtLicensePlate']).toBe('targets:["crm:vehicles[].iacrm_licenseplatenumber","note:vehicles[]"]');
  expect(map['checkbox:AutoCtlBody_*$chkFourWheel']).toBe('targets:["crm:vehicles[].iacrm_fourwheeldrive","note:vehicles[]"]');
  expect(map['select:cmbFoundationType']).toBe('targets:["crm:property1.iacrm_foundationconstructiontype","note:property1"]');
  expect(map['checkbox:chkHotTub']).toBe('targets:["crm:property1.iacrm_hottubpresent","note:property1"]');
});
it('migrates numbered mappings to one reusable field while preserving fan-out notes',()=>{
  const result=collectionFieldMap({
    'text:DriverCtlHeader_1$txtFirstName':'crm:primarycontact.firstname',
    'text:DriverCtlHeader_2$txtFirstName':'targets:["crm:contact2.firstname","note:contact2"]',
    'text:txtCurrentCity':'address.city'
  });
  expect(result).toEqual({'text:DriverCtlHeader_*$txtFirstName':'targets:["crm:contacts[].firstname","note:contacts[]"]','text:txtCurrentCity':'address.city'});
  expect(collectionFieldMap(result)).toEqual(result);
});
it('routes added, removed and sparse columns without shifting fields or the primary contact',()=>{
  const keys=[1,3,5,8,11].flatMap(n=>[`text:DriverCtlHeader_${n}$txtFirstName`,...(n===3?[]:[`text:DriverCtlBody_${n}$txtValue`])]);
  const map=resolveCollectionFieldMap({'text:DriverCtlHeader_*$txtFirstName':'crm:contacts[].firstname','text:DriverCtlBody_*$txtValue':'note:contacts[]'},keys);
  expect(map['text:DriverCtlHeader_1$txtFirstName']).toBe('crm:primarycontact.firstname');
  expect(map['text:DriverCtlHeader_3$txtFirstName']).toBe('crm:contact2.firstname');
  expect(map['text:DriverCtlBody_5$txtValue']).toBe('note:contact3');
  expect(map['text:DriverCtlHeader_11$txtFirstName']).toBe('crm:contact5.firstname');
});
it('resolves vehicles independently and keeps secured values in their channel',()=>{
  const keys=['text:DriverCtlHeader_2$txtFirstName','text:DriverCtlBody_2$license','text:DriverCtlBody_9$license','text:AutoCtlHeader_4$txtVIN','text:AutoCtlHeader_12$txtVIN'];
  const result=resolveCollectionFieldMap({'text:DriverCtlBody_*$license':'secure:contacts[].iacrm_driverslicense','text:AutoCtlHeader_*$txtVIN':'vehicles[].vin'},keys);
  expect(result['text:DriverCtlBody_2$license']).toBe('secure:primarycontact.iacrm_driverslicense');
  expect(result['text:DriverCtlBody_9$license']).toBe('secure:contact2.iacrm_driverslicense');
  expect(result['text:AutoCtlHeader_12$txtVIN']).toBe('vehicle2.vin');
});
it('retains an explicit collection choice over legacy instances and ignores unrelated controls',()=>{
  expect(nativeCollectionKey('text:other_1$txtFirstName')).toBeNull();
  expect(collectionFieldMap({'select:DriverCtlBody_1$cmbRelationship':'skip','select:DriverCtlBody_2$cmbRelationship':'crm:contact2.iacrm_driverrelationship'})).toEqual({'select:DriverCtlBody_*$cmbRelationship':'crm:contacts[].iacrm_driverrelationship'});
  expect(collectionFieldMap({'text:AutoCtlHeader_*$txtVIN':'skip','text:AutoCtlHeader_1$txtVIN':'vehicle1.vin'})).toEqual({'text:AutoCtlHeader_*$txtVIN':'skip'});
});
