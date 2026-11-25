import {expect,it} from 'vitest';
import {captureTables,securedCaptureTable} from '@/panel/captureTables';
import type {CapturedAppField} from '@/boldpenguin/types';
const field=(label:string,value:string,mapped?:string):CapturedAppField=>({label,value,mapped,section:'PL Rater',group:'',source:'control'});
it('places each contact on one row beneath shared field headers',()=>{
  const fields=[field('First Name','Tracey','crm:primarycontact.firstname'),field('Last Name','Dittrich','crm:primarycontact.lastname'),field('Gender','Female','crm:primarycontact.gendercode'),field('First Name','Alexander','crm:contact2.firstname'),field('Last Name','Dittrich','crm:contact2.lastname'),field('Gender','Male','crm:contact2.gendercode')];
  const before=JSON.stringify(fields);
  const table=captureTables(fields)[0]!;
  expect(table.title).toBe('Contacts');
  expect(table.columns).toEqual(expect.arrayContaining(['First name','Last name','Gender']));
  expect(table.rows).toHaveLength(2);
  expect(table.rows[0]).toMatchObject({'First name':'Tracey','Last name':'Dittrich',Gender:'Female'});
  expect(table.rows[1]).toMatchObject({'First name':'Alexander',Gender:'Male'});
  expect(JSON.stringify(fields)).toBe(before);
});
it('pivots a scoped note without losing different answers for one field',()=>{
  const table=captureTables([field('Industry','Nurse','note:contact'),field('License Status','Valid','note:contact'),field('Industry','Pilot','note:contact')])[0]!;
  expect(table.columns).toEqual(['Industry','License Status']);
  expect(table.rows).toEqual([{Industry:'Nurse / Pilot','License Status':'Valid'}]);
});
it('groups secured masks by record with identifier names as headers',()=>{
  const table=securedCaptureTable([{path:'secure:contact2.iacrm_driverslicense',label:'Secured: Related contact 1: Drivers License',masked:'•••• 1234'},{path:'secure:primarycontact.iacrm_driverslicense',label:'Secured: Primary contact: Drivers License',masked:'•••• 5678'}]);
  expect(table.columns).toEqual(['Record','Drivers License']);
  expect(table.rows).toEqual([{Record:'Primary contact','Drivers License':'•••• 5678'},{Record:'Related contact 1','Drivers License':'•••• 1234'}]);
});
