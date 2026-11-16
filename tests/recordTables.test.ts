/** ADO 3714: one record is one row, however many pages or sources it was read
 * from. The Intake grid, the Excel export and the timeline note share these
 * merge rules (src/boldpenguin/recordTables.ts). */
import { describe, it, expect } from "vitest";
import { recordTables, UNMATCHED_TITLE } from "@/boldpenguin/recordTables";
import { normalize } from "@/boldpenguin/normalize";
import { captureSheets } from "@/panel/captureSheets";
import { buildTimelineNote, coApplicantsFromCapture } from "@/crm/appCommit";
import type { CapturedAppField, CapturedApplication } from "@/boldpenguin/types";

const f = (section: string, group: string, label: string, value: string, mapped?: string, source: CapturedAppField["source"] = "taught"): CapturedAppField =>
  ({ section, group, label, value, source, ...(mapped ? { mapped } : {}) });

/** What the EZLynx data service holds for a person (section "Contacts"). */
const dataService = (row: number, slot: number, first: string, last: string, dob: string): CapturedAppField[] => {
  const to = (col: string) => (slot === 1 ? `contact.${col}` : `contact${slot}.${col}`);
  return [
    f("Contacts", `Row ${row}`, "First name", first, to("firstName"), "dataservice"),
    f("Contacts", `Row ${row}`, "Last name", last, to("lastName"), "dataservice"),
    f("Contacts", `Row ${row}`, "Date of birth", dob, to("dateOfBirth"), "dataservice")
  ];
};
/** What the page read from the Drivers step (labels the page uses, CRM columns taught). */
const driversPage = (row: number, slot: number, first: string, last: string, dob: string): CapturedAppField[] => {
  const to = (col: string) => (slot === 1 ? `crm:primarycontact.${col}` : `crm:contact${slot}.${col}`);
  return [
    f("Auto: Drivers", `Row ${row}`, "First Name", first, to("firstname")),
    f("Auto: Drivers", `Row ${row}`, "Last Name", last, to("lastname")),
    f("Auto: Drivers", `Row ${row}`, "DOB", dob, to("birthdate"))
  ];
};

const table = (fields: CapturedAppField[], title: string) => recordTables(fields).find(t => t.title === title)!;

