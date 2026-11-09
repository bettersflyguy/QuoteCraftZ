// Builds the app.ezlynx.com page-field mappings in the shipped share file
// (public/mappings/quotecraftz-ezlynx-mappings.json) from the field labels
// read off EZLynx's auto quote steps. Keys match fieldKeyOf() in
// src/portal/fieldMaps.ts: "field:<step>|<label>", lowercase words only.
// Run: node scripts/ezlynx-page-fields.mjs
import { readFileSync, writeFileSync } from "node:fs";

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// "Applicant Info>Prefix": the field inside that panel (contacts repeat it)
const fieldKey = (page, label) => `field:${key(page)}|${label.split(">").map(key).join(">")}`;

/** step (page title after " - ") -> [label, target] */
const PAGES = {
  // one Vehicles table on the insured's timeline, a row per vehicle
  Vehicles: [
    "VIN", "Year", "Make", "Model", "Sub-Model", "Purchase Date", "Passive Restraints", "Anti-Lock Brakes",
    "Daytime Running Lights", "Cost New Value", "Anti-Theft", "Vehicle Use", "Miles One Way", "# Days/Week",
    "# Weeks/Month", "Annual Miles", "Current Odometer", "Performance", "Modifications Value", "Was the car new?",
    "Ownership Type", "Car Pool", "Telematics", "Transportation Network Company"
  ].map(l => [l, "note"]),
  // driver rating details (names identify each row; identity, license
  // state/status, relationship and occupation come from the data service;
  // SSN and DL# are secured and never shared)
  Drivers: [
    "First Name", "Last Name", "Age Licensed", "Rated Driver", "Defensive Driver Course Date",
    "License Sus/Rev (Last 5 years)", "SR-22 Required", "FR-44 Required", "Good Student", "Student > 100 miles away",
    "Driver Education", "Mature Driver", "Good Driver"
  ].map(l => [l, "note"]),
  // Details screen fields the data service does not return
  Details: [
    ["Applicant Info>Prefix", "crm:primarycontact.salutation"],
    ["Applicant Info>Suffix", "crm:primarycontact.suffix"],
    ["Applicant Info>Preferred Language", "note:contact"]
  ],
  "Policy Info": [
    ["Prior Carrier", "coverage.currentCarrier"],
    ["Prior Policy Premium", "coverage.currentPremium"],
    ["Effective Date (New Policy)", "coverage.effectiveDate"],
    ["Prior Policy Expiration Date", "note:opportunity"],
    ["Prior Liability Limits", "note:opportunity"],
    ["Prior Policy Term", "note:opportunity"],
    ["Years with Prior Carrier", "note:opportunity"],
    // "Months" is omitted: two fields share that label (prior carrier and
    // continuous coverage), so it can't name one value
    ["Years with Continuous Coverage", "note:opportunity"],
    ["Credit Check and Other Underwriting Reports Authorized", "note:opportunity"],
    ["New Policy Term", "note:opportunity"],
    ["Quote as Package", "note:opportunity"]
  ],
  // requested coverages: policy-wide limits as single values, per-vehicle
  // physical damage as a Coverage table (a row per vehicle)
  Coverage: [
    "Bodily Injury", "Uninsured Motorist", "Underinsured Motorist", "Property Damage", "Medical Payments",
    "PersonalInjuryProtectionOptions", "Personal Injury Protection Deductible", "Work Loss", "Residence is",
    "Comprehensive", "Collision", "Towing & Labor", "Rental Expense", "Stated Amount"
  ].map(l => [l, "note:opportunity"])
};

const map = {};
for (const [page, fields] of Object.entries(PAGES)) for (const [label, target] of fields) map[fieldKey(page, label)] = target;

const file = new URL("../public/mappings/quotecraftz-ezlynx-mappings.json", import.meta.url);
const doc = JSON.parse(readFileSync(file, "utf8"));
doc.maps = { "https://app.ezlynx.com": map };
// data-service fields added after the first file: same routes as the defaults
Object.assign(doc.dataServices.ezlynx, {
  "applicant.csr": "note",
  "applicant.preferredContactMethod": "crm:primarycontact.preferredcontactmethodcode"
});
writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`${Object.keys(map).length} page fields written`);
