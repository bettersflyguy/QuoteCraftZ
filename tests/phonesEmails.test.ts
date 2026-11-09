/** Phones and emails are lists: the FIRST of each is the primary and fills
 * the insured; every other one is a row of the Phones / Emails list, routed
 * where the agent decides (a timeline note by default). */
import { describe, it, expect } from "vitest";
import { contactChannels, normalizeApplicant } from "@/ezlynx/normalize";
import { ezlynxFields } from "@/sources/ezlynxSource";
import { normalize } from "@/boldpenguin/normalize";
import { buildTimelineNote } from "@/crm/appCommit";
import type { CapturedApplication } from "@/boldpenguin/types";

const raw = {
  id: 1, firstName: "Tracy", lastName: "Dittrich",
  phoneNumbers: [
    { type: "Home", number: "(612) 986-7235", extension: "" },
    { type: "Work", number: "(612) 813-3300", extension: "22" },
    { type: "Mobile", number: "(612) 555-0111" }
  ],
  emailAddresses: [{ type: "Primary", email: "tracey@example.com" }, { type: "Work", email: "tracey@work.example.com" }],
  contacts: [{ firstName: "Alex", lastName: "Dittrich", phoneNumbers: [{ type: "Mobile", number: "6125550111" }, { type: "Home", number: "6125550112" }] }]
};

describe("phones and emails", () => {
  it("keeps every one, in order", () => {
    const c = contactChannels(raw);
    expect(c.phones.map(p => p.type)).toEqual(["Home", "Work", "Mobile"]);
    expect(c.emails.map(e => e.email)).toEqual(["tracey@example.com", "tracey@work.example.com"]);
  });

  it("the primary fills the insured; the others are list rows", () => {
    const fields = ezlynxFields(normalizeApplicant(raw), undefined);
    expect(fields.find(f => f.mapped === "contact.phone")?.value).toBe("(612) 986-7235");
    expect(fields.find(f => f.mapped === "contact.email")?.value).toBe("tracey@example.com");
    const phones = fields.filter(f => f.section === "Phones").map(f => [f.group, f.label, f.value, f.mapped]);
    expect(phones).toEqual([
      ["Row 1", "Phone type", "Work", "note"], ["Row 1", "Phone number", "(612) 813-3300", "note"], ["Row 1", "Extension", "22", "note"],
      ["Row 2", "Phone type", "Mobile", "note"], ["Row 2", "Phone number", "(612) 555-0111", "note"]
    ]);
    expect(fields.filter(f => f.section === "Emails").map(f => f.value)).toEqual(["Work", "tracey@work.example.com"]);
    // a co-applicant's extras ride on their row
    expect(fields.find(f => f.label === "Additional phones")?.value).toBe("Home: 6125550112");
  });

  it("the agent's routing decides where the rows go", () => {
    const fields = ezlynxFields(normalizeApplicant(raw), { "phone.type": "note:contact", "phone.number": "note:contact", "phone.extension": "" });
    expect(fields.filter(f => f.section === "Phones" && f.mapped === "note:contact")).toHaveLength(4);
    expect(fields.find(f => f.label === "Extension")?.mapped).toBeUndefined();
  });

  it("land in the note as one Phones table", () => {
    const fields = ezlynxFields(normalizeApplicant(raw), undefined);
    const app = { fields, normalized: normalize(fields), capturedAt: 0, source: { system: "EZLynx" } } as unknown as CapturedApplication;
    const note = buildTimelineNote(app, "account")!;
    expect(note.html).toContain("<h3>Phones</h3>");
    expect(note.html).toContain("<th>Phone type</th><th>Phone number</th><th>Extension</th>");
    expect(note.html).toContain("<td>Work</td><td>(612) 813-3300</td><td>22</td>");
    expect(note.html).not.toContain("986-7235");
  });
});
