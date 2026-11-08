/** The portal mapper ships as a plain UMD script (public/portal/) because it is
 * injected on demand into arbitrary carrier-portal tabs - test it as shipped. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { buildCandidates, matchField } = require(
  path.resolve(__dirname, "../public/portal/portal-mapper.js")
) as {
  buildCandidates: (payload: unknown) => unknown[];
  matchField: (fieldName: string, candidates: unknown[]) => { value: string; source: string } | null;
};

const payload = {
  normalized: {
    business: { legalName: "Example Bakery LLC", fein: "12-3456789" },
    contact: { firstName: "Taylor", lastName: "Jordan", email: "taylor@example.com" },
    address: { street1: "100 Main St", city: "Duluth", state: "MN", postalCode: "55802" }
  },
  fields: [
    { section: "Business details", label: "Has this business had a loss or claim in the last 5 years?", value: "No" }
  ]
};

describe("portal mapper", () => {
  it("matches common carrier-portal labels to normalized applicant data", () => {
    const candidates = buildCandidates(payload);
    expect(matchField("Named Insured", candidates)?.value).toBe("Example Bakery LLC");
    expect(matchField("Contact Email Address", candidates)?.value).toBe("taylor@example.com");
    expect(matchField("ZIP Code", candidates)?.value).toBe("55802");
  });

  it("matches carrier questions copied from Bold Penguin by their label", () => {
    const candidates = buildCandidates(payload);
    const match = matchField("Has this business had a loss or claim in the last 5 years?", candidates);
    expect(match?.value).toBe("No");
    expect(match?.source).toBe("captured");
  });

  it("does not match unrelated generic controls", () => {
    const candidates = buildCandidates(payload);
    expect(matchField("Search this website", candidates)).toBeNull();
  });

  it("a generic captured 'Name' field never poisons name/city matching; fullName splits (live FAO regression)", () => {
    const candidates = buildCandidates({
      normalized: { contact: { fullName: "Edward Parkin" } },
      fields: [{ section: "Personal Information", label: "Name", value: "Edward Parkin" }]
    });
    // FAO's internal field ids contain "NamedInsured" - must not match a bare Name field
    expect(matchField("City NamedInsured.City", candidates)).toBeNull();
    expect(matchField("First Name NamedInsured.FirstName", candidates)?.value).toBe("Edward");
    expect(matchField("Last Name NamedInsured.LastName", candidates)?.value).toBe("Parkin");
  });

  it("splits a combined street line into street1 + street2 (live Root shape)", () => {
    const candidates = buildCandidates({
      normalized: { address: { street1: "4054 W 115Th St, 409", city: "Chicago", postalCode: "60655" } },
      fields: []
    });
    expect(matchField("Address 1 quote::profile/0/address1", candidates)?.value).toBe("4054 W 115Th St");
    expect(matchField("Address 2 quote::profile/0/address2", candidates)?.value).toBe("409");
  });

  it("matches compact portal VIN field names to the captured vehicle VIN", () => {
    const candidates = buildCandidates({
      normalized: {},
      fields: [{ section: "Vehicles", group: "2023 Example", label: "Enter vehicle VIN", value: "1EXAMPLE234567890" }]
    });
    expect(matchField("vehicleVIN", candidates)?.value).toBe("1EXAMPLE234567890");
    expect(matchField("VIN Number", candidates)?.value).toBe("1EXAMPLE234567890");
  });
});
