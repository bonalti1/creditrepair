// Text that a statute words itself. It is reproduced here in English exactly
// as the law is believed to read, and it must not be edited for style: not a
// comma. Everything else in the agreement is our draft (documents.ts).
//
// VERIFICATION STATUS — read this before relying on any of it.
//
// Checked on 2026-11-21. From the machine this was written on, the sites that
// publish the statutes could not be opened (uscode.house.gov,
// law.cornell.edu, govinfo.gov and statutes.capitol.texas.gov were outside
// the network allow-list), so NONE of these texts was compared word for word
// against an official source. Each was written from the statute as known and
// then checked only against fragments that a web search returned. What those
// fragments did and did not confirm is recorded per text below, and every
// text carries `verified: false`.
//
// Before any real client signs, the attorney (or the owner, with the official
// page open) compares each text against the source named in `compareWith`,
// and only then sets `verified: true` and bumps AGREEMENT_VERSION.

export interface StatuteText {
  citation: string;
  /** True only after a word-for-word comparison with an official source. */
  verified: boolean;
  /** The day the text was last looked at. */
  checkedOn: string;
  /** The official page to compare against. */
  compareWith: string;
  /** What has and has not been confirmed. */
  note: string;
}

export const CROA_DISCLOSURE: StatuteText & { heading: string; paragraphs: readonly string[]; contact: readonly string[] } = {
  citation: "15 U.S.C. §1679c(a)",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1679c",
  note:
    "Search fragments confirmed the heading, the opening words of the first sentence, 'You have a right to obtain a copy of your credit report from a credit bureau.', " +
    "'You have a right to sue a credit repair organization that violates the Credit Repair Organization Act.', the sentence that the Federal Trade Commission " +
    "regulates credit bureaus and credit repair organizations, and the address block. The remaining sentences were not confirmed word for word.",
  heading: "Consumer Credit File Rights Under State and Federal Law",
  paragraphs: [
    "You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. However, neither you nor any \"credit repair\" company or credit repair organization has the right to have accurate, current, and verifiable information removed from your credit report. The credit bureau must remove accurate, negative information from your report only if it is over 7 years old. Bankruptcy information can be reported for 10 years.",
    "You have a right to obtain a copy of your credit report from a credit bureau. You may be charged a reasonable fee. There is no fee, however, if you have been turned down for credit, employment, insurance, or a rental dwelling because of information in your credit report within the preceding 60 days. The credit bureau must provide someone to help you interpret the information in your credit file. You are entitled to receive a free copy of your credit report if you are unemployed and intend to apply for employment in the next 60 days, if you are a recipient of public welfare assistance, or if you have reason to believe that there is inaccurate information in your credit report due to fraud.",
    "You have a right to sue a credit repair organization that violates the Credit Repair Organization Act. This law prohibits deceptive practices by credit repair organizations.",
    "You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.",
    "Credit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate. However, mistakes may occur.",
    "You may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file. The credit bureau must then reinvestigate and modify or remove inaccurate or incomplete information. The credit bureau may not charge any fee for this service. Any pertinent information and copies of all documents you have concerning an error should be given to the credit bureau.",
    "If the credit bureau's reinvestigation does not resolve the dispute to your satisfaction, you may send a brief statement to the credit bureau, to be kept in your file, explaining why you think the record is inaccurate. The credit bureau must include a summary of your statement about disputed information with any report it issues about you.",
    "The Federal Trade Commission regulates credit bureaus and credit repair organizations. For more information contact:",
  ],
  contact: ["The Public Reference Branch", "Federal Trade Commission", "Washington, D.C. 20580"],
};

/**
 * The sentence the contract must carry in bold type, in immediate proximity to
 * the space reserved for the consumer's signature.
 */
export const CROA_CONTRACT_CANCEL_SENTENCE: StatuteText & { text: string } = {
  citation: "15 U.S.C. §1679d(b)(4)",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1679d",
  note: "As given by the owner in the build brief and as the statute is known to read. Not compared against the official page.",
  text:
    "You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.",
};

/**
 * The cancellation form that accompanies the contract, in duplicate, under the
 * heading "Notice of Cancellation", in bold face type. The three bracketed
 * slots are the statute's; the documents fill them in.
 *
 * The form says "3rd day", where §1679d(b)(4) and §1679e(a) say "3rd business
 * day". That difference is in the statute. The date written into the form is
 * the business-day deadline (the later one). Question 2 for the attorney.
 */
