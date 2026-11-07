import { describe, it, expect } from "vitest";
import { buildCrmCaptureFields } from "@/crm/crmSource";
import { normalize } from "@/boldpenguin/normalize";

describe("buildCrmCaptureFields", () => {
  it("turns account + primary contact + risk answers into normalizable fields", () => {
    const fields = buildCrmCaptureFields({
      account: {
        accountid: "a1", name: "Edward Parkin", iacrm_insuredtype: 1,
        iacrm_insuredfirstname: "Edward", iacrm_insuredlastname: "Parkin",
        address1_line1: "7631 ANGELINE DR", address1_city: "MINNEAPOLIS",
        address1_stateorprovince: "MN", address1_postalcode: "55428",
        telephone1: "(612) 490-7742", iacrm_mobilephone: "(612) 490-7742",
        emailaddress1: "edwardparkin@example.com"
      },
      contact: { firstname: "Edward", lastname: "Parkin", birthdate: "1968-10-24", gendercode: 1, familystatuscode: 1 },
      riskAnswers: [{ label: "Do you own or rent your home?", value: "Rent" }]
    });

    const n = normalize(fields);
    expect(n["contact"]?.["firstName"]).toBe("Edward");
    expect(n["contact"]?.["lastName"]).toBe("Parkin");
    expect(n["address"]?.["street1"]).toBe("7631 ANGELINE DR");
    expect(n["address"]?.["postalCode"]).toBe("55428");
    expect(n["contact"]?.["email"]).toBe("edwardparkin@example.com");
    expect(n["contact"]?.["dateOfBirth"]).toBe("10/24/1968");
    expect(n["contact"]?.["gender"]).toBe("Male");
    expect(n["contact"]?.["maritalStatus"]).toBe("Single");
    // the phone carries the Mobile label so detectPhone flags it
    expect(fields.find(f => f.label === "Mobile Phone Number")?.value).toBe("(612) 490-7742");
    // a personal-lines account name never becomes a business name
    expect(n["business"]).toBeUndefined();
    // logged risk answers ride along for portal filling
    expect(fields.find(f => f.section === "Risk data")?.value).toBe("Rent");
  });

  it("repairs dirty records holding the full name in the name columns", () => {
    const fields = buildCrmCaptureFields({
      account: null,
      contact: { firstname: "Edward Parkin", lastname: "Edward Parkin" },
      riskAnswers: []
    });
    const n = normalize(fields);
    expect(n["contact"]?.["firstName"]).toBe("Edward");
    expect(n["contact"]?.["lastName"]).toBe("Parkin");
  });

  it("prefers the account's insured name over a different primary contact and suppresses that contact's personal fields (Tracey/Alexander regression)", () => {
    const fields = buildCrmCaptureFields({
      account: {
        accountid: "a3", name: "Dittrich, Tracey", iacrm_insuredtype: 1,
        iacrm_insuredfirstname: "Tracey", iacrm_insuredlastname: "Dittrich",
        telephone1: "612-986-7235", emailaddress1: "tracey.dittrich@comcast.net"
      },
      contact: { firstname: "Alaxander", lastname: "Dittrich", birthdate: "1977-05-02", gendercode: 1, emailaddress1: "alexdittrich77@gmail.com" },
      riskAnswers: []
    });
    const n = normalize(fields);
    expect(n["contact"]?.["firstName"]).toBe("Tracey");
    expect(n["contact"]?.["lastName"]).toBe("Dittrich");
    // Alexander's DOB/gender/email never ride onto Tracey's quote
    expect(n["contact"]?.["dateOfBirth"]).toBeUndefined();
    expect(n["contact"]?.["gender"]).toBeUndefined();
    expect(n["contact"]?.["email"]).toBe("tracey.dittrich@comcast.net");
  });

  it("lists every related contact as display-only context rows", () => {
    const fields = buildCrmCaptureFields({
      account: { accountid: "a4", name: "Dittrich, Tracey", _primarycontactid_value: "c1", iacrm_insuredfirstname: "Tracey", iacrm_insuredlastname: "Dittrich" },
      contact: null,
      riskAnswers: [],
      relatedContacts: [
        { contactid: "c1", fullname: "Alaxander Dittrich", emailaddress1: "alexdittrich77@gmail.com", mobilephone: "612-555-0101" },
        { contactid: "c2", fullname: "Tracey Dittrich", telephone1: "612-986-7235", birthdate: "1979-03-14" }
      ]
    });
    const rows = fields.filter(f => f.section === "Related contacts");
    expect(rows.map(r => r.label)).toEqual(["Alaxander Dittrich (primary)", "Tracey Dittrich"]);
    expect(rows[0]!.value).toBe("alexdittrich77@gmail.com · 612-555-0101");
    expect(rows[1]!.value).toContain("DOB 3/14/1979");
    // context rows never pollute the normalized identity
    const n = normalize(fields);
    expect(n["contact"]?.["firstName"]).toBe("Tracey");
  });

  it("marks commercial accounts with the business name", () => {
    const fields = buildCrmCaptureFields({
      account: { accountid: "a2", name: "Northwind Bakery LLC", iacrm_insuredtype: 2 },
      contact: { firstname: "Alex", lastname: "Morgan" },
      riskAnswers: []
    });
    expect(normalize(fields)["business"]?.["legalName"]).toBe("Northwind Bakery LLC");
  });
});
