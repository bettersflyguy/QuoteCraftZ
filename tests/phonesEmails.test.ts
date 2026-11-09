/** EZLynx holds any number of phones and emails; CRM holds one phone per
 * type and three emails. Each fits its slot; the rest are listed for the
 * timeline instead of being dropped. */
import { describe, it, expect } from "vitest";
import { contactChannels, normalizeApplicant } from "@/ezlynx/normalize";
import { ezlynxFields } from "@/sources/ezlynxSource";

describe("phones and emails", () => {
  it("one phone per type, emails 2 and 3 by order, the rest listed", () => {
    expect(contactChannels({
      phoneNumbers: [
        { type: "Home", number: "6125550100", extension: "" },
        { type: "Work", number: "6125550101", extension: "22" },
        { type: "Mobile", number: "6125550102" },
        { type: "Home", number: "6125550103" },
        { type: "Fax", number: "6125550104" }
      ],
      emailAddresses: [
        { type: "Personal", email: "a@x.com" }, { type: "Work", email: "b@x.com" },
        { email: "c@x.com" }, { type: "Other", email: "d@x.com" }, "e@x.com"
      ]
    })).toEqual({
      homePhone: "6125550100", workPhone: "6125550101 x22", mobile: "6125550102", fax: "6125550104",
      morePhones: "Home: 6125550103",
      email2: "b@x.com", email3: "c@x.com", moreEmails: "Other: d@x.com; e@x.com"
    });
  });

  it("route to the contact's own columns, co-applicants included", () => {
    const a = normalizeApplicant({
      id: 1, firstName: "Tracy", lastName: "Dittrich",
      phoneNumbers: [{ type: "Home", number: "6129867235" }, { type: "Work", number: "6125550101" }, { type: "Home", number: "6125550109" }],
      emailAddresses: [{ type: "Personal", email: "t@x.com" }, { type: "Work", email: "t@work.com" }],
      contacts: [{ firstName: "Alex", lastName: "Dittrich", phoneNumbers: [{ type: "Mobile", number: "6125550111" }, { type: "Home", number: "6125550112" }] }]
    });
    const routed = Object.fromEntries(ezlynxFields(a, undefined).filter(f => f.mapped).map(f => [f.mapped, f.value]));
    expect(routed["contact.phone"]).toBe("6129867235");
    expect(routed["crm:primarycontact.telephone2"]).toBe("6129867235");
    expect(routed["crm:primarycontact.telephone1"]).toBe("6125550101");
    expect(routed["crm:primarycontact.emailaddress2"]).toBe("t@work.com");
    expect(routed["note:contact"]).toBe("Home: 6125550109");
    expect(routed["crm:contact2.mobilephone"]).toBe("6125550111");
    expect(routed["crm:contact2.telephone2"]).toBe("6125550112");
  });
});
