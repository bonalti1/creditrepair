import type { Bureau, LetterTarget } from "./types";

// Where dispute letters are mailed. A wrong address means a lost letter and a
// wasted 30-day clock, so every entry records when it was last checked and
// against what.
//
// HOW THESE WERE CHECKED (2026-11-19): by web search, reading the passages the
// search returned from each company's own site and from the CFPB's list of
// consumer reporting companies. The sites themselves could not be opened
// directly from the build environment. That is good evidence, not a guarantee:
// before the first real mailing, and at least twice a year after, a person
// should open each `source` link and compare. Update `verifiedOn` when they do.
//
// Dispute addresses are not the same as each company's freeze, fraud-alert or
// opt-out addresses; only the dispute address belongs here.

export const PRIMARY_BUREAUS: Record<Bureau, LetterTarget> = {
  equifax: {
    type: "bureau",
    key: "equifax",
    name: "Equifax Information Services LLC",
    addressLines: ["P.O. Box 740256", "Atlanta, GA 30374-0256"],
    verifiedOn: "2026-11-19",
    source: "https://www.equifax.com/personal/help/mail-in-credit-report-dispute",
  },
  experian: {
    type: "bureau",
    key: "experian",
    name: "Experian",
    addressLines: ["P.O. Box 4500", "Allen, TX 75013"],
    verifiedOn: "2026-11-19",
    source: "https://www.experian.com/disputes/experian-mailing-address.html",
  },
  transunion: {
    type: "bureau",
    key: "transunion",
    name: "TransUnion Consumer Solutions",
    addressLines: ["P.O. Box 2000", "Chester, PA 19016-2000"],
    verifiedOn: "2026-11-19",
    source: "https://www.transunion.com/customer-support/dispute-by-mail",
  },
};

// Secondary bureaus (spec §4.2): scoping beyond the big three is the Dispute
// Beast differentiation we duplicate. Only companies whose address could be
// confirmed are mailed.
export const SECONDARY_BUREAUS: LetterTarget[] = [
  {
    type: "secondary_bureau",
    key: "lexisnexis",
    // SageStream is now part of LexisNexis and uses this same Consumer Center,
    // so one letter covers both files.
    name: "LexisNexis Risk Solutions Consumer Center (including SageStream)",
    addressLines: ["P.O. Box 105108", "Atlanta, GA 30348-5108"],
    verifiedOn: "2026-11-19",
    source:
      "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/companies-list/lexis-nexis-risk-solutions/",
  },
  {
    type: "secondary_bureau",
    key: "innovis",
    name: "Innovis Consumer Assistance",
    // Was P.O. Box 1689, Pittsburgh in the first draft; neither Innovis nor the
    // CFPB lists that box for disputes today.
    addressLines: ["P.O. Box 530088", "Atlanta, GA 30353-0088"],
    verifiedOn: "2026-11-19",
    source:
      "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/companies-list/innovis/",
  },
  {
    type: "secondary_bureau",
    key: "credco",
    // CoreLogic rebranded as Cotality; Credco kept its consumer P.O. box.
    name: "Credco Consumer Services Department (Cotality)",
    addressLines: ["P.O. Box 509124", "San Diego, CA 92150"],
    verifiedOn: "2026-11-19",
    source: "https://www.cotality.com/support/credco-consumer-assistance",
  },
  {
    type: "secondary_bureau",
    key: "clarity",
    // Owned by Experian. Was P.O. Box 5717, Clearwater in the first draft; the
    // company and the CFPB now list the Allen, TX box.
    name: "Clarity Services, Inc. — Consumer Support Division",
    addressLines: ["P.O. Box 16", "Allen, TX 75013"],
    verifiedOn: "2026-11-19",
    source:
      "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/companies-list/clarity-services/",
  },
];

// Looked for and NOT confirmed. Nothing is mailed to these until someone finds
// a current address on the company's own site or the CFPB list and moves the
// entry up with a `verifiedOn` date.
export const UNVERIFIED_BUREAUS: Array<{ key: string; name: string; note: string }> = [
  {
    key: "ars",
    name: "Advanced Resolution Services (ARS)",
    note: "First draft had 5005 Rockside Road, Suite 600, Independence, OH 44131. No current source found on 2026-11-19.",
  },
];

export const ALL_BUREAU_KEYS = Object.keys(PRIMARY_BUREAUS) as Bureau[];