export const CROA_CANCELLATION_FORM: StatuteText & {
  heading: string;
  statement: string;
  /** Call with the three slots filled. */
  howTo: (name: string, address: string, date: string) => string;
  closing: string;
  dateLabel: string;
  signatureLabel: string;
} = {
  citation: "15 U.S.C. §1679e(b)",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1679e",
  note:
    "Search fragments confirmed the heading, the first sentence with '3rd day which begins after the date the contract is signed by you', " +
    "'or any other written notice to [ name of credit repair organization ] at [ address of credit repair organization ] before midnight on [ date ]' " +
    "and 'I hereby cancel this transaction'. Punctuation and line layout were not confirmed.",
  heading: "Notice of Cancellation",
  statement:
    "You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.",
  howTo: (name, address, date) =>
    `To cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice to ${name} at ${address} before midnight on ${date}`,
  closing: "I hereby cancel this transaction,",
  dateLabel: "date",
  signatureLabel: "purchaser's signature",
};

/** Texas: the statement the contract must carry next to the signature space. */
export const TEXAS_CONTRACT_CANCEL_SENTENCE: StatuteText & { text: string } = {
  citation: "Tex. Fin. Code §393.202(a)",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm#393.202",
  note:
    "A search fragment from a republication of the Texas code confirmed the first sentence. The second sentence and whether the current text matches were not confirmed.",
  text:
    "You, the buyer, may cancel this contract at any time before midnight of the third day after the date of the transaction. See the attached notice of cancellation form for an explanation of this right.",
};

/** Texas: the cancellation notice, two detachable copies attached to the contract, in boldfaced type. */
export const TEXAS_CANCELLATION_FORM: StatuteText & {
  heading: string;
  statement: string;
  refund: string;
  howTo: (name: string, address: string, date: string) => string;
  closing: string;
  dateLabel: string;
  signatureLabel: string;
} = {
  citation: "Tex. Fin. Code §393.202(b)",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm#393.202",
  note:
    "Search fragments confirmed 'two easily detachable copies of a cancellation notice', 'within three days after the date the contract is signed' " +
    "and 'within 10 days after the date of receipt by the seller'. The layout of the name, address and date lines was not confirmed.",
  heading: "Notice of Cancellation",
  statement: "You may cancel this contract, without any penalty or obligation, within three days after the date the contract is signed.",
  refund:
    "If you cancel, any payment made by you under this contract will be returned within 10 days after the date of receipt by the seller of your cancellation notice.",
  howTo: (name, address, date) =>
    `To cancel this contract, mail or deliver a signed dated copy of this cancellation notice, or other written notice, to: ${name} at ${address} not later than midnight ${date}`,
  closing: "I hereby cancel this transaction.",
  dateLabel: "date",
  signatureLabel: "purchaser's signature",
};

/**
 * What Tex. Fin. Code §393.105 requires the Texas disclosure statement to
 * contain, as understood when this was written. This is a list of topics, not
 * statutory wording: the statement itself is our draft, built on this list.
 * Not verified against the official text (search fragments confirmed only the
 * section's opening words, the last item and part of the one before it).
 */
export const TEXAS_DISCLOSURE_REQUIREMENTS: StatuteText & { items: readonly string[] } = {
  citation: "Tex. Fin. Code §393.105",
  verified: false,
  checkedOn: "2026-11-21",
  compareWith: "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm#393.105",
  note:
    "Search fragments confirmed that the document must be given before a contract is executed or anything of value is received, that it ends with " +
    "'a complete and accurate statement of the availability of nonprofit credit counseling services', that an earlier item concerns a consumer reporting agency " +
    "being prevented from issuing a report containing obsolete information, and that a signed copy is kept for two years (§393.106). " +
    "Items 1 to 7 are from the statute as known and were not confirmed.",
  items: [
    "A complete and detailed description of the services to be performed and their total cost.",
    "An explanation of the consumer's right to proceed against the surety bond or account.",
    "The name and address of the surety company that issued the bond (or of the depository, trustee and account number of a surety account).",
    "A complete and accurate statement of the consumer's right to review any file a consumer reporting agency keeps on them, under the Fair Credit Reporting Act.",
    "A statement that the file is available for review at no charge on request made not later than the 30th day after notice that credit was denied, and for a minimal charge at any other time.",
    "A complete and accurate statement of the consumer's right to dispute directly with a consumer reporting agency the completeness or accuracy of an item in their file.",
    "A statement that accurate information cannot be permanently removed from the files of a consumer reporting agency.",
    "A complete and accurate statement of when consumer information becomes obsolete and when a consumer reporting agency is prevented from issuing a report containing it.",
    "A complete and accurate statement of the availability of nonprofit credit counseling services.",
  ],
};

export const STATUTE_TEXTS = {
  croaDisclosure: CROA_DISCLOSURE,
  croaContractCancelSentence: CROA_CONTRACT_CANCEL_SENTENCE,
  croaCancellationForm: CROA_CANCELLATION_FORM,
  texasContractCancelSentence: TEXAS_CONTRACT_CANCEL_SENTENCE,
  texasCancellationForm: TEXAS_CANCELLATION_FORM,
  texasDisclosureRequirements: TEXAS_DISCLOSURE_REQUIREMENTS,
} as const;
