// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
beforeAll(() => {
  vi.stubGlobal('location', new URL('https://rating.vertafore.com/UserInterface/Main/clientEdit.aspx'));
  HTMLElement.prototype.getBoundingClientRect = function () { return { x:0,y:0,left:0,top:0,right:100,bottom:20,width:100,height:20,toJSON(){} } as DOMRect; };
  Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()] as unknown as DOMRectList; };
  for (const file of ['portal-mapper.js','portal-fill.js']) new Function(readFileSync(`public/portal/${file}`,'utf8'))();
});
it('distinguishes fields inside PL Rater layout containers and identifies secured inputs', () => {
  document.body.innerHTML = `<div><label>Opt Out</label><input id="txtFirstName" name="txtFirstName"><input id="txtLastName" name="txtLastName"><input id="rmiSocialSecurity" name="rmiSocialSecurity"></div>
    <div><label>Cost New Amount</label><input id="AutoCtlBody_1_txtLicensePlate" name="AutoCtlBody_1$txtLicensePlate"><input id="AutoCtlBody_2_rniAnnualMiles" name="AutoCtlBody_2$rniAnnualMiles"></div>`;
  const scan = (globalThis as unknown as {__bettersPortalScan:(a:unknown,b:unknown)=>{key:string;fieldLabel:string}[]}).__bettersPortalScan(null,{});
  const labels=Object.fromEntries(scan.map(f=>[f.key,f.fieldLabel]));
  expect(labels['text:txtFirstName']).toBe('First Name');
  expect(labels['text:txtLastName']).toBe('Last Name');
  expect(labels['text:rmiSocialSecurity']).toBe('Social Security Number');
  expect(labels['text:AutoCtlBody_1$txtLicensePlate']).toBe('License Plate Number');
  expect(labels['text:AutoCtlBody_2$rniAnnualMiles']).toBe('Annual Miles');
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
