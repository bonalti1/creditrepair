import { detailsParagraph, enclosedSentence, itemLines, letter, type LetterTemplate } from "./parts";

// Letters to a consumer reporting agency: disputes by reason, and follow-ups.
//
// Every letter is the consumer's own, in the first person. A letter states a
// fact only when the catalogue entry for it (library.ts, `requiresFacts`) says
// the client has stated that fact. The law is cited for what is being asked and
// no further: these letters ask, they do not threaten or accuse.
//
// DRAFTS PENDING ATTORNEY REVIEW — see docs/LETTER-LIBRARY.md.

const RESULTS = "Please send me the written results of your reinvestigation.";
const SPECIFICS = "The specifics are as follows:";

export const BUREAU_TEMPLATES: Record<string, LetterTemplate> = {
  // ---- Disputes by reason ---------------------------------------------------

  bureau_not_my_account: (ctx) =>
    letter(
      ctx,
      "Dispute of account that does not belong to me — FCRA Section 611",
      "I am writing to dispute the following account(s) on my credit report. These accounts are not mine. I did not open them, and I did not authorize anyone to open them in my name:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each account listed, including asking the company that reported it for the records that connect the account to me. If an account cannot be verified as mine, please delete it from my file.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_never_late: (ctx) =>
    letter(
      ctx,
      "Dispute of late payments reported in error — FCRA Section 611",
      "I am writing to dispute the payment history reported for the following account(s). My credit report shows one or more late payments on these accounts. I made those payments on time, and the late payments being reported are not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of the payment history for each account listed and correct it to show the payments as made on time. If the late payments cannot be verified, please delete them from the payment history.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_wrong_balance: (ctx) =>
    letter(
      ctx,
      "Dispute of incorrect balance or credit limit — FCRA Section 611",
      "I am writing to dispute the amounts reported for the following account(s). The balance, the credit limit, or the past-due amount shown on my credit report does not match my records and is not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of the amounts reported for each account listed and correct them. If an amount cannot be verified as accurate, please correct or delete it.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_wrong_dates: (ctx) =>
    letter(
      ctx,
      "Dispute of incorrect dates — FCRA Section 611",
      "I am writing to dispute one or more dates reported for the following account(s). The date opened, the date of last payment, the date of first delinquency, or the date closed shown on my credit report does not match my records and is not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of the dates reported for each account listed, including the date of first delinquency, and correct them. If a date cannot be verified as accurate, please correct or delete it.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_duplicate_account: (ctx) =>
    letter(
      ctx,
      "Dispute of account reported more than once — FCRA Section 611",
      "I am writing to dispute the following entries on my credit report. They refer to one and the same account, but they are reported as if they were separate accounts, so the same debt is counted more than once:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of these entries, keep a single accurate entry for the account, and delete the duplicate reporting.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_paid_or_settled: (ctx) =>
    letter(
      ctx,
      "Dispute of paid account reported as owing — FCRA Section 611",
      "I am writing to dispute the status and balance reported for the following account(s). I paid each of these accounts in full, or resolved it through a settlement agreed with the creditor, but my credit report still shows a balance owing or an amount past due:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each account listed and correct it to show a zero balance and its paid or settled status. If the balance being reported cannot be verified, please correct or delete it.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_closed_by_consumer: (ctx) =>
    letter(
      ctx,
      "Dispute of account status: closed at my request — FCRA Section 611",
      "I am writing to dispute the status reported for the following account(s). I closed each of these accounts at my own request. My credit report does not show that; it shows the account as open or as closed by the creditor:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each account listed and correct its status to show that it was closed at the consumer's request.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_included_in_bankruptcy: (ctx) =>
    letter(
      ctx,
      "Dispute of account discharged in bankruptcy — FCRA Section 611",
      "I am writing to dispute the status and balance reported for the following account(s). These debts were included in my bankruptcy case and were discharged. My credit report still shows a balance owing, an amount past due, or a status that does not reflect the bankruptcy:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each account listed and correct it to show a zero balance and that it was included in bankruptcy.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_obsolete_item: (ctx) =>
    letter(
      ctx,
      "Dispute of information past its reporting period — FCRA Sections 605 and 611",
      "I am writing to dispute the following item(s) on my credit report. Based on my records, each one is older than the period for which it may be reported:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Section 605 of the Fair Credit Reporting Act (15 U.S.C. § 1681c) limits how long most adverse information may appear in a consumer report, in most cases to seven years. For an account placed for collection or charged off, Section 605(c) measures that period from 180 days after the start of the delinquency that led to the collection or charge-off.",
      "Under Section 611 of the Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of the dates reported for each item listed, including the date of first delinquency, and delete any item that is past its reporting period.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_mixed_file: (ctx) =>
    letter(
      ctx,
      "Dispute of another person's information in my file — FCRA Section 611",
      "I am writing because my credit file contains information that is not mine. The following item(s) do not belong to me. I believe they belong to another person and were placed in my file because that person has a name, address, or identifying number similar to mine:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each item listed and delete from my file every item that cannot be verified as mine. I also ask that you review the identifying information used to match these items to my file, so that another person's information is not added to it again.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_unauthorized_inquiry: (ctx) =>
    letter(
      ctx,
      "Dispute of inquiries I did not authorize — FCRA Sections 604 and 611",
      "I am writing to dispute the following inquiries on my credit report. I did not apply for credit or any other product with these companies, and I did not give them permission to obtain my credit report:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Section 604 of the Fair Credit Reporting Act (15 U.S.C. § 1681b) allows a consumer report to be furnished only for a permissible purpose. Under Section 611 of the Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each inquiry listed, including asking the company that made it for its purpose, and delete from my file any inquiry that cannot be verified as made for a permissible purpose.",
      RESULTS,
    ),

  bureau_incorrect_public_record: (ctx) =>
    letter(
      ctx,
      "Dispute of incorrect public record information — FCRA Section 611",
      "I am writing to dispute the following public record information on my credit report. What you are reporting does not match the record of the court or agency, for example in its status, its filing or disposition date, or its amount, and it is not accurate:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each entry listed by checking it against the current record of the court or agency, and correct it. If an entry cannot be verified as accurate and complete, please delete it.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  bureau_medical_collection: (ctx) =>
    letter(
      ctx,
      "Dispute of medical collection account — FCRA Section 611",
      "I am writing to dispute the following collection account(s) on my credit report, which are for medical bills. The amount being reported is not accurate. All or part of each bill was paid by my health insurance or by me, and the balance being reported does not reflect those payments:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, SPECIFICS),
      "Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask that you conduct a reasonable reinvestigation of each account listed, including the amount, and correct it. If the amount being reported cannot be verified as accurate, please correct or delete the account.",
      enclosedSentence(ctx),
      RESULTS,
    ),

  // ---- Follow-ups -----------------------------------------------------------

  bureau_reinvestigation_procedure: (ctx) =>
    letter(
      ctx,
      "Request for description of the reinvestigation procedure — FCRA Section 611(a)(7)",
      "I disputed the item(s) listed below, and you reported the results of your reinvestigation to me as verified:",
      itemLines(ctx.items, ctx.itemReasons),
      "Under Section 611(a)(7) of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I request a description of the procedure used to determine the accuracy and completeness of this information, including the business name and address of each furnisher contacted in connection with it, and the furnisher's telephone number if reasonably available. Section 611(a)(7) provides for this description to be sent within 15 days after the request is received.",
      "If, in preparing the description, you find that any of this information was not in fact verified, I ask that you correct or delete it and send me an updated copy of my credit report.",
      enclosedSentence(ctx),
    ),

  bureau_no_response: (ctx) =>
    letter(
      ctx,
      "Follow-up: no results received for my dispute — FCRA Section 611",
      "I am following up on a written dispute I mailed to you about the item(s) listed below. More than 30 days have passed since you received it, and I have not received the results of your reinvestigation:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, "For your reference:"),
      "Section 611(a)(1) of the Fair Credit Reporting Act (15 U.S.C. § 1681i) provides for a reinvestigation to be completed within 30 days after the agency receives the dispute, with a limited extension in some cases, and Section 611(a)(6) provides for written notice of the results within five business days after the reinvestigation is completed.",
      "I ask that you complete the reinvestigation, send me the written results, and correct or delete any information that was not verified.",
      enclosedSentence(ctx),
      "If this remains unresolved, I may ask the Consumer Financial Protection Bureau for help by submitting a complaint.",
    ),

  bureau_frivolous_response: (ctx) =>
    letter(
      ctx,
      "Response to your notice about my dispute, with additional information — FCRA Section 611(a)(3)",
      "You notified me that you would not reinvestigate my dispute of the item(s) listed below because you considered it frivolous or irrelevant. This dispute is mine, I am making it in good faith, and I am writing to give you the information you need to investigate it:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, "The specific information I dispute, and why, is as follows:"),
      enclosedSentence(ctx),
      "Section 611(a)(3) of the Fair Credit Reporting Act (15 U.S.C. § 1681i) provides that a notice of this kind give the reasons for the determination and identify any information required to investigate the disputed information. If you still need something more from me, please tell me exactly what it is.",
      "With this additional information, I ask that you conduct a reasonable reinvestigation of each item listed under Section 611 and send me the written results.",
    ),

  bureau_consumer_statement: (ctx) =>
    letter(
      ctx,
      "Request to add a consumer statement to my file — FCRA Section 611(b)",
      "I disputed the item(s) listed below, and your reinvestigation did not resolve my dispute:",
      itemLines(ctx.items, ctx.itemReasons),
      "Under Section 611(b) of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I am filing a brief statement that describes the nature of my dispute, and I ask that you add it to my file.",
      detailsParagraph(ctx, "My statement is:") ||
        "Please tell me how you would like to receive the wording of my statement, or send me any form you use for this purpose.",
      "Section 611(c) provides for the statement, or a clear and accurate summary of it, to be included in any later consumer report that contains the disputed information. Please confirm in writing that my statement has been added.",
    ),

  bureau_reinsertion_notice: (ctx) =>
    letter(
      ctx,
      "Previously deleted information has reappeared — FCRA Section 611(a)(5)(B)",
      "I am writing about the item(s) listed below. They were deleted from my credit file after I disputed them. They now appear on my credit report again, and I did not receive written notice from you that they had been put back:",
      itemLines(ctx.items, ctx.itemReasons),
      detailsParagraph(ctx, "For your reference:"),
      "Section 611(a)(5)(B) of the Fair Credit Reporting Act (15 U.S.C. § 1681i) provides that information deleted after a reinvestigation may be reinserted only if the company that furnished it certifies that it is complete and accurate, and that the consumer be notified in writing within five business days after the reinsertion.",
      "I ask that you send me that notice, including the name and address of the company that furnished the information and its telephone number if reasonably available. I also dispute the reinserted information under Section 611 and ask that you conduct a reasonable reinvestigation of it. If it cannot be verified as accurate and complete, please delete it.",
      enclosedSentence(ctx),
      RESULTS,
    ),
};
