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

  it("marks commercial accounts with the business name", () => {
    const fields = buildCrmCaptureFields({
      account: { accountid: "a2", name: "Northwind Bakery LLC", iacrm_insuredtype: 2 },
      contact: { firstname: "Alex", lastname: "Morgan" },
      riskAnswers: []
    });
    expect(normalize(fields)["business"]?.["legalName"]).toBe("Northwind Bakery LLC");
  });
});
