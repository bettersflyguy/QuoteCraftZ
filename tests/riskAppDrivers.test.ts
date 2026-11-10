/** Drivers added on an EZLynx quote's Drivers step (not on the applicant's
 * contact list) join the people, so their details reach the capture. */
import { describe, it, expect } from "vitest";
import { driversFromRiskApp } from "@/ezlynx/normalize";
import { addDrivers } from "@/ezlynx/client";
import type { CapturedApplicant } from "@/types";

const appRaw = { drivers: [
  { firstName: "Tracy", lastName: "Dittrich", dateOfBirth: "1972-03-11T00:00:00", gender: "Female", driversLicenseNumber: "K011", driversLicenseState: "MN" },
  { firstName: "Jake", lastName: "Dittrich", dateOfBirth: "2004-06-02T00:00:00", gender: "Male", maritalStatus: "Single", relationship: { name: "Child" }, driversLicenseNumber: "K022", driversLicenseState: "MN" },
  { firstName: "", lastName: "NoName" }
] };

const applicant = (): CapturedApplicant => ({
  ezlynxApplicantId: 1, firstName: "Tracy", lastName: "Dittrich", dateOfBirth: "1972-03-11", dlNumber: null, dlState: null,
  address: null, phones: [], emails: [], details: { gender: "Female" }, coApplicants: [], isCommercial: false
});

describe("risk application drivers", () => {
  it("reads each named driver as a person", () => {
    const d = driversFromRiskApp(appRaw);
    expect(d.map(p => [p.firstName, p.relationship, p.dateOfBirth, p.details?.["isDriver"]])).toEqual([
      ["Tracy", "", "1972-03-11", "Yes"], ["Jake", "Child", "2004-06-02", "Yes"]
    ]);
    expect(driversFromRiskApp({})).toEqual([]);
  });

  it("a driver who isn't already a person becomes a contact; the applicant is never duplicated", () => {
    const a = applicant();
    addDrivers(a, driversFromRiskApp(appRaw));
    expect(a.coApplicants.map(c => `${c.firstName} ${c.lastName}`)).toEqual(["Jake Dittrich"]);
    expect(a.coApplicants[0]!.details).toMatchObject({ gender: "Male", maritalStatus: "Single", isDriver: "Yes" });
    expect(a.details).toMatchObject({ gender: "Female", isDriver: "Yes" });
    addDrivers(a, driversFromRiskApp(appRaw));
    expect(a.coApplicants).toHaveLength(1);
  });
});
