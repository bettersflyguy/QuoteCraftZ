/** EZLynx's Drivers step: one card per driver ("Primary Insured",
 * "Additional Driver") sharing every label. A list mapping picked on one
 * card's box covers every card on that step; card order is row order, and
 * each row lands on its person by the name on that card. */
import { describe, it, expect } from "vitest";
import { familyKeyOf } from "@/portal/fieldMaps";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import type { CapturedAppField } from "@/boldpenguin/types";

const site = { system: "EZLynx", url: "https://app.ezlynx.com/x", title: "Tracy Dittrich" };

describe("driver cards", () => {
  it("a box repeated on differently titled cards maps every card on that step", () => {
    expect(familyKeyOf({ fieldLabel: "*First Name", section: "primary insured", repeats: 2, repeatSections: ["primary insured", "additional driver"], page: "drivers" }))
      .toEqual({ key: "field:drivers|first name", label: "First Name (every card)" });
    expect(familyKeyOf({ fieldLabel: "First Name", section: "", repeats: 2, repeatSections: ["", ""], page: "drivers" })!.key).toBe("field:drivers|first name");
    // twin address sections of one kind keep their section family
    expect(familyKeyOf({ fieldLabel: "City", section: "other address", repeats: 2, repeatSections: ["primary address", "other address"], page: "details" })!.key)
      .toBe("field:other address>city");
  });

  it("card rows land on the people they name, whatever the card order", () => {
    const held = mergeIngestedFields(null, [
      { label: "First name", value: "Tracy", section: "Contacts", group: "Row 1", source: "control", mapped: "contact.firstName" },
      { label: "Last name", value: "Dittrich", section: "Contacts", group: "Row 1", source: "control", mapped: "contact.lastName" }
    ], site).app;
    const card = (row: number, slot: number, first: string, sr22: string): CapturedAppField[] => [
      { label: "First Name", value: first, section: "Drivers", group: `Row ${row}`, source: "taught", mapped: `crm:contact${slot}.firstname` },
      { label: "Last Name", value: "Dittrich", section: "Drivers", group: `Row ${row}`, source: "taught", mapped: `crm:contact${slot}.lastname` },
      { label: "SR-22 Required", value: sr22, section: "Drivers", group: `Row ${row}`, source: "taught", mapped: `crm:contact${slot}.iacrm_sr22` }
    ];
    const out = mergeIngestedFields(held, [...card(1, 2, "Tracy", "No"), ...card(2, 3, "Alexander", "Yes")], site).app;
    const byPath = Object.fromEntries(out.fields.filter(f => f.mapped?.startsWith("crm:")).map(f => [f.mapped, f.value]));
    expect(byPath["crm:primarycontact.iacrm_sr22"]).toBe("No");
    expect(byPath["crm:primarycontact.firstname"]).toBe("Tracy");
    expect(byPath["crm:contact2.firstname"]).toBe("Alexander");
    expect(byPath["crm:contact2.iacrm_sr22"]).toBe("Yes");
  });
});