describe("a person read from two places is one row", () => {
  const fields = [
    ...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...dataService(2, 2, "Alexander", "Dittrich", "06/02/2005"),
    ...driversPage(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...driversPage(2, 2, "Alexander", "Dittrich", "06/02/2005")
  ];

  it("the second driver's name and date of birth sit on one row with the first's columns", () => {
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Contacts"]);
    const t = tables[0]!;
    expect(t.columns).toEqual(["Primary", "First name", "Last name", "Date of birth"]);
    expect(t.rows).toEqual([
      { Primary: "Yes", "First name": "Tracy", "Last name": "Dittrich", "Date of birth": "03-11-1972" },
      { Primary: "", "First name": "Alexander", "Last name": "Dittrich", "Date of birth": "06-02-2005" }
    ]);
  });

  it("three drivers: three rows, no second set of columns", () => {
    const three = [...fields, ...dataService(3, 3, "Morgan", "Dittrich", "09/09/2007"), ...driversPage(3, 3, "Morgan", "Dittrich", "09/09/2007")];
    const t = table(three, "Contacts");
    expect(t.columns).toEqual(["Primary", "First name", "Last name", "Date of birth"]);
    expect(t.rows.map(r => r["First name"])).toEqual(["Tracy", "Alexander", "Morgan"]);
    expect(t.rows.map(r => r["Date of birth"])).toEqual(["03-11-1972", "06-02-2005", "09-09-2007"]);
  });

  it("a page that only gave the second driver's date of birth fills that driver, not the first", () => {
    const partial = [...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...dataService(2, 2, "Alexander", "Dittrich", ""),
      f("Auto: Drivers", "Row 2", "DOB", "06/02/2005", "crm:contact2.birthdate")];
    const t = table(partial, "Contacts");
    expect(t.rows.map(r => [r["First name"], r["Date of birth"]])).toEqual([["Tracy", "03-11-1972"], ["Alexander", "06-02-2005"]]);
  });
});

describe("two drivers, two vehicles, two addresses", () => {
  const fields = [
    ...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...driversPage(2, 2, "Alexander", "Dittrich", "06/02/2005"),
    f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), f("Vehicles", "Row 1", "Year", "2019", "vehicle1.year"),
    f("Vehicles", "Row 2", "Make", "Honda", "vehicle2.make"), f("Vehicles", "Row 2", "Year", "2021", "vehicle2.year"),
    f("Auto: Vehicles", "Row 1", "Purchase Date", "2020-05-14", "crm:vehicle1.iacrm_acquireddate"),
    f("Auto: Vehicles", "Row 2", "Purchase Date", "2021-08-01", "crm:vehicle2.iacrm_acquireddate"),
    f("Addresses", "Row 1", "Street", "7901 120th Ave N", "crm:address1.line1"), f("Addresses", "Row 1", "City", "Champlin", "crm:address1.city"),
    f("Addresses", "Row 2", "Street", "18833 96th Ave N", "crm:address2.line1"), f("Addresses", "Row 2", "City", "Maple Grove", "crm:address2.city"),
    f("Auto: Addresses", "Row 2", "City", "Maple Grove", "crm:address2.city")
  ];

  it("the vehicle purchase date joins its make on the same row", () => {
    const t = table(fields, "Vehicles");
    expect(t.columns).toEqual(["Make", "Year", "Purchase date"]);
    expect(t.rows).toEqual([
      { Make: "Ford", Year: "2019", "Purchase date": "05-14-2020" },
      { Make: "Honda", Year: "2021", "Purchase date": "08-01-2021" }
    ]);
  });

  it("leaves one table per kind of record and no fragment blocks", () => {
    expect(recordTables(fields).map(t => t.title)).toEqual(["Contacts", "Vehicles", "Addresses"]);
    expect(table(fields, "Addresses").rows).toEqual([
      { Primary: "Yes", Street: "7901 120th Ave N", City: "Champlin" },
      { Primary: "", Street: "18833 96th Ave N", City: "Maple Grove" }
    ]);
  });
});

describe("a fragment with no record is shown as unmatched", () => {
  it("a purchase date for a vehicle nothing else describes is not put on another vehicle's row", () => {
    const fields = [
      f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), f("Vehicles", "Row 1", "Year", "2019", "vehicle1.year"),
      f("Auto: Vehicles", "Row 3", "Purchase Date", "2022-01-02", "crm:vehicle3.iacrm_acquireddate")
    ];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Vehicles", UNMATCHED_TITLE]);
    expect(tables[0]!.rows).toEqual([{ Make: "Ford", Year: "2019" }]);
    expect(tables[1]!.rows).toEqual([{ Record: "Vehicle 3", Field: "Purchase Date", Value: "01-02-2022", "Read under": "Auto: Vehicles" }]);
  });

  it("a date of birth with no name is unmatched, never the primary's", () => {
    const fields = [...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), f("Auto: Drivers", "Row 2", "DOB", "06/02/2005", "crm:contact2.birthdate")];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Contacts", UNMATCHED_TITLE]);
    expect(tables[0]!.rows).toHaveLength(1);
    expect(tables[1]!.rows[0]).toMatchObject({ Record: "Contact 2", Field: "DOB" });
  });
});

