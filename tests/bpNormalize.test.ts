import { describe, it, expect } from "vitest";
import { canonical, normalize } from "@/boldpenguin/normalize";

describe("Bold Penguin normalizer", () => {
  it("canonicalizes labels from common form names", () => {
    expect(canonical("Applicant_First-Name *")).toBe("applicant first name");
  });

  it("maps common Bold Penguin-style labels into the normalized payload", () => {
    const result = normalize([
      { label: "Legal Business Name", value: "Northwind Bakery LLC" },
      { label: "Primary Contact", value: "Alex Morgan" },
      { label: "Email Address", value: "alex@example.com" },
      { label: "Desired Effective Date", value: "10/01/2026" },
      { label: "Federal Tax ID", value: "12-3456789" }
    ]);

    expect(result).toEqual({
      business: { legalName: "Northwind Bakery LLC", fein: "12-3456789" },
      contact: { fullName: "Alex Morgan", email: "alex@example.com" },
      coverage: { effectiveDate: "10/01/2026" }
    });
  });

  it("maps GEICO's bare policyholder labels (live shape)", () => {
    const result = normalize([
      { label: "First Name", value: "Dearris" },
      { label: "Last Name", value: "Thomas" },
      { label: "Date of Birth", value: "12/12/1994" },
      { label: "Address", value: "203 WALL STREET" },
      { label: "Apt #", value: "4B" },
      { label: "5-Digit ZIP Code", value: "62206" },
      { label: "Email Address", value: "dearris.thomas@gmail.com" },
      { label: "Mobile Phone Number", value: "(618) 600-2169" },
      { label: "Coverage Start Date", value: "09/26/2026" }
    ]);
    expect(result["address"]?.["street1"]).toBe("203 WALL STREET");
    expect(result["address"]?.["street2"]).toBe("4B");
    expect(result["address"]?.["postalCode"]).toBe("62206");
    // bare "address" must never steal the email
    expect(result["contact"]?.["email"]).toBe("dearris.thomas@gmail.com");
    expect(result["contact"]?.["phone"]).toBe("(618) 600-2169");
    expect(result["coverage"]?.["effectiveDate"]).toBe("09/26/2026");
  });

  it("never mistakes a lienholder/finance company for the insured's business name", () => {
    const result = normalize([
      { label: "Finance or Leasing Company Name", value: "Chase Auto Finance" },
      { label: "Legal Business Name", value: "Northwind Bakery LLC" }
    ]);
    expect(result["business"]?.["legalName"]).toBe("Northwind Bakery LLC");
    const financeOnly = normalize([{ label: "Finance or Leasing Company Name", value: "Other" }]);
    expect(financeOnly["business"]).toBeUndefined();
  });

  it("does not reuse a generic field for multiple normalized properties", () => {
    const result = normalize([{ label: "Status", value: "Complete" }]);
    expect(result).toEqual({ application: { status: "Complete" } });
  });

  it("maps labels observed in the live Bold Penguin application", () => {
    const result = normalize([
      { label: "Policyholder's First Name", value: "Taylor" },
      { label: "Zipcode", value: "55401", section: "General information" },
      { label: "Founding Year of Business", value: "2018", section: "Business details" },
      { label: "Estimated total gross revenue", value: "250,000", section: "Business details" },
      { label: "How many floors are in this building?", value: "2", section: "Building information" }
    ]);

    expect(result).toEqual({
      business: { foundingYear: "2018", annualRevenue: "250,000" },
      contact: { firstName: "Taylor", fullName: "Taylor" },
      address: { postalCode: "55401" },
      building: { floors: "2" }
    });
  });
});

describe("explicit entity-slot routing (agent-taught captures)", () => {
  it("routes mapped fields to their exact slot, bypassing alias scoring", () => {
    const result = normalize([
      { label: "Email", value: "owner@northwind.com" },
      { label: "Contact 2 email", value: "spouse@northwind.com", mapped: "contact2.email" },
      { label: "Contact 2 full name", value: "Jamie Dittrich", mapped: "contact2.fullName" }
    ]);
    expect(result["contact"]?.["email"]).toBe("owner@northwind.com");
    expect(result["contact2"]).toEqual({ email: "spouse@northwind.com", fullName: "Jamie Dittrich" });
  });

  it("explicit path wins over a later alias claim of the same path", () => {
    // taught capture owns contact.email; the page's own "Email" field must
    // not overwrite it (the capture teaching is the agent's correction)
    const result = normalize([
      { label: "Preferred Email", value: "taught@example.com", mapped: "contact.email" },
      { label: "Email", value: "page-guess@example.com" }
    ]);
    expect(result["contact"]?.["email"]).toBe("taught@example.com");
  });

  it("first capture of a slot wins; unknown mapped paths fall back to aliases", () => {
    const result = normalize([
      { label: "Contact 2 phone", value: "612-555-0101", mapped: "contact2.phone" },
      { label: "Contact 2 phone", value: "612-555-0202", mapped: "contact2.phone" },
      { label: "Email", value: "a@b.com", mapped: "window.location" }
    ]);
    expect(result["contact2"]?.["phone"]).toBe("612-555-0101");
    // invalid path ignored -> alias scoring still routes the value
    expect(result["contact"]?.["email"]).toBe("a@b.com");
    expect(result["window"]).toBeUndefined();
  });
});

describe("CRM-column captures", () => {
  it("routes crm targets into their record group and bridges well-known columns into the semantic pipeline", () => {
    const result = normalize([
      { label: "Insured (account): Email", value: "tracey@example.com", mapped: "crm:account.emailaddress1" },
      { label: "Insured (account): Address 1: City", value: "Champlin", mapped: "crm:account.address1_city" },
      { label: "Related contacts: First Name 3", value: "Alaxander", mapped: "crm:contact3.firstname" },
      { label: "Related contacts: Address 1: City 3", value: "Duluth", mapped: "crm:contact3.address1_city" }
    ]);
    expect(result["crm:account"]).toEqual({ emailaddress1: "tracey@example.com", address1_city: "Champlin" });
    expect(result["contact"]?.["email"]).toBe("tracey@example.com");
    expect(result["address"]?.["city"]).toBe("Champlin");
    expect(result["crm:contact3"]).toEqual({ firstname: "Alaxander", address1_city: "Duluth" });
    expect(result["contact3"]?.["firstName"]).toBe("Alaxander");
  });

  it("a semantic teaching beats a bridged CRM column, and bridged values beat alias guesses", () => {
    const result = normalize([
      { label: "Email", value: "semantic@example.com", mapped: "contact.email" },
      { label: "Insured (account): Email", value: "crm@example.com", mapped: "crm:account.emailaddress1" },
      { label: "Insured (account): Main Phone", value: "612-555-0100", mapped: "crm:account.telephone1" },
      { label: "Phone", value: "000-000-0000" }
    ]);
    expect(result["contact"]?.["email"]).toBe("semantic@example.com");
    expect(result["crm:account"]?.["emailaddress1"]).toBe("crm@example.com");
    expect(result["contact"]?.["phone"]).toBe("612-555-0100");
  });

  it("never routes the AMS-reserved key or malformed crm targets", () => {
    const result = normalize([
      { label: "x", value: "AMS-1", mapped: "crm:account.iacrm_amsexternalid" },
      { label: "y", value: "v", mapped: "crm:systemuser.fullname" }
    ]);
    expect(result["crm:account"]).toBeUndefined();
    expect(result["crm:systemuser"]).toBeUndefined();
  });
});
