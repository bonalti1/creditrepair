import { enclosedSentence, itemLines, letter, type LetterTemplate } from "./parts";

// Identity-theft letters, and requests about the consumer's own file: disclosure,
// free disclosures, and the prescreen opt-out.
//
// The identity-theft letters state that the consumer is a victim of identity
// theft (or suspects fraud). They are used ONLY when the client has said so and,
// for the furnisher notice, holds an identity theft report. A Section 609 letter
// asks for disclosure of the file and nothing else: Section 609 is not a way to
// have information taken off a report, and no letter here suggests it is.
//
// DRAFTS PENDING ATTORNEY REVIEW — see docs/LETTER-LIBRARY.md.

const IDENTIFY_ME = "If you need anything further to identify me, please let me know.";

export const IDENTITY_ACCESS_TEMPLATES: Record<string, LetterTemplate> = {
  // ---- Identity theft -------------------------------------------------------

  identity_fraud_alert: (ctx) =>
    letter(
      ctx,
      "Request for an initial fraud alert — FCRA Section 605A",
      "I am writing to ask that you place an initial fraud alert on my credit file. I suspect in good faith that I have been, or am about to become, a victim of fraud or identity theft.",
      "Section 605A(a) of the Fair Credit Reporting Act (15 U.S.C. § 1681c-1) provides for an initial fraud alert to be placed in a consumer's file for at least one year at the consumer's request, and for the request to be referred to the other nationwide consumer reporting agencies.",
      enclosedSentence(ctx),
      "Please confirm in writing that the alert has been placed, and tell me how to request the free copy of my file that is available with a fraud alert.",
      IDENTIFY_ME,
    ),

  identity_theft_furnisher_notice: (ctx) =>
    letter(
      ctx,
      "Notice of identity theft and request to stop reporting — FCRA Section 623(a)(6)",
      "I am a victim of identity theft. The following account(s) or debt(s), which you report in my name, resulted from identity theft. I did not open them, I did not use them, and I did not authorize them:",
      itemLines(ctx.items),
      "I have enclosed a copy of my identity theft report and proof of my identity.",
      "Section 623(a)(6)(B) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2) provides that when a consumer submits an identity theft report to a furnisher at the address the furnisher specifies for such reports, the furnisher may not furnish the information to any consumer reporting agency unless it later knows, or is informed by the consumer, that the information is correct.",
      "I ask that you stop reporting this information to the consumer reporting agencies, ask them to delete what you have already reported, and close the account(s). If this is not the address you use for identity theft reports, please tell me the correct one.",
      "Please confirm in writing what you have done.",
    ),

  // ---- File and access ------------------------------------------------------

  file_disclosure_609: (ctx) =>
    letter(
      ctx,
      "Request for disclosure of my consumer file — FCRA Section 609",
      "Under Section 609(a) of the Fair Credit Reporting Act (15 U.S.C. § 1681g), I request a complete disclosure of the information in my consumer file as of the date you receive this request, including the sources of the information and the identity of each person who obtained my consumer report during the period the Act covers.",
      enclosedSentence(ctx),
      "If a charge applies to this disclosure, please tell me the amount before you process my request.",
      IDENTIFY_ME,
    ),

  free_annual_disclosure_612: (ctx) =>
    letter(
      ctx,
      "Request for my free annual file disclosure — FCRA Section 612(a)",
      "Under Section 612(a) of the Fair Credit Reporting Act (15 U.S.C. § 1681j), I request the free disclosure of my consumer file that is available once in any 12-month period. I have not received a free annual disclosure from your agency in the past 12 months.",
      "Please send the disclosure described in Section 609 of the Act (15 U.S.C. § 1681g) to me at the address above.",
      enclosedSentence(ctx),
      "If you require this request to be made in another way, such as through a toll-free number or a request form, please tell me how.",
      IDENTIFY_ME,
    ),

  free_disclosure_adverse_action_612: (ctx) =>
    letter(
      ctx,
      "Request for a free file disclosure after an adverse action notice — FCRA Section 612(b)",
      "Within the past 60 days I received a notice that an action unfavorable to me, such as a denial of credit, insurance or employment, was taken based in whole or in part on a consumer report from your agency.",
      "Under Section 612(b) of the Fair Credit Reporting Act (15 U.S.C. § 1681j), I request a free disclosure of my consumer file, as described in Section 609 of the Act (15 U.S.C. § 1681g). Please send it to me at the address above.",
      enclosedSentence(ctx),
      IDENTIFY_ME,
    ),

  prescreen_opt_out: (ctx) =>
    letter(
      ctx,
      "Election to be excluded from prescreened offer lists — FCRA Section 604(e)",
      "Under Section 604(e) of the Fair Credit Reporting Act (15 U.S.C. § 1681b(e)), I elect to have my name and address excluded from any list you provide for offers of credit or insurance that I did not initiate, often called prescreened offers.",
      "I would like this election to stay in effect until I tell you otherwise. If you require a signed notice of election form for that, please send it to me at the address above.",
      enclosedSentence(ctx),
      "Please confirm in writing that my election has been recorded.",
      IDENTIFY_ME,
    ),
};
