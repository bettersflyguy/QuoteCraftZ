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
