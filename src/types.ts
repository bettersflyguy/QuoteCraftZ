export interface CapturedApplicant {
  ezlynxApplicantId: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;          // "1949-11-18"
  address: { street: string; city: string; state: string; postalCode: string } | null;
  phones: { type: string | null; number: string }[];
  emails: string[];
  coApplicants: { firstName: string; lastName: string; relationship: string; phone: string | null; email: string | null; dateOfBirth: string | null }[];
  isCommercial: boolean;
}

export interface CapturedQuote {
  key: string;                          // "ezlynx:{execId}:req" | "ezlynx:{execId}:alt{n}"
  kind: "requested" | "alternate";
  carrierEzlynxId: number;
  carrierName: string;
  quoteNumber: string | null;
  premium: number | null;               // totalPremium as number
  termMonths: number | null;            // 6 | 12 | null
  coverageSummary: string;              // rendered, verbatim values
  coverageLines: { code: string; label: string; limitText: string }[]; // structured, verbatim
  raw: unknown;                         // this quote's scriptResult context, for iacrm_rawpayload
}

export interface CapturedLobBlock {
  lob: string;                          // "Auto" | "Home" as EZLynx returns it
  applicantQuoteId: number;
  quotes: CapturedQuote[];
  errors: { carrierName: string; message: string }[];
}

export interface CapturedRun {
  applicant: CapturedApplicant;
  openApplicationId: number;
  capturedAt: string;                   // ISO, stamped at capture
  ratedAt: string | null;               // the rate run's created timestamp (RunListItem.created)
  blocks: CapturedLobBlock[];
}

export interface RunListItem {
  applicationId: number;
  applicantId: number;
  created: string;
  lobs: string;                         // "Auto, Home"
  quoteIdsByLob: { lob: string; applicantQuoteId: number }[];
  description: string;
}