describe("the same record under two slots", () => {
  it("one VIN read as vehicle 1 by one page and vehicle 2 by another is one row", () => {
    const fields = [
      f("Vehicles", "Row 1", "VIN", "1FTEW1EP5KFA00001", "vehicle1.vin"), f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"),
      f("Auto: Vehicles", "Row 1", "VIN", "1FTEW1EP5KFA00001", "crm:vehicle2.iacrm_vin"),
      f("Auto: Vehicles", "Row 1", "Purchase Date", "2020-05-14", "crm:vehicle2.iacrm_acquireddate")
    ];
    const t = table(fields, "Vehicles");
    expect(t.rows).toEqual([{ VIN: "1FTEW1EP5KFA00001", Make: "Ford", "Purchase date": "05-14-2020" }]);
  });

  it("different VINs are never merged, even when the make matches", () => {
    const fields = [
      f("Vehicles", "Row 1", "VIN", "AAA", "vehicle1.vin"), f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"),
      f("Vehicles", "Row 2", "VIN", "BBB", "vehicle2.vin"), f("Vehicles", "Row 2", "Make", "Ford", "vehicle2.make")
    ];
    expect(table(fields, "Vehicles").rows.map(r => r["VIN"])).toEqual(["AAA", "BBB"]);
  });

  it("the same person under two slots with different dates of birth stays two people", () => {
    const fields = [...dataService(1, 2, "Alex", "Dittrich", "03/11/1972"), ...driversPage(1, 3, "Alex", "Dittrich", "06/02/2005")];
    expect(table(fields, "Contacts").rows).toHaveLength(2);
  });

  it("a value two sources disagree on shows both, not one silently", () => {
    const fields = [f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), f("Auto: Vehicles", "Row 1", "Make", "Fort", "crm:vehicle1.iacrm_make"),
      f("Vehicles", "Row 1", "Year", "2019", "vehicle1.year")];
    expect(table(fields, "Vehicles").rows).toEqual([{ Make: "Ford / Fort", Year: "2019" }]);
  });
});

describe("fields without a record slot lose nothing", () => {
  it("the columns beside a mapped record's fields are that record's columns", () => {
    const fields = [...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), f("Contacts", "Row 1", "Relationship", "Self", undefined, "dataservice")];
    const t = table(fields, "Contacts");
    expect(t.rows).toEqual([{ Primary: "Yes", "First name": "Tracy", "Last name": "Dittrich", "Date of birth": "03-11-1972", Relationship: "Self" }]);
  });

  it("an unmapped table keeps its own section, merging only labels that differ in case or punctuation", () => {
    const fields = [f("Prior Policies", "Row 1", "Carrier", "Acme"), f("Prior Policies", "Row 1", "Policy #", "1"),
      f("Prior Policies", "Row 2", "carrier", "Zed"), f("Prior Policies", "Row 2", "Policy #", "2"), f("Other", "Row 1", "Carrier", "Q")];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Prior Policies", "Other"]);
    expect(tables[0]!.columns).toEqual(["Carrier", "Policy #"]);
    expect(tables[0]!.rows).toEqual([{ Carrier: "Acme", "Policy #": "1" }, { Carrier: "Zed", "Policy #": "2" }]);
  });

  it("the four accident amounts stay four columns and are never totalled", () => {
    const row = (g: string, amounts: number[]) => ["BI Amount", "Collision Amount", "MP Amount", "Other Amount"]
      .map((label, i) => f("Auto: Accidents", g, label, String(amounts[i]), undefined, "table"));
    const t = table([...row("Row 1", [1000, 2000, 300, 40]), ...row("Row 2", [5, 6, 7, 8])], "Auto: Accidents");
    expect(t.columns).toEqual(["BI Amount", "Collision Amount", "MP Amount", "Other Amount"]);
    expect(t.rows).toEqual([
      { "BI Amount": "1000", "Collision Amount": "2000", "MP Amount": "300", "Other Amount": "40" },
      { "BI Amount": "5", "Collision Amount": "6", "MP Amount": "7", "Other Amount": "8" }
    ]);
  });
});

