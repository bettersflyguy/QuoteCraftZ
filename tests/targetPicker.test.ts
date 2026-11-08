import { describe, it, expect } from "vitest";
import { filterTargets, type TargetGroup } from "@/panel/targetSearch";

const groups: TargetGroup[] = [
  { group: "Insured (account)", paths: [
    { path: "crm:account.address1_city", label: "Address 1: City" },
    { path: "crm:account.emailaddress1", label: "Email" }
  ] },
  { group: "Primary contact", paths: [
    { path: "crm:primarycontact.address1_city", label: "Address 1: City" }
  ] },
  { group: "Related contacts (all rows)", paths: [
    { path: "crm:contacts[].address1_city", label: "Address 1: City" },
    { path: "crm:contacts[].emailaddress1", label: "Email" }
  ] }
];

describe("mapping target search", () => {
  it("returns every entity's match, each tagged with its entity", () => {
    expect(filterTargets(groups, "city").map(h => [h.label, h.group])).toEqual([
      ["Address 1: City", "Insured (account)"],
      ["Address 1: City", "Primary contact"],
      ["Address 1: City", "Related contacts (all rows)"]
    ]);
  });

  it("matches words across the field AND its entity, in any order", () => {
    expect(filterTargets(groups, "contact city").map(h => h.path)).toEqual([
      "crm:primarycontact.address1_city",
      "crm:contacts[].address1_city"
    ]);
    expect(filterTargets(groups, "related email").map(h => h.path)).toEqual(["crm:contacts[].emailaddress1"]);
    // case/punctuation-insensitive: "e-mail" still finds "Email"
    expect(filterTargets(groups, "ACCOUNT  e-mail").map(h => h.path)).toEqual(["crm:account.emailaddress1"]);
    expect(filterTargets(groups, "account email").map(h => h.path)).toEqual(["crm:account.emailaddress1"]);
  });

  it("caps results so a broad query stays responsive", () => {
    expect(filterTargets(groups, "", 2)).toHaveLength(2);
  });
});
