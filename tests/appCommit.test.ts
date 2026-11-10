import { describe, it, expect } from "vitest";
import { applicantFromCapture, accountNameFromCapture, buildSupplementalNote, buildTimelineNote, coApplicantsFromCapture, crmGroup, policyDraftsFromCapture, carrierGuess, detectPhone, parseMoney, policyFromCapture, toIsoDate, writeApplicationKnowledge } from "@/crm/appCommit";
import { normalize } from "@/boldpenguin/normalize";
import type { CapturedApplication } from "@/boldpenguin/types";
import type { CrmEnvironment } from "@/crm/environments";

const env = { id: "dev", name: "DEV", orgUrl: "https://x.crm.dynamics.com", color: "green" } as CrmEnvironment;

function capture(partial: Partial<CapturedApplication> = {}): CapturedApplication {
  return {
    schemaVersion: "1.1",
    capturedAt: "2026-09-25T12:00:00.000Z",
    source: { system: "sales.geico.com", url: "https://sales.geico.com/quote", title: "GEICO" },
    completion: { likelyCompleted: true, matchedPhrases: [], hasReviewStep: false },
    scannedSections: ["Quote"],
    normalized: {
      contact: { fullName: "Dearris Thomas", email: "dt@example.com", phone: "555-0100", dateOfBirth: "11/18/1949" },
      address: { street1: "100 Main St", city: "Duluth", state: "MN", postalCode: "55802" }
    },
    fields: [
      { label: "Bodily Injury Liability (BI)", value: "$25,000/$50,000", section: "Quote", group: "", source: "control" },
      { label: "Email Address", value: "dt@example.com", section: "Quote", group: "", source: "control" },
      { label: "Bodily Injury Liability (BI)", value: "$25,000/$50,000", section: "Other", group: "", source: "table" }
    ],
    ...partial
  };
}

