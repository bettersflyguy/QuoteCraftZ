/** EZLynx then an AMS contacts list in a different order: people are
 * matched by who they are, the AMS's primary row merges into the primary
 * contact (no duplicate), and license numbers never sit in the capture. */
import { describe, it, expect } from "vitest";
import { mergeIngestedFields } from "@/boldpenguin/ingest";
import { samePerson, slotOf, withSlot } from "@/boldpenguin/people";
import { coApplicantsFromCapture } from "@/crm/appCommit";
import { isCrmTarget, isIdentifierColumn, securedIfIdentifier } from "@/portal/fieldMaps";
import type { CapturedAppField } from "@/boldpenguin/types";

type Raw = Omit<CapturedAppField, "source">;
const src = (fs: Raw[]): CapturedAppField[] => fs.map(f => ({ ...f, source: "control" }));
const ez: CapturedAppField[] = src([
  { label: "First name", value: "Tracy", section: "Contacts", group: "Row 1", mapped: "contact.firstName" },
  { label: "Last name", value: "Dittrich", section: "Contacts", group: "Row 1", mapped: "contact.lastName" },
  { label: "Date of birth", value: "1972-03-11", section: "Contacts", group: "Row 1", mapped: "contact.dateOfBirth" },
  { label: "First name", value: "Alexander", section: "Contacts", group: "Row 2", mapped: "contact2.firstName" },
  { label: "Last name", value: "Dittrich", section: "Contacts", group: "Row 2", mapped: "contact2.lastName" },
  { label: "First name", value: "Elizabeth", section: "Contacts", group: "Row 3", mapped: "contact3.firstName" },
  { label: "Last name", value: "Dittrich", section: "Contacts", group: "Row 3", mapped: "contact3.lastName" }
]);
// NowCerts: alphabetical, the primary (Owner, ticked) second
const ams: CapturedAppField[] = src([
  { label: "First Name", value: "Alaxander", section: "Contacts List", group: "Row 1", mapped: "contact2.firstName" },
  { label: "Last Name", value: "Dittrich", section: "Contacts List", group: "Row 1", mapped: "contact2.lastName" },
  { label: "Type", value: "Child", section: "Contacts List", group: "Row 1" },
  { label: "Personal E-mail", value: "alexdittrich77@gmail.com", section: "Contacts List", group: "Row 1", mapped: "contact2.email" },
  { label: "First Name", value: "Tracey", section: "Contacts List", group: "Row 2", mapped: "contact3.firstName" },
  { label: "Last Name", value: "Dittrich", section: "Contacts List", group: "Row 2", mapped: "contact3.lastName" },
  { label: "Type", value: "Owner", section: "Contacts List", group: "Row 2" },
  { label: "Primary", value: "Yes", section: "Contacts List", group: "Row 2" },
  { label: "Cell Phone", value: "612-998-6723", section: "Contacts List", group: "Row 2", mapped: "contact3.phone" },
  { label: "Drivers License", value: "K011156496702", section: "Contacts List", group: "Row 2", mapped: "crm:contact3.iacrm_driverslicense" }
]);
const site = { system: "www8.nowcerts.com", url: "https://www8.nowcerts.com/x", title: "Dittrich, Tracey" };

describe("people across sources", () => {
  const first = mergeIngestedFields(null, ez, { system: "EZLynx", url: "https://app.ezlynx.com/x", title: "Tracy Dittrich" });
  const second = mergeIngestedFields(first.app, ams, site);

  it("matches by name, not by row", () => {
    expect(second.replaced).toBe(false);
    const n = second.app.normalized;
    // Alaxander is EZLynx's Alexander (slot 2); Tracey is the primary, not a new person
    expect(second.app.fields.find(f => f.value === "alexdittrich77@gmail.com")?.mapped).toBe("contact2.email");
    expect(second.app.fields.find(f => f.value === "612-998-6723")?.mapped).toBe("contact.phone");
    expect(n["contact3"]?.["firstName"]).toBe("Elizabeth");
    expect(n["contact"]?.["firstName"]).toBe("Tracy");
    expect(coApplicantsFromCapture(second.app).map(c => c.firstName)).toEqual(["Alexander", "Elizabeth"]);
  });

  it("takes license numbers out of the capture into the secured channel, with their person", () => {
    expect(JSON.stringify(second.app)).not.toContain("K011156496702");
    expect(second.secured).toEqual([{ path: "secure:primarycontact.iacrm_driverslicense", value: "K011156496702" }]);
    expect(isIdentifierColumn("iacrm_driverslicense")).toBe(true);
    expect(isIdentifierColumn("iacrm_dlstate")).toBe(false);
    expect(isCrmTarget("crm:contacts[].iacrm_driverslicense")).toBe(false);
    expect(securedIfIdentifier("crm:contacts[].iacrm_driverslicense")).toBe("secure:contacts[].iacrm_driverslicense");
  });

  it("a new person gets a new slot, never someone else's", () => {
    const third = mergeIngestedFields(second.app, src([
      { label: "First Name", value: "Morgan", section: "Contacts List", group: "Row 1", mapped: "contact2.firstName" },
      { label: "Last Name", value: "Dittrich", section: "Contacts List", group: "Row 1", mapped: "contact2.lastName" }
    ]), site);
    expect(third.app.fields.find(f => f.value === "Morgan")?.mapped).toBe("contact4.firstName");
  });
});

describe("name matching", () => {
  const p = (first: string, last: string, dob = "") => ({ first, last, dob, email: "" });
  it("tolerates spelling and short forms, never different people", () => {
    expect(samePerson(p("tracey", "dittrich"), p("tracy", "dittrich"))).toBe(true);
    expect(samePerson(p("alaxander", "dittrich"), p("alexander", "dittrich"))).toBe(true);
    expect(samePerson(p("alex", "dittrich"), p("alexander", "dittrich"))).toBe(true);
    expect(samePerson(p("elizabeth", "dittrich"), p("alexander", "dittrich"))).toBe(false);
    expect(samePerson(p("tracy", "dittrich", "19720311"), p("tracy", "dittrich", "20050101"))).toBe(false);
  });
  it("moves paths between person slots", () => {
    expect(slotOf("crm:contact3.gendercode")).toBe(3);
    expect(withSlot("crm:contact3.gendercode", 1)).toBe("crm:primarycontact.gendercode");
    expect(withSlot("contact.phone", 4)).toBe("contact4.phone");
    expect(withSlot("note:contact2", 1)).toBe("note:contact");
  });
});
