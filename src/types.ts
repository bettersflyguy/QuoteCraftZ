export interface CapturedAddress {
  type: string; street: string; unit: string; address2: string; city: string; state: string;
  county: string; postalCode: string; postalCodeSuffix: string; yearsAtAddress: string; monthsAtAddress: string;
}

/** "person": whose it is (the applicant's or a contact's name). */
export interface CapturedPhone { type: string; number: string; extension: string; person?: string }
export interface CapturedEmail { type: string; email: string; person?: string }

export interface CapturedApplicant {
  ezlynxApplicantId: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;          // "1949-11-18"
  dlNumber: string | null;             // secured PII - written only to field-secured columns
  dlState: string | null;
  /** Secured pass-through only: moved to the session holding area and
   * stripped by the worker before the capture is stored. */
  ssn?: string | null;
  address: { street: string; city: string; state: string; postalCode: string } | null;
  phones: { type: string | null; number: string }[];
  emails: string[];
  /** Every other non-sensitive value the source returns (gender, marital
   * status, occupation, lead source...), keyed by field id, as display text.
   * Never SSN; license NUMBERS stay in dlNumber (secured columns only). */
  details?: Record<string, string>;
  /** Every address the source holds, the primary first (one CRM address row
   * each: row 1 = Address 1). */
  addresses?: CapturedAddress[];
  /** Phones / emails after the primary (phones[0], emails[0]), in source
   * order: one row each, routed as the agent chooses. */
  morePhones?: CapturedPhone[];
  moreEmails?: CapturedEmail[];
  coApplicants: {
    firstName: string; lastName: string; relationship: string; phone: string | null; email: string | null;
    dateOfBirth: string | null; dlNumber: string | null; dlState: string | null;
    ssn?: string | null;
    details?: Record<string, string>;
    /** Captured CRM-column values for this person (raw text from the panel;
     * the worker replaces them with catalog-coerced values before writing). */
    extra?: Record<string, unknown>;
  }[];
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

export interface IcqPair { questionId: string; carrier: string | null; label: string; answer: string | null }

export interface CapturedLobBlock {
  lob: string;                          // "Auto" | "Home" as EZLynx returns it
  applicantQuoteId: number;
  /** carrier underwriting Q&A for this LOB's application; null when unavailable */
  icq: {
    pairs: IcqPair[];
    answeredCount: number;
    totalQuestions: number;
    state: string | null;
    /** full question metadata - feeds the carrier-question dictionary, stripped from rawpayload */
    catalog: {
      questionId: string;
      carrier: string | null;
      label: string;
      helpText: string | null;
      answerType: string | null;
      options: { value: string; displayText: string }[];
    }[];
  } | null;
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