describe("applicantFromCapture", () => {
  it("splits fullName, converts DOB, maps address/phone/email", () => {
    const a = applicantFromCapture(capture());
    expect(a.firstName).toBe("Dearris");
    expect(a.lastName).toBe("Thomas");
    expect(a.dateOfBirth).toBe("1949-11-18");
    expect(a.address).toEqual({ street: "100 Main St", city: "Duluth", state: "MN", postalCode: "55802" });
    expect(a.phones).toEqual([{ type: null, number: "555-0100" }]);
    expect(a.emails).toEqual(["dt@example.com"]);
    expect(a.isCommercial).toBe(false);
  });

  it("never splits the business name into a person (Tivly 'B Service' regression)", async () => {
    const { identityFromCapture } = await import("@/crm/appCommit");
    // only a business-named "Name" row: no person name at all
    const bizOnly = identityFromCapture(capture({
      normalized: { business: { legalName: "B H Towing Service" } },
      fields: [{ label: "Name", value: "B H Towing Service", section: "Leads", group: "", source: "review-row" }]
    }));
    expect(bizOnly.firstName).toBe("");
    expect(bizOnly.lastName).toBe("");
    // with the real contact present, the person wins past the business row
    const withPerson = identityFromCapture(capture({
      normalized: { business: { legalName: "B H Towing Service" }, contact: { fullName: "Bruce Hadams" } },
      fields: [{ label: "Name", value: "B H Towing Service", section: "Leads", group: "", source: "review-row" }]
    }));
    expect(withPerson.firstName).toBe("Bruce");
    expect(withPerson.lastName).toBe("Hadams");
  });

  it("strips carrier name decorations like '(PNI)' so the dupe gate and account name stay clean", async () => {
    const { identityFromCapture } = await import("@/crm/appCommit");
    // GEICO renders the primary named insured with a suffix; a fullName-only capture
    const viaFull = identityFromCapture(capture({ normalized: { contact: { fullName: "Richard Lewandowski (PNI)" } } }));
    expect(viaFull.firstName).toBe("Richard");
    expect(viaFull.lastName).toBe("Lewandowski");
    // and when first/last arrive mapped directly
    const viaParts = identityFromCapture(capture({ normalized: { contact: { firstName: "Richard", lastName: "Lewandowski (PNI)" } } }));
    expect(viaParts.lastName).toBe("Lewandowski");
  });

  it("rejects non-address 'email' values and recovers a real one from the fields (GEICO paperless regression)", async () => {
    const { identityFromCapture, applicantFromIdentity } = await import("@/crm/appCommit");
    // the Email label paired with preference text must never become emailaddress1
    const junk = identityFromCapture(capture({
      normalized: { contact: { fullName: "Richard Lewandowski", email: "paperless document delivery" } },
      fields: []
    }));
    expect(junk.email).toBe("");
    expect(applicantFromIdentity({ ...junk, email: "paperless document delivery" }, false).emails).toEqual([]);
    // a real address elsewhere in the capture is recovered
    const recovered = identityFromCapture(capture({
      normalized: { contact: { fullName: "Richard Lewandowski", email: "paperless document delivery" } },
      fields: [{ label: "Email Address", value: "rlewandowski@example.com", section: "Contact", group: "", source: "review-row" }]
    }));
    expect(recovered.email).toBe("rlewandowski@example.com");
  });

  it("drops middle names and prefers the exact Name fact row (live GEICO Edge shape)", async () => {
    const { identityFromCapture } = await import("@/crm/appCommit");
    // rail heading glued the middle name in; the Personal Information tab's
    // "Name" row has the clean form
    const app = capture({
      normalized: { contact: { fullName: "Edward La-Valle Parkin" } },
      fields: [{ label: "Name", value: "Edward Parkin", section: "Personal Information", group: "", source: "review-row" }]
    });
    const id = identityFromCapture(app);
    expect(id.firstName).toBe("Edward");
    expect(id.lastName).toBe("Parkin");
    // even without the Name row, the middle name never lands in the surname
    const railOnly = identityFromCapture(capture({ normalized: { contact: { fullName: "Edward La-Valle Parkin" } } }));
    expect(railOnly.firstName).toBe("Edward");
    expect(railOnly.lastName).toBe("Parkin");
  });

  it("is commercial when a business legal name exists, and names the account after it", () => {
    const app = capture({ normalized: { business: { legalName: "Northwind Bakery LLC" } } });
    expect(applicantFromCapture(app).isCommercial).toBe(true);
    expect(accountNameFromCapture(app)).toBe("Northwind Bakery LLC");
  });

  it("never writes an unparseable birthdate", () => {
    expect(toIsoDate("Nov 18 1949")).toBeNull();
    expect(toIsoDate("2026-10-01")).toBe("2026-10-01");
  });
});

describe("detectPhone", () => {
  it("rejects a phone TYPE that landed in the phone slot and finds the real number", () => {
    const app = capture({
      normalized: { contact: { phone: "Cellular telephone" } },
      fields: [
        { label: "Phone Type", value: "Cellular telephone", section: "Q", group: "", source: "control" },
        { label: "Phone Number", value: "(555) 010-0123", section: "Q", group: "", source: "control" }
      ]
    });
    expect(detectPhone(app)).toEqual({ number: "(555) 010-0123", isMobile: true });
    // the enrichment applicant carries the mobile type so iacrm_mobilephone fills
    expect(applicantFromCapture(app).phones).toEqual([{ type: "Mobile", number: "(555) 010-0123" }]);
  });

  it("prefers an explicit cell/mobile-labeled number", () => {
    const app = capture({
      normalized: {},
      fields: [{ label: "Cell Phone", value: "555-010-0123", section: "Q", group: "", source: "control" }]
    });
    expect(detectPhone(app)).toEqual({ number: "555-010-0123", isMobile: true });
  });

  it("returns null when nothing has enough digits", () => {
    expect(detectPhone(capture({ normalized: { contact: { phone: "Home" } }, fields: [] }))).toBeNull();
  });
});