describe("a list that only points at a record stays its own table (review of 83270cd)", () => {
  const accident = (g: string, driver: string, amounts: number[]) => [
    f("Auto: Accidents", g, "Driver", driver, "crm:contact2.fullname"),
    ...["BI Amount", "Collision Amount", "MP Amount", "Other Amount"].map((label, i) => f("Auto: Accidents", g, label, String(amounts[i]), undefined, "table"))
  ];

  it("two accidents for one driver keep their own rows and every amount, even when an amount repeats", () => {
    const fields = [...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...dataService(2, 2, "Alexander", "Dittrich", "06/02/2005"),
      ...accident("Row 1", "Alexander Dittrich", [1000, 2000, 300, 40]), ...accident("Row 2", "Alexander Dittrich", [1000, 500, 300, 10])];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Contacts", "Auto: Accidents"]);
    expect(table(fields, "Contacts").columns).toEqual(["Primary", "First name", "Last name", "Date of birth"]);
    const acc = table(fields, "Auto: Accidents");
    expect(acc.columns).toEqual(["Driver", "BI Amount", "Collision Amount", "MP Amount", "Other Amount"]);
    expect(acc.rows).toEqual([
      { Driver: "Alexander Dittrich", "BI Amount": "1000", "Collision Amount": "2000", "MP Amount": "300", "Other Amount": "40" },
      { Driver: "Alexander Dittrich", "BI Amount": "1000", "Collision Amount": "500", "MP Amount": "300", "Other Amount": "10" }
    ]);
  });

  it("a single accident is not folded into the driver either", () => {
    const fields = [...dataService(2, 2, "Alexander", "Dittrich", "06/02/2005"), ...accident("Row 1", "Alexander Dittrich", [1000, 2000, 300, 40])];
    expect(recordTables(fields).map(t => t.title)).toEqual(["Contacts", "Auto: Accidents"]);
  });

  it("the unmatched table lists a fragment read twice once", () => {
    const frag = f("Auto: Vehicles", "Row 3", "Purchase Date", "2022-01-02", "crm:vehicle3.iacrm_acquireddate");
    const tables = recordTables([f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), frag, { ...frag }]);
    expect(tables.find(t => t.title === UNMATCHED_TITLE)!.rows).toHaveLength(1);
  });

  it("labels that differ by a symbol that means something stay two columns", () => {
    const fields = [f("Prior Policies", "Row 1", "Policy", "Auto"), f("Prior Policies", "Row 1", "Policy #", "123")];
    expect(table(fields, "Prior Policies").rows).toEqual([{ Policy: "Auto", "Policy #": "123" }]);
  });

  it("a source column named Primary never overwrites the Primary flag", () => {
    const fields = [...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), f("Contacts", "Row 1", "Primary", "No", undefined, "dataservice")];
    expect(table(fields, "Contacts").rows[0]).toMatchObject({ Primary: "Yes", "Primary (primary)": "No" });
  });
});

