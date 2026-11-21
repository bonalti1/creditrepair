import { detailsParagraph, enclosedSentence, itemLines, letter, type LetterTemplate } from "./parts";

// Letters to a creditor or other furnisher, and to a debt collector.
//
// Same rules as the bureau letters: the consumer's own voice, only facts the
// client has stated, the law cited for what is asked and no further, no threats.
// Collector letters never acknowledge the debt.
//
// DRAFTS PENDING ATTORNEY REVIEW — see docs/LETTER-LIBRARY.md.

const SPECIFICS = "The specifics are as follows:";
const NOT_AN_ACKNOWLEDGMENT = "This letter is not an acknowledgment that I owe this debt.";

export const CREDITOR_COLLECTOR_TEMPLATES: Record<string, LetterTemplate> = {
  // ---- Creditor / furnisher -------------------------------------------------

  furnisher_after_bureau_verified: (ctx) =>
    letter(
      ctx,
      "Direct dispute of information you furnish, following a credit bureau dispute — FCRA Section 623(a)(8)",
      "I am writing to you directly as the company that furnishes the following information about me to consumer reporting agencies. I disputed this information with a consumer reporting agency, and it was reported back to me as verified. I continue to dispute it because it is not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      enclosedSentence(ctx),
      "Under Section 623(a)(8) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2) and 12 C.F.R. § 1022.43, I ask that you conduct a reasonable investigation of this dispute, review the information I have provided, and send me the results. If your records do not support the information as reported, please correct it with each consumer reporting agency to which you furnished it.",
      "While this dispute is open, please report the information as disputed, as Section 623(a)(3) provides.",
    ),

  furnisher_date_of_first_delinquency: (ctx) =>
    letter(
      ctx,
      "Direct dispute of the date of first delinquency you report — FCRA Section 623",
      "I am writing to dispute, directly with you as the furnisher, the date of first delinquency you report to consumer reporting agencies for the following account(s). The date being reported does not match my records and is not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      enclosedSentence(ctx),
      "Section 623(a)(5) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2) provides for a furnisher that reports an account placed for collection or charged off to report the month and year the delinquency began. That date determines how long the account may be reported under Section 605(c) (15 U.S.C. § 1681c).",
      "Under Section 623(a)(8) and 12 C.F.R. § 1022.43, I ask that you conduct a reasonable investigation, check the date against the account records, correct the date of first delinquency with each consumer reporting agency to which you furnish this account, and send me the results.",
    ),

  creditor_authorized_user_removal: (ctx) =>
    letter(
      ctx,
      "Request to be removed as an authorized user",
      "I am writing about the following account(s), on which I am listed as an authorized user. I am not the account holder, and I did not agree to be responsible for the debt on the account:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "I ask that you remove me as an authorized user, cancel any card issued in my name, and stop reporting the account under my name to the consumer reporting agencies. Please also ask the consumer reporting agencies to delete the account from my credit file.",
      enclosedSentence(ctx),
      "Please confirm in writing when this has been done.",
    ),

  creditor_settlement_offer: (ctx) =>
    letter(
      ctx,
      "Offer to resolve account",
      "I am writing about the following account(s):",
      itemLines(ctx.items, ctx.itemReasons),
      "I would like to resolve this matter, and I am writing to propose a settlement.",
      detailsParagraph(ctx, "My offer is as follows:") ||
        "Please tell me in writing the amount you would accept to resolve the account in full.",
      "If we reach an agreement, I ask that you consider updating what you report about this account to the consumer reporting agencies to show it as resolved, or asking them to delete your reporting of it. I understand that this is your decision. Please tell me in writing whether you are willing to do so as part of our agreement.",
      "This letter is an offer to settle. It is not an acknowledgment that I owe the amount claimed, and it is not a promise to pay unless we both agree to the terms in writing. I will send payment once I have your written agreement.",
      "Thank you for considering this offer. I look forward to your written reply.",
    ),

  // ---- Debt collector -------------------------------------------------------

  collector_validation_30_day: (ctx) =>
    letter(
      ctx,
      "Dispute of debt and request for verification — FDCPA Section 809(b)",
      "I received your notice about the debt(s) listed below, and I am sending you this letter within thirty days of receiving that notice. I dispute the debt, and I request verification of it under Section 809(b) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692g(b)):",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Please send me: (1) verification of the debt, including the amount claimed and how it was calculated; and (2) the name and address of the original creditor, if different from the current creditor.",
      "Section 809(b) provides for collection of a disputed debt to stop until verification is mailed to the consumer. If you report this debt to any consumer reporting agency, please report it as disputed.",
      NOT_AN_ACKNOWLEDGMENT,
    ),

  collector_validation_follow_up: (ctx) =>
    letter(
      ctx,
      "Follow-up: verification of debt not received — FDCPA Section 809(b)",
      "I am following up on a written dispute and request for verification that I sent you about the debt(s) listed below. I sent it within thirty days of receiving your first notice about the debt. I have not received verification:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, "For your reference:"),
      "Section 809(b) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692g(b)) provides for a debt collector that receives a timely written dispute to stop collection of the debt until verification is mailed to the consumer.",
      "I ask again that you send me verification of the debt and the name and address of the original creditor. If you are not able to verify the debt, please confirm in writing that you have closed your file, and ask each consumer reporting agency to which you reported the debt to delete your reporting of it.",
      enclosedSentence(ctx),
      "If this remains unresolved, I may ask the Consumer Financial Protection Bureau for help by submitting a complaint.",
      NOT_AN_ACKNOWLEDGMENT,
    ),

  collector_cease_communication: (ctx) =>
    letter(
      ctx,
      "Request to stop communication — FDCPA Section 805(c)",
      "I am writing about the debt(s) listed below, about which you have been contacting me:",
      itemLines(ctx.items, ctx.itemReasons),
      "Under Section 805(c) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692c(c)), I am notifying you in writing that I wish you to stop communicating with me about this debt.",
      "I understand that the Act allows you to contact me to confirm that you are ending your collection efforts, or to tell me about a specific remedy you may or intend to use.",
      NOT_AN_ACKNOWLEDGMENT,
    ),

  collector_dispute_while_validation_pending: (ctx) =>
    letter(
      ctx,
      "Disputed debt appearing on my credit report while verification is outstanding — FDCPA Section 809(b)",
      "I am writing about the debt(s) listed below. I sent you a written dispute and request for verification within thirty days of receiving your first notice about the debt. I have not received verification, and the debt appears on my credit report:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, "For your reference:"),
      "I continue to dispute this debt. I ask that you: (1) send me the verification described in Section 809(b) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692g(b)); (2) report the debt as disputed to each consumer reporting agency to which you furnish it, as Section 623(a)(3) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2) provides for information a consumer has disputed with the furnisher; and (3) correct or delete your reporting if your records do not support it.",
      enclosedSentence(ctx),
      "Please confirm in writing what you have done.",
      NOT_AN_ACKNOWLEDGMENT,
    ),
};
