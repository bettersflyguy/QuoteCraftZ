import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parsePersonName, personNameKey } from "@/util/personName";
import { normalize } from "@/boldpenguin/normalize";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import { identityFromCapture, coApplicantsFromCapture } from "@/crm/appCommit";
import { buildFillValues } from "@/portal/fillValues";
import { toRowTarget, rowTargetOf } from "@/portal/fieldMaps";
import { alignRelatedContacts } from "@/portal/secureFill";
import type { CapturedAppField } from "@/boldpenguin/types";
const require = createRequire(import.meta.url);
const browser = require("../public/portal/person-name.js") as { parsePersonName:typeof parsePersonName };
const f = (value:string, mapped = "contact.latinFullName"):CapturedAppField => ({label:"Name",value,mapped,section:"Lead",group:"",source:"taught"});
const site = {system:"Datalot",url:"https://app.datalot.com/client",title:"Lead"};

describe("person names without an inferred locale", () => {
  const cases = [
    ["Raymond Hendricks", "auto", "Raymond", "Hendricks"],
    ["José Luis García Márquez", "two-surnames", "José Luis", "García Márquez"],
    ["Ana María López Pérez", "two-surnames", "Ana María", "López Pérez"],
    ["Carlos García Márquez", "two-surnames", "Carlos", "García Márquez"],
    ["João Pedro da Silva Santos", "two-surnames", "João Pedro", "da Silva Santos"],
    ["María del Carmen de la Cruz", "auto", "María del Carmen", "de la Cruz"],
    ["Juan Carlos de la Cruz", "auto", "Juan Carlos", "de la Cruz"],
    ["José García y López", "two-surnames", "José", "García y López"],
    ["João Silva e Costa", "two-surnames", "João", "Silva e Costa"],
    ["García Márquez, José Luis", "auto", "José Luis", "García Márquez"],
    ["Dra. Ana María López Pérez", "two-surnames", "Ana María", "López Pérez"],
    ["José Luis García Márquez Jr.", "two-surnames", "José Luis", "García Márquez"],
    ["García Márquez, José Luis, Jr.", "auto", "José Luis", "García Márquez"],
    ["María-José García-López", "auto", "María-José", "García-López"],
    ["Sean O’Neill", "auto", "Sean", "O’Neill"],
    ["Edward La-Valle Parkin", "auto", "Edward", "Parkin"],
    ["Prince", "auto", "Prince", ""],
    ["", "auto", "", ""]
  ] as const;
  it.each(cases)("%s (%s)", (name,format,firstName,lastName) => {
    const parsed = parsePersonName(name, format);
    expect(parsed).toMatchObject({firstName,lastName});
    expect(browser.parsePersonName(name, format)).toEqual(parsed);
  });
  it("retains the original, middle names and suffix, without title casing", () => {
    expect(parsePersonName("  Dr. JOSÉ   A. GARCÍA, Jr. ")).toMatchObject({original:"Dr. JOSÉ A. GARCÍA, Jr.",firstName:"JOSÉ",middleName:"A.",lastName:"GARCÍA",suffix:"Jr.",needsReview:true});
    expect(parsePersonName("Ana María López").needsReview).toBe(true);
    expect(parsePersonName("José & María García")).toMatchObject({firstName:"",lastName:"",needsReview:true});
  });
  it("folds accents only for comparison and retains Unicode letters", () => {
    expect(personNameKey("José Muñoz")).toBe(personNameKey("Jose Munoz"));
    expect(personNameKey("José Muñoz")).not.toBe(personNameKey("Jos Muoz"));
  });
  it("runs the generated browser parser without CommonJS or eval", () => {
    const context = vm.createContext({});
    vm.runInContext(readFileSync(new URL("../public/portal/person-name.js", import.meta.url),"utf8"), context);
    expect(vm.runInContext('BettersPersonNames.parsePersonName("José Luis García Márquez", "two-surnames").lastName', context)).toBe("García Márquez");
  });
});

describe("one full-name mapping across capture and output", () => {
  it("splits an explicitly mapped Datalot name for CRM and reverse fill", () => {
    const { app } = mergeIngestedFields(null, [f("José Luis García Márquez")], site);
    expect(identityFromCapture(app)).toMatchObject({firstName:"José Luis",lastName:"García Márquez"});
    expect(app.normalized.contact?.fullName).toBe("José Luis García Márquez");
    expect(buildFillValues(app)).toMatchObject({"contact.firstName":"José Luis","contact.lastName":"García Márquez","crm:primarycontact.firstname":"José Luis"});
    const fromCrm = {...app,normalized:{contact:{firstName:"José Luis",lastName:"García Márquez"}}};
    expect(buildFillValues(fromCrm)["contact.latinFullName"]).toBe("José Luis García Márquez");
    const columnsOnly = {...app,normalized:{"crm:primarycontact":{firstname:"José Luis",lastname:"García Márquez"},"crm:contact2":{firstname:"Ana María",lastname:"López Pérez"}}};
    expect(buildFillValues(columnsOnly)).toMatchObject({"contact.latinFullName":"José Luis García Márquez","contact2.latinFullName":"Ana María López Pérez"});
    const mapper = require("../public/portal/portal-mapper.js") as {buildCandidates(p:unknown):unknown[];matchField(label:string,c:unknown[]):{value:string}|null};
    const candidates = mapper.buildCandidates(app);
    expect(mapper.matchField("First Name", candidates)?.value).toBe("José Luis");
    expect(mapper.matchField("Last Name", candidates)?.value).toBe("García Márquez");
  });
  it("keeps explicit structured names and supports every related-contact row", () => {
    const n = normalize([f("José Luis García Márquez"), f("Pepe", "contact.firstName"), f("García Márquez", "contact.lastName")]);
    expect(n.contact).toMatchObject({firstName:"Pepe",lastName:"García Márquez"});
    const {app}=mergeIngestedFields(null,[f("Raymond Hendricks","contact.fullName"),f("Ana María López Pérez","contact2.latinFullName")],site);
    expect(coApplicantsFromCapture(app)[0]).toMatchObject({firstName:"Ana María",lastName:"López Pérez"});
    expect(toRowTarget("contacts[].latinFullName",2)).toBe("contact3.latinFullName");
    expect(rowTargetOf("contact3.latinFullName")).toEqual({arrayPath:"contacts[].latinFullName",row:2});
  });
  it("matches accented names across sources without creating a duplicate person", () => {
    const held=mergeIngestedFields(null,[f("José Luis García Márquez"),f("Ana María López Pérez","contact2.latinFullName")],site).app;
    const next=mergeIngestedFields(held,[f("Jose Luis Garcia Marquez"),f("Ana Maria Lopez Perez","contact3.latinFullName")],site);
    expect(next.replaced).toBe(false);
    expect(next.slotMap?.get(3)).toBe(2);
    expect(alignRelatedContacts([{id:"p",firstName:"Ana Maria",lastName:"Lopez Perez"}],{2:{firstName:"Ana María",lastName:"López Pérez"}})).toEqual(["p"]);
  });
});