describe("a list that points at records is its own table whatever it is called (review of 602ef42)", () => {
  const entry = (section: string, g: string, slot: number, driver: string, amount: string, source: CapturedAppField["source"] = "taught") => [
    f(section, g, "Driver", driver, `crm:contact${slot}.fullname`, source), f(section, g, "BI Amount", amount, undefined, "table")
  ];
  const people = [...dataService(1, 2, "Tracy", "D", "03/11/1972"), ...dataService(2, 3, "Alex", "D", "06/02/2005")];

  it.each(["Auto: Tickets", "Auto: Driver Violations", "Driver Incidents", "Auto: Driver Tickets", "Driver Suspensions"])("%s keeps its Driver and its columns, one row per entry", section => {
    const fields = [...people, ...entry(section, "Row 1", 2, "Tracy D", "100"), ...entry(section, "Row 2", 3, "Alex D", "200")];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Contacts", section]);
    expect(table(fields, "Contacts").columns).toEqual(["First name", "Last name", "Date of birth"]);
    expect(table(fields, section).rows).toEqual([{ Driver: "Tracy D", "BI Amount": "100" }, { Driver: "Alex D", "BI Amount": "200" }]);
  });

  it.each(["Drivers (current)", "Drivers (2)", "Drivers:", "Auto: Drivers 2", "Auto: Drivers "])("%s is still the contacts' own list: an unmapped column joins each driver", section => {
    const rows = (g: string, slot: number, first: string) => [
      f(section, g, "First Name", first, `crm:contact${slot}.firstname`), f(section, g, "Occupation", "Teacher", undefined, "table")
    ];
    const fields = [...rows("Row 1", 2, "Tracy"), ...rows("Row 2", 3, "Alex")];
    const tables = recordTables(fields);
    expect(tables.map(t => t.title)).toEqual(["Contacts"]);
    expect(tables[0]!.rows).toEqual([{ "First name": "Tracy", Occupation: "Teacher" }, { "First name": "Alex", Occupation: "Teacher" }]);
  });

  it("Driver Suspensions (current) is a child list", () => {
    const fields = [...people, ...entry("Driver Suspensions (current)", "Row 1", 2, "Tracy D", "1"), ...entry("Driver Suspensions (current)", "Row 2", 3, "Alex D", "2")];
    expect(recordTables(fields).map(t => t.title)).toEqual(["Contacts", "Driver Suspensions (current)"]);
  });

  it("a very long title is matched in linear time", () => {
    const title = "Drivers" + " (a)".repeat(5000) + "x";
    const start = Date.now();
    recordTables([f(title, "Row 1", "First Name", "Tracy", "crm:contact2.firstname")]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("a Prior Address list still merges into Addresses, in the same column for every address", () => {
    const fields = [
      f("Addresses", "Row 1", "Street", "1 Main", "crm:address1.line1"),
      f("Prior Address", "Row 1", "Street", "9 Lake", "crm:address2.line1")
    ];
    const t = table(fields, "Addresses");
    expect(t.columns).toEqual(["Primary", "Street"]);
    expect(t.rows).toEqual([{ Primary: "Yes", Street: "1 Main" }, { Primary: "", Street: "9 Lake" }]);
  });

  it("a data-service list of accidents never folds into Contacts", () => {
    const fields = [...dataService(1, 1, "Tracy", "D", "03/11/1972"), ...dataService(2, 2, "Alex", "D", "06/02/2005"),
      ...entry("Accidents", "Row 1", 1, "Tracy D", "5", "dataservice"), ...entry("Accidents", "Row 2", 2, "Alex D", "6", "dataservice")];
    expect(recordTables(fields).map(t => t.title)).toEqual(["Contacts", "Accidents"]);
  });

  it("a source column named Primary keeps its heading in a table that has no Primary flag", () => {
    expect(table([f("Prior Policies", "Row 1", "Primary", "Yes")], "Prior Policies").columns).toEqual(["Primary"]);
  });
});

describe("page text cannot break the tables (security review of 83270cd)", () => {
  const odd = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  it.each(odd)("a label of %s is a column like any other, in a record table and a plain one", label => {
    const fields = [f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), f("Vehicles", "Row 1", label, "x1", "vehicle1.vin"),
      f("Other", "Row 1", label, "x2")];
    const tables = recordTables(fields);
    for (const t of tables) for (const r of t.rows) for (const c of t.columns) expect(typeof r[c]).toBe("string");
    expect(Object.getPrototypeOf(tables[0]!.rows[0]!)).toBe(Object.prototype);
    expect(tables.find(t => t.title === "Other")!.rows[0]![tables.find(t => t.title === "Other")!.columns[0]!]).toBe("x2");
  });

  it("the timeline note and the workbook still build with such labels", () => {
    const fields = odd.map((label, i) => f("Grid", "Row 1", label, `v${i}`, "note:opportunity"));
    const app = { fields, normalized: {}, capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;
    const html = buildTimelineNote(app, "opportunity")!.html;
    for (const label of odd) expect(html).toContain(`<th>${label}</th>`);
    expect(captureSheets(app).some(s => s.name.includes("Grid"))).toBe(true);
  });

  it("two vehicles of one table with the same year, make and model are two rows", () => {
    const row = (g: string, slot: number) => ["Year", "Make", "Model"].map((l, i) => f("Vehicles", g, l, ["2019", "Ford", "F150"][i]!, `vehicle${slot}.${l.toLowerCase()}`));
    expect(table([...row("Row 1", 1), ...row("Row 2", 2)], "Vehicles").rows).toHaveLength(2);
  });

  it("two contacts of one table with the same name are two rows", () => {
    const fields = [...dataService(2, 2, "Alex", "Dittrich", ""), ...dataService(3, 3, "Alex", "Dittrich", "")];
    expect(table(fields, "Contacts").rows).toHaveLength(2);
  });
});

describe("the export and the note use the same rules", () => {
  const fields = [
    ...dataService(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...dataService(2, 2, "Alexander", "Dittrich", "06/02/2005"),
    ...driversPage(1, 1, "Tracy", "Dittrich", "03/11/1972"), ...driversPage(2, 2, "Alexander", "Dittrich", "06/02/2005"),
    f("Vehicles", "Row 1", "Make", "Ford", "vehicle1.make"), f("Auto: Vehicles", "Row 1", "Purchase Date", "2020-05-14", "crm:vehicle1.iacrm_acquireddate")
  ];
  const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;

  it("the workbook has one Contacts sheet and one Vehicles sheet, merged", () => {
    const sheets = captureSheets(app);
    expect(sheets.map(s => s.name)).toEqual(["Summary", "Contacts", "Vehicles"]);
    expect(sheets.find(s => s.name === "Contacts")!.rows).toEqual([
      ["Yes", "Tracy", "Dittrich", "03-11-1972"], ["", "Alexander", "Dittrich", "06-02-2005"]
    ]);
    expect(sheets.find(s => s.name === "Vehicles")!.rows).toEqual([["Ford", "05-14-2020"]]);
  });

  it("a timeline note's list merges columns that differ only in case", () => {
    const noted = [
      f("Contacts", "Row 1", "First Name", "Karen", "note"), f("Contacts", "Row 1", "Relationship", "Spouse", "note"),
      f("Contacts", "Row 2", "first name", "Sam", "note"), f("Contacts", "Row 2", "Relationship", "Child", "note")
    ];
    const n = { fields: noted, normalized: {}, capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;
    const html = buildTimelineNote(n, "account")?.html ?? "";
    expect(html.match(/<th>First name<\/th>/g)).toHaveLength(1);
    expect(html).toContain("<td>Karen</td>");
    expect(html).toContain("<td>Sam</td>");
    expect(html).not.toContain("<th>first name</th>");
  });
});

describe("the CRM load gives each contact its own name and date of birth", () => {
  const people = [["Tracy", "Dittrich", "03/11/1972"], ["Alexander", "Dittrich", "06/02/2005"], ["Morgan", "Dittrich", "09/09/2007"]] as const;
  const app = (count: number) => {
    const fields = people.slice(0, count).flatMap(([a, b, c], i) => [...dataService(i + 1, i + 1, a, b, c), ...driversPage(i + 1, i + 1, a, b, c)]);
    return { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx", title: "" } } as unknown as CapturedApplication;
  };

  it.each([2, 3])("with %i drivers", count => {
    const related = coApplicantsFromCapture(app(count));
    expect(related.map(c => [c.slot, c.firstName, c.dateOfBirth])).toEqual(
      people.slice(1, count).map(([first, , dob], i) => [i + 2, first, `${dob.slice(6)}-${dob.slice(0, 2)}-${dob.slice(3, 5)}`])
    );
  });
});