describe("policyFromCapture (sale screen)", () => {
  it("normalizes policy number and premium from sale-screen labels", () => {
    const n = normalize([
      { label: "Policy Number", value: "PGR-9912345" },
      { label: "6 Month Total Premium", value: "$3,089.50" },
      { label: "Effective Date", value: "10/01/2026" }
    ]);
    expect(n["policy"]?.["number"]).toBe("PGR-9912345");
    expect(n["policy"]?.["premium"]).toBe("$3,089.50");
  });

  it("builds an editable draft, flagged only when a policy number exists", () => {
    const sold = capture({
      normalized: {
        policy: { number: "PGR-9912345", premium: "$3,089.50" },
        coverage: { effectiveDate: "10/01/2026", expirationDate: "04/01/2027" }
      }
    });
    const d = policyFromCapture(sold);
    expect(d.hasPolicy).toBe(true);
    expect(d.number).toBe("PGR-9912345");
    expect(d.premiumText).toBe("$3,089.50");
    expect(d.effectiveDate).toBe("10/01/2026");
    expect(d.carrierName).toBe("GEICO");
    expect(policyFromCapture(capture()).hasPolicy).toBe(false);
  });

  it("derives the expiration from effective + term when the sale screen omits it (live GEICO shape)", () => {
    const sold = capture({
      normalized: {},
      fields: [
        { label: "Policy Number", value: "6277201270", section: "Sale", group: "", source: "sale" },
        { label: "Effective Date", value: "9/27/2026", section: "Sale", group: "", source: "sale" },
        { label: "Total Premium", value: "$922.00", section: "Sale", group: "", source: "sale" },
        { label: "Policy Term", value: "6 months", section: "Sale", group: "", source: "sale" }
      ]
    });
    const d = policyFromCapture(sold);
    expect(d.hasPolicy).toBe(true);
    expect(d.number).toBe("6277201270");
    expect(d.premiumText).toBe("$922.00");
    expect(d.effectiveDate).toBe("9/27/2026");
    expect(d.expirationDate).toBe("3/27/2027");
  });

  it("finds the term when it lives in a field VALUE ('Policy Term: 6 Month')", async () => {
    const { policyFromCapture } = await import("@/crm/appCommit");
    const sold = capture({
      normalized: { policy: { number: "6280210193" } },
      fields: [
        { label: "Effective Date", value: "10/15/2026", section: "Sale", group: "", source: "sale" },
        { label: "Payment Plan", value: "6 Month Plan", section: "Sale", group: "", source: "review-row" }
      ]
    });
    const d = policyFromCapture(sold);
    expect(d.effectiveDate).toBe("10/15/2026");
    expect(d.expirationDate).toBe("4/15/2027");
  });

  it("parses money text into numbers", () => {
    expect(parseMoney("$3,089.50")).toBe(3089.5);
    expect(parseMoney("516")).toBe(516);
    expect(parseMoney("I decline")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});

describe("guessInsuredType", () => {
  it("a stray business-ish field never flips a personal-lines insured to Commercial", async () => {
    const { guessInsuredType } = await import("@/crm/appCommit");
    const personal = capture({
      normalized: { contact: { fullName: "Antoinette Harper" }, business: { legalName: "Lighting Resources USA Inc" } },
      fields: [{ label: "Employer", value: "Lighting Resources USA Inc", section: "Q", group: "", source: "control" }]
    });
    expect(guessInsuredType(personal)).toBe(1);
    const commercial = capture({
      normalized: { contact: { fullName: "Bruce Hadams" }, business: { legalName: "B H Towing Service" } },
      fields: [{ label: "NAIC Code", value: "488410", section: "Business", group: "", source: "review-row" }]
    });
    expect(guessInsuredType(commercial)).toBe(2);
  });
});

describe("splitUsAddress via identityFromCapture", () => {
  it("splits a one-line carrier mailing address into parts (live GEICO shape)", async () => {
    const { identityFromCapture, splitUsAddress } = await import("@/crm/appCommit");
    expect(splitUsAddress("7631 ANGELINE DR MINNEAPOLIS, MN 55428")).toEqual({
      street: "7631 ANGELINE DR", city: "MINNEAPOLIS", state: "MN", postalCode: "55428"
    });
    const app = capture({
      normalized: {
        contact: { fullName: "Edward Parkin", email: "edwardparkin@example.com", phone: "(612) 490-7742" },
        address: { street1: "7631 ANGELINE DR MINNEAPOLIS, MN 55428" }
      }
    });
    const id = identityFromCapture(app);
    expect(id.street).toBe("7631 ANGELINE DR");
    expect(id.city).toBe("MINNEAPOLIS");
    expect(id.state).toBe("MN");
    expect(id.postalCode).toBe("55428");
  });

  it("splits a bare confirmation-line address even when the ZIP was already rated (live GEICO billing shape)", async () => {
    const { identityFromCapture, splitUsAddress } = await import("@/crm/appCommit");
    expect(splitUsAddress("203 WALL STREET EAST SAINT LOUIS, IL 62206")).toEqual({
      street: "203 WALL STREET", city: "EAST SAINT LOUIS", state: "IL", postalCode: "62206"
    });
    // the ingest sale-pattern emits label "Mailing Address"; ZIP 62206 was
    // already captured from the rate-by-zip start page
    const app = capture({
      normalized: {
        contact: { fullName: "Dearris Thomas" },
        address: { street1: "203 WALL STREET EAST SAINT LOUIS, IL 62206", postalCode: "62206" }
      }
    });
    const id = identityFromCapture(app);
    expect(id.street).toBe("203 WALL STREET");
    expect(id.city).toBe("EAST SAINT LOUIS");
    expect(id.state).toBe("IL");
    expect(id.postalCode).toBe("62206");
    // the ingest regex that feeds this path matches the on-page line
    const re = /\b\d{1,6}\s+[A-Za-z0-9 .'#-]{3,60}?,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
    expect("Billing Address Confirmation 203 WALL STREET EAST SAINT LOUIS, IL 62206 Is this the correct billing address?".match(re)?.[0])
      .toBe("203 WALL STREET EAST SAINT LOUIS, IL 62206");
  });

  it("splits addresses with FULL state names and multi-parcel streets (live Tivly shape)", async () => {
    const { splitUsAddress } = await import("@/crm/appCommit");
    expect(splitUsAddress("1167, 1171, And 1169 South King Road San Jose, California 95122")).toEqual({
      street: "1167, 1171, And 1169 South King Road", city: "San Jose", state: "CA", postalCode: "95122"
    });
    // a trailing lowercase word pair must not pass as a state
    expect(splitUsAddress("123 Main St Springfield, Anytown 12345")).toBeNull();
  });

  it("leaves an already-split address untouched", async () => {
    const { identityFromCapture } = await import("@/crm/appCommit");
    const id = identityFromCapture(capture());
    expect(id.street).toBe("100 Main St");
    expect(id.city).toBe("Duluth");
  });
});

describe("buildSupplementalNote", () => {
  it("collects only unmapped fields, grouped by section, with a stable subject", async () => {
    const { buildSupplementalNote } = await import("@/crm/appCommit");
    const app = capture({
      normalized: {},
      fields: [
        { label: "Email Address", value: "dt@example.com", section: "Policyholder", group: "", source: "control" },
        { label: "Address", value: "203 Wall St", section: "Policyholder", group: "", source: "control" },
        { label: "Employment Status", value: "Employed", section: "Policyholder", group: "", source: "control" },
        { label: "Payment Plan", value: "6 Pay TMPP", section: "Payment", group: "", source: "review-row" },
        { label: "Bodily Injury Liability (BI)", value: "$30,000/$60,000", section: "Coverages", group: "", source: "review-row" }
      ]
    });
    const note = buildSupplementalNote(app)!;
    // mapped identity fields stay OUT of the note
    expect(note.body).not.toContain("dt@example.com");
    expect(note.body).not.toContain("203 Wall St");
    // supplemental facts are in, grouped
    expect(note.count).toBe(3);
    // ONE rich-text note: a table per section, every field in it
    expect(note.body).toContain("<h3>Payment</h3>");
    expect(note.body).toContain("<tr><td>Payment Plan</td><td>6 Pay TMPP</td></tr>");
    expect(note.body).toContain("<tr><td>Employment Status</td><td>Employed</td></tr>");
    expect(note.body).toContain("<tr><td>Bodily Injury Liability (BI)</td><td>$30,000/$60,000</td></tr>");
    expect(note.body.match(/<h2>/g)).toHaveLength(1);
    expect(note.subject).toBe("QuoteCraftZ: captured application data (sales.geico.com)");
    // notes written by earlier versions are still found (and renamed) on re-load
    expect(note.legacyMatch).toEqual({ prefix: "Quote Connector", suffix: " captured application data (sales.geico.com)" });
  });

  it("returns null when everything mapped", async () => {
    const { buildSupplementalNote } = await import("@/crm/appCommit");
    const app = capture({
      normalized: {},
      fields: [{ label: "Email Address", value: "dt@example.com", section: "P", group: "", source: "control" }]
    });
    expect(buildSupplementalNote(app)).toBeNull();
  });
});

describe("quoteFromCapture (rating portal, live Breeze shape)", () => {
  const breeze = (premiumMapped?: string) => capture({
    source: { system: "breeze.bhhc.com", url: "https://breeze.bhhc.com/quotes/x/forms/coverages", title: "Breeze" },
    normalized: {},
    fields: [
      { label: "CSL", value: "$300,000", section: "Coverage", group: "", source: "review-row" },
      { label: "Medical Payments", value: "$5,000", section: "Coverage", group: "", source: "review-row" },
      { label: "Physical Damage", value: "$2,731", section: "Coverage", group: "", source: "money-line" },
      { label: "Total Annual Premium", value: "$35,516", section: "Coverage", group: "", source: "money-line", ...(premiumMapped ? { mapped: premiumMapped } : {}) }
    ]
  });

  it("flags a quote only when a premium is mapped to the quote premium, with coverage summary", async () => {
    const { quoteFromCapture } = await import("@/crm/appCommit");
    const d = quoteFromCapture(breeze("crm:quote.iacrm_premium"));
    expect(d.hasQuote).toBe(true);
    expect(d.premiumText).toBe("$35,516");
    expect(d.carrierName).toBe("Berkshire Hathaway Homestate");
    expect(d.coverageSummary).toContain("CSL: $300,000");
    expect(d.coverageSummary).toContain("Physical Damage: $2,731");
  });

  it("a premium on the page that is not mapped to the quote premium makes no quote", async () => {
    const { quoteFromCapture } = await import("@/crm/appCommit");
    // nothing mapped at all
    expect(quoteFromCapture(breeze()).hasQuote).toBe(false);
    // a prior policy's premium, or any other premium column
    expect(quoteFromCapture(breeze("crm:iacrm_priorcoverage.iacrm_premium")).hasQuote).toBe(false);
    expect(quoteFromCapture(breeze("coverage.currentPremium")).hasQuote).toBe(false);
    expect(quoteFromCapture(breeze("policy.premium")).hasQuote).toBe(false);
  });

  it("does not flag a quote once a policy number exists (that's the policy flow)", async () => {
    const { quoteFromCapture } = await import("@/crm/appCommit");
    const sold = capture({
      normalized: { policy: { number: "6277201270", premium: "$922.00" } },
      fields: [{ label: "Premium", value: "$922.00", section: "Policy", group: "", source: "control", mapped: "crm:quote.iacrm_premium" }]
    });
    expect(quoteFromCapture(sold).hasQuote).toBe(false);
  });
});

describe("carrierGuess", () => {
  it("maps known portal hosts to carrier names", () => {
    expect(carrierGuess(capture())).toBe("GEICO");
    expect(carrierGuess(capture({ source: { system: "www.foragentsonly.com", url: "https://www.foragentsonly.com/q", title: "FAO" } }))).toBe("Progressive");
  });
});

describe("writeApplicationKnowledge", () => {
  it("skips with a notice when the tables are absent", async () => {
    const res = await writeApplicationKnowledge(env, capture(), "acc-1", {
      getKnowledgeNavProps: async () => null,
      executeBatch: async () => { throw new Error("must not be called"); },
      query: async () => ({ value: [] }) as never
    });
    expect(res.skipped).toBe("no-tables");
  });

  it("read-then-writes per canonical label, POSTing new rows without amsexternalid", async () => {
    const batches: { key: string; method: string; url: string; body?: unknown }[][] = [];
    const res = await writeApplicationKnowledge(env, capture(), "acc-1", {
      getKnowledgeNavProps: async () => ({ accountNav: "iacrm_accountid", questionNav: "iacrm_questionid" }),
      executeBatch: async (_env, ops) => {
        batches.push(ops);
        return ops.map((o, i) => ({ key: o.key, status: 204, error: null, entityId: o.method === "POST" && o.url === "iacrm_carrierquestions" ? `qg-${i}` : null }));
      },
      query: async () => ({ value: [] }) as never
    });
    // 3 fields, 2 unique labels -> 2 questions + 2 answers
    expect(res).toEqual({ questionsUpserted: 2, answersUpserted: 2, skipped: null });
    const [qOps, aOps] = batches as [typeof batches[0], typeof batches[0]];
    expect(qOps).toHaveLength(2);
    for (const o of qOps) {
      expect(o.method).toBe("POST");
      const b = o.body as Record<string, unknown>;
      expect(b["iacrm_amsexternalid"]).toBeUndefined();
      expect(String(b["iacrm_questionid"])).toMatch(/^capture:/);
    }
    const answer = aOps.find(o => String((o.body as Record<string, unknown>)["iacrm_riskanswer_name"]).includes("Bodily"))!;
    const body = answer.body as Record<string, unknown>;
    expect(body["iacrm_value"]).toBe("$25,000/$50,000");
    expect(body["iacrm_source"]).toBe("sales.geico.com");
    expect(body["iacrm_accountid@odata.bind"]).toBe("/accounts(acc-1)");
    expect(String(body["iacrm_questionid@odata.bind"])).toMatch(/^\/iacrm_carrierquestions\(qg-\d+\)$/);
    expect(body["iacrm_amsexternalid"]).toBeUndefined();
  });
});

describe("coApplicantsFromCapture (related-contact entity slots)", () => {
  it("builds co-applicants from contact2/contact3 with validation, in slot order", () => {
    const app = capture({
      normalized: {
        contact: { fullName: "Tracey Dittrich" },
        contact2: { fullName: "Jamie Dittrich (spouse)", email: "jamie@example.com", phone: "612-555-0101", dateOfBirth: "03/02/1980" },
        contact3: { firstName: "Kim", lastName: "Dittrich", email: "paperless delivery preferred", phone: "n/a" }
      }
    });
    expect(coApplicantsFromCapture(app)).toEqual([
      { firstName: "Jamie", lastName: "Dittrich", relationship: "", phone: "612-555-0101", email: "jamie@example.com", dateOfBirth: "1980-03-02", dlNumber: null, dlState: null, slot: 2 },
      // non-email / non-phone values never land in contact columns
      { firstName: "Kim", lastName: "Dittrich", relationship: "", phone: null, email: null, dateOfBirth: null, dlNumber: null, dlState: null, slot: 3 }
    ]);
  });

  it("skips empty slots and rides along on applicantFromCapture", () => {
    expect(coApplicantsFromCapture(capture())).toEqual([]);
    const app = capture({ normalized: { contact: { fullName: "Tracey Dittrich" }, contact2: { fullName: "Jamie Dittrich" } } });
    expect(applicantFromCapture(app).coApplicants.map(c => c.firstName)).toEqual(["Jamie"]);
  });
});

describe("supplemental note with entity-slot fields", () => {
  it("keeps taught related-contact fields out of the note (structured) while vehicle slots stay in it", () => {
    const app = capture({
      fields: [
        { label: "Contact 2 email", value: "jamie@example.com", section: "", group: "", source: "taught", mapped: "contact2.email" },
        { label: "Vehicle 1 VIN", value: "1HGCM82633A004352", section: "", group: "", source: "taught", mapped: "vehicle1.vin" }
      ]
    });
    const note = buildSupplementalNote(app);
    expect(note?.body).not.toContain("jamie@example.com");
    expect(note?.body).toContain("1HGCM82633A004352");
  });
});

describe("CRM-column captures at commit", () => {
  it("related contacts carry their taught columns as extras", () => {
    const app = capture({
      normalized: {
        contact: { fullName: "Tracey Dittrich" },
        contact2: { firstName: "Alaxander", lastName: "Dittrich" },
        "crm:contact2": { firstname: "Alaxander", lastname: "Dittrich", address1_city: "Duluth" }
      }
    });
    const [co] = coApplicantsFromCapture(app);
    expect(co?.firstName).toBe("Alaxander");
    expect(co?.extra).toEqual({ firstname: "Alaxander", lastname: "Dittrich", address1_city: "Duluth" });
  });

  it("policies fan out into one draft per taught row, in row order", () => {
    const app = capture({
      normalized: {
        "crm:policy2": { iacrm_policynumber: "502346899300", iacrm_premium: "$3,892.14" },
        "crm:policy1": { iacrm_policynumber: "989815765", iacrm_effectivedate: "06/01/2026", iacrm_expirationdate: "12/01/2026" },
        "crm:policy3": { iacrm_premium: "$905.00" }
      }
    });
    const drafts = policyDraftsFromCapture(app);
    expect(drafts.map(d => [d.number, d.hasPolicy])).toEqual([["989815765", true], ["502346899300", true], ["", false]]);
    expect(drafts[0]!.effectiveDate).toBe("06/01/2026");
    expect(drafts[1]!.extra["iacrm_premium"]).toBe("$3,892.14");
    expect(crmGroup(app, "crm:quote")).toBeNull();
  });
});

describe("timeline note (Add to notes)", () => {
  it("gathers tagged values into one organized rich-text note, escaped, and keeps them out of the leftovers note", () => {
    const app = capture({
      fields: [
        { label: "Customer since", value: "11/04/2019", section: "Notes", group: "", source: "taught", mapped: "note" },
        { label: "VIN", value: "JTMBF4DV4A5030644", section: "Vehicles list", group: "Row 1", source: "taught", mapped: "note" },
        { label: "VIN", value: "5TDDKRFH9FS121015", section: "Vehicles list", group: "Row 2", source: "taught", mapped: "note" },
        { label: "Remarks", value: "<script>x</script> & more", section: "Notes", group: "", source: "taught", mapped: "note" },
        { label: "Employment Status", value: "Employed", section: "Quote", group: "", source: "control" }
      ]
    });
    const note = buildTimelineNote(app)!;
    expect(note.subject).toBe("QuoteCraftZ: Non Mapped Timeline Entries (sales.geico.com)");
    expect(note.html.startsWith("<h2>Non Mapped Timeline Entries</h2>")).toBe(true);
    expect(note.count).toBe(4);
    expect(note.html).toContain("<h3>Notes</h3>");
    expect(note.html).toContain("<td>Customer since</td><td>11-04-2019</td>");
    expect(note.html).toContain("<h3>Vehicles list</h3>");
    expect(note.html).toContain("<tr><th>VIN</th></tr><tr><td>JTMBF4DV4A5030644</td></tr><tr><td>5TDDKRFH9FS121015</td></tr>");
    expect(note.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; more");
    expect(note.html).not.toContain("<script>");
    // the leftovers note carries only what was NOT tagged
    const leftovers = buildSupplementalNote(app)!;
    expect(leftovers.body).toContain("Employment Status");
    expect(leftovers.body).not.toContain("Customer since");
    expect(buildTimelineNote(capture())).toBeNull();
  });
});

describe("timeline notes per record", () => {
  it("each record gets only the values tagged for it", () => {
    const app = capture({
      fields: [
        { label: "Customer since", value: "11/04/2019", section: "Notes", group: "", source: "taught", mapped: "note" },
        { label: "Prior carrier remarks", value: "Non-renewed 2024", section: "Notes", group: "", source: "taught", mapped: "note:policy" },
        { label: "Best time to call", value: "Evenings", section: "Notes", group: "", source: "taught", mapped: "note:contact" }
      ]
    });
    expect(buildTimelineNote(app, "account")!.html).toContain("Customer since");
    expect(buildTimelineNote(app, "account")!.html).not.toContain("Prior carrier");
    expect(buildTimelineNote(app, "policy")!.html).toContain("Non-renewed 2024");
    expect(buildTimelineNote(app, "contact")!.count).toBe(1);
    expect(buildTimelineNote(app, "quote")).toBeNull();
    // none of them leak into the leftovers note
    expect(buildSupplementalNote(app)).toBeNull();
  });
});
