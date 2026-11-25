// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
beforeAll(() => {
  vi.stubGlobal('location', new URL('https://rating.vertafore.com/UserInterface/Main/clientEdit.aspx'));
  HTMLElement.prototype.getBoundingClientRect = function () { return { x:0,y:0,left:0,top:0,right:100,bottom:20,width:100,height:20,toJSON(){} } as DOMRect; };
  Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()] as unknown as DOMRectList; };
  vi.stubGlobal('CSS',{escape:(s:string)=>s.replace(/([^\w-])/g,'\\$1')});
  for (const file of ['mapping-targets.js','portal-mapper.js','portal-ingest.js','portal-fill.js']) new Function(readFileSync(`public/portal/${file}`,'utf8'))();
});
it('captures distinct source labels and scoped notes instead of the grid first caption', () => {
  document.body.innerHTML = `<div><label>Date of Birth / Age</label>
    <input id="DriverCtlBody_1_rdiDateOfBirth" name="DriverCtlBody_1$rdiDateOfBirth" value="03/11/1972">
    <input id="DriverCtlBody_1_datAge" name="DriverCtlBody_1$datAge" value="54">
    <select id="DriverCtlBody_1_cmbSex" name="DriverCtlBody_1$cmbSex"><option>Female</option></select>
    <input type="checkbox" id="DriverCtlBody_1_chkOperatorExcl" name="DriverCtlBody_1$chkOperatorExcl">
    <input id="DriverCtlBody_1_rniYearsAtOccupation" name="DriverCtlBody_1$rniYearsAtOccupation" value="30"></div>`;
  const result=(globalThis as unknown as {__bettersPortalIngest:(a:unknown,b:unknown)=>{fields:{name:string;label:string;value:string;mapped?:string}[]}}).__bettersPortalIngest([],{
    'text:DriverCtlBody_1$rdiDateOfBirth':'crm:primarycontact.birthdate',
    'text:DriverCtlBody_1$datAge':'skip',
    'select:DriverCtlBody_1$cmbSex':'crm:primarycontact.gendercode',
    'checkbox:DriverCtlBody_1$chkOperatorExcl':'note:contact',
    'text:DriverCtlBody_1$rniYearsAtOccupation':'crm:primarycontact.iacrm_yearsemployed'
  });
  const byName=Object.fromEntries(result.fields.filter(f=>f.name).map(f=>[f.name,f]));
  expect(byName['DriverCtlBody_1$rdiDateOfBirth']?.label).toBe('Date of Birth');
  expect(byName['DriverCtlBody_1$cmbSex']?.label).toBe('Gender');
  expect(byName['DriverCtlBody_1$chkOperatorExcl']).toMatchObject({label:'Excluded Driver',value:'No',mapped:'note:contact'});
  expect(byName['DriverCtlBody_1$rniYearsAtOccupation']?.label).toBe('Years at Occupation');
  expect(byName['DriverCtlBody_1$datAge']).toBeUndefined();
});
it('distinguishes fields inside PL Rater layout containers and identifies secured inputs', () => {
  document.body.innerHTML = `<div><label>Opt Out</label><input id="txtFirstName" name="txtFirstName"><input id="txtLastName" name="txtLastName"><input id="rmiSocialSecurity" name="rmiSocialSecurity"></div>
    <div><label>Cost New Amount</label><input id="AutoCtlBody_1_txtLicensePlate" name="AutoCtlBody_1$txtLicensePlate"><input id="AutoCtlBody_2_rniAnnualMiles" name="AutoCtlBody_2$rniAnnualMiles"></div>`;
  const scan = (globalThis as unknown as {__bettersPortalScan:(a:unknown,b:unknown)=>{key:string;fieldLabel:string}[]}).__bettersPortalScan(null,{});
  const labels=Object.fromEntries(scan.map(f=>[f.key,f.fieldLabel]));
  expect(labels['text:txtFirstName']).toBe('First Name');
  expect(labels['text:txtLastName']).toBe('Last Name');
  expect(labels['text:rmiSocialSecurity']).toBe('Social Security Number');
  expect(labels['text:AutoCtlBody_*$txtLicensePlate']).toBe('License Plate Number');
  expect(labels['text:AutoCtlBody_*$rniAnnualMiles']).toBe('Annual Miles');
});
it('does not advertise table captions as duplicate data inputs on native forms', () => {
  document.body.innerHTML = '<span id="caption">First Name</span><input id="txtFirstName" name="txtFirstName">';
  vi.stubGlobal('__bettersCaptureElements',()=>[document.getElementById('caption')]);
  vi.stubGlobal('__bettersLocalTextLabel',()=> 'First Name');
  const scan=(globalThis as unknown as {__bettersPortalScan:(a:unknown,b:unknown)=>{key:string}[]}).__bettersPortalScan(null,{});
  expect(scan.some(f=>f.key==='text:txtFirstName')).toBe(true);
  expect(scan.some(f=>f.key==='field:first name')).toBe(false);
  vi.stubGlobal('__bettersCaptureElements',()=>[document.getElementById('caption'),document.getElementById('txtFirstName')]);
  const peek=(globalThis as unknown as {__bettersPortalPeekUnmapped:(a:unknown)=>{shown:number}}).__bettersPortalPeekUnmapped({map:{'text:txtFirstName':'contact.firstName'}});
  expect(peek.shown).toBe(0);
});
it('scans one collection field and captures/fills every current driver column, including new sparse indices', async () => {
  document.body.innerHTML=[1,3,5,8,11].map((n,i)=>`<div><input name="DriverCtlHeader_${n}$txtFirstName" value="Person${i+1}"><input name="DriverCtlHeader_${n}$txtLastName" value="Example"></div>`).join('');
  const api=globalThis as unknown as {
    __bettersPortalScan:(p:unknown,m:unknown)=>{key:string;mapped:string}[];
    __bettersPortalIngest:(t:unknown,m:unknown)=>{fields:{name:string;value:string;mapped?:string}[]};
    __bettersPortalFill:(p:unknown,o:boolean,a:boolean,m:unknown)=>Promise<unknown>;
  };
  const map={'text:DriverCtlHeader_*$txtFirstName':'crm:contacts[].firstname','text:DriverCtlHeader_*$txtLastName':'crm:contacts[].lastname'};
  const rows=api.__bettersPortalScan(null,map);
  expect(rows.filter(r=>r.key.includes('DriverCtlHeader'))).toHaveLength(2);
  expect(rows.find(r=>r.key==='text:DriverCtlHeader_*$txtFirstName')?.mapped).toBe('crm:contacts[].firstname');
  const capture=api.__bettersPortalIngest([],map).fields.filter(f=>f.name?.endsWith('$txtFirstName'));
  expect(capture.map(f=>f.mapped)).toEqual(['crm:primarycontact.firstname','crm:contact2.firstname','crm:contact3.firstname','crm:contact4.firstname','crm:contact5.firstname']);
  const values=Object.fromEntries(capture.map((f,i)=>[f.mapped!,`Updated${i+1}`]));
  await api.__bettersPortalFill({normalized:{},fields:[],values},true,false,map);
  expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[name$="$txtFirstName"]')).map(el=>el.value)).toEqual(['Updated1','Updated2','Updated3','Updated4','Updated5']);
});
