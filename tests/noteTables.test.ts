import {expect,it} from 'vitest';
import {additionalNoteFields,noteTables} from '@/boldpenguin/noteTables';
import {buildVehicleNote} from '@/crm/appCommit';
import type {CapturedAppField,CapturedApplication} from '@/boldpenguin/types';
const field=(label:string,value:string,mapped:string,section='PL Rater'):CapturedAppField=>({label,value,mapped,section,group:'',source:'control'});
it('does not present an identical mapped Contact value as an unmapped gap',()=>{
  const typed={...field('Gender','Female','crm:primarycontact.gendercode'),name:'DriverCtlBody_1$cmbSex'};
  const copy={...typed,mapped:'note:contact'};
  const different={...field('Gender','Male','note:contact2'),name:'DriverCtlBody_2$cmbSex'};
  const rawChoice={...field('Education',"Bachelor's Degree",'note:contact'),name:'DriverCtlBody_1$cmbEducationLevel'};
  const context=[typed,copy,different,rawChoice,{...rawChoice,mapped:'crm:primarycontact.educationcode',value:'BA / BS'}];
  expect(additionalNoteFields([copy,different,rawChoice],context)).toEqual([different,rawChoice]);
  expect(context).toContain(copy);
});
it('combines vehicles across pages into one table with shared headers and distinct identified rows',()=>{
  const notes=[field('Ownership','Financed','note:vehicle1'),field('Plate','ABC','note:vehicle1','Vehicle details'),field('Ownership','Owned','note:vehicle2'),field('Four Wheel Drive','Yes','note:vehicle3'),field('Plate','XYZ','note:vehicle3')];
  const context=[...notes,field('Year','2020','vehicle1.year'),field('Make','Ford','vehicle1.make'),field('Model','Escape','vehicle1.model')];
  const before=JSON.stringify(context);
  const tables=noteTables(notes,context);
  expect(tables).toHaveLength(1);
  expect(tables[0]!.title).toBe('Vehicles');
  expect(tables[0]!.columns).toEqual(['Record','Ownership','Plate','Four Wheel Drive']);
  expect(tables[0]!.rows).toHaveLength(3);
  expect(tables[0]!.rows[0]).toMatchObject({Record:'Vehicle 1 · 2020 Ford Escape',Ownership:'Financed',Plate:'ABC'});
  expect(tables[0]!.rows[1]).toMatchObject({Record:'Vehicle 2',Ownership:'Owned'});
  expect(tables[0]!.rows[1]!.Plate??'').toBe('');
  expect(tables[0]!.rows[2]).toMatchObject({Record:'Vehicle 3',Plate:'XYZ','Four Wheel Drive':'Yes'});
  expect(JSON.stringify(context)).toBe(before);
});
it('keeps properties and drivers in their own structured tables with a primary contact row',()=>{
  const tables=noteTables([field('Wood stove','No','note:property1'),field('Wood stove','Yes','note:property2'),field('Industry','Nurse','note:contact'),field('Industry','Pilot','note:contact2')]);
  expect(tables.map(t=>t.title)).toEqual(['Properties','Drivers / contacts']);
  expect(tables[0]!.rows).toEqual([{Record:'Property 1','Wood stove':'No'},{Record:'Property 2','Wood stove':'Yes'}]);
  expect(tables[1]!.rows).toEqual([{Record:'Primary contact',Industry:'Nurse'},{Record:'Contact 2',Industry:'Pilot'}]);
});
it('preserves other risk grids and conflicting answers without collapsing their rows',()=>{
  const tables=noteTables([{...field('Hull ID','H1','note:opportunity','Watercraft'),group:'Row 1'},{...field('Hull ID','H2','note:opportunity','Watercraft'),group:'Row 2'},field('Bill type','Direct','note:opportunity','Auto'),field('Bill type','Agency','note:opportunity','Home')]);
  expect(tables.find(t=>t.title==='Watercraft')!.rows).toHaveLength(2);
  expect(tables.find(t=>t.title==='Opportunity')!.rows).toEqual([{'Bill type':'Direct / Agency'}]);
});
it('uses field headers in each CRM vehicle note and preserves its record boundary',()=>{
  const fields=[field('Plate','ABC','note:vehicle1'),field('Four Wheel Drive','Yes','note:vehicle1','Other page'),field('Plate','OTHER','note:vehicle2')];
  const app={fields,source:{system:'PL Rater'},capturedAt:'2026-11-24T00:00:00Z'} as CapturedApplication;
  const note=buildVehicleNote(app,1)!;
  expect(note.html.match(/<table/g)).toHaveLength(1);
  expect(note.html).toContain('<th>Plate</th>');
  expect(note.html).toContain('<th>Four Wheel Drive</th>');
  expect(note.html).toContain('<td>ABC</td>');
  expect(note.html).not.toContain('OTHER');
  expect(note.html).not.toContain('<th>Field</th>');
});
