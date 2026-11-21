import { it, expect } from "vitest";
import { captureGroups } from "@/panel/captureGroups";
import { CATALOG_ENTITIES } from "@/crm/fieldCatalog";

it("offers both name transforms with live CRM metadata in the correct contact groups", () => {
  const groups=captureGroups({envId:"dev",fetchedAt:1,entities:CATALOG_ENTITIES.map(e=>({...e,columns:[]}))});
  expect(groups.find(g=>g.group==="Primary contact")?.paths.map(p=>p.path)).toEqual(["contact.fullName","contact.latinFullName"]);
  expect(groups.find(g=>g.group==="Contacts (all rows)")?.paths.map(p=>p.path)).toEqual(["contacts[].fullName","contacts[].latinFullName"]);
  expect(groups.find(g=>g.group==="Insured (account)")?.paths).toEqual([]);
});
