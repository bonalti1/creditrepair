import { BUREAU_TEMPLATES } from "./bureauTemplates";
import { CREDITOR_COLLECTOR_TEMPLATES } from "./creditorCollectorTemplates";
import { IDENTITY_ACCESS_TEMPLATES } from "./identityAccessTemplates";
import { header, itemLines, signature as SIGNATURE, type LetterContext, type LetterTemplate } from "./parts";

// Letter generation (spec §4.2): rules engine + merge-field templates.
// Letters are written in first person BY THE USER — the user disputes, we provide
// the tool. Letters mail in English (bureau operational language); the UI that
// explains them is Spanish-first.
//
// This file is the home of the original ten templates, which the round engine
// uses by key. Their wording is unchanged. The wider library lives in the
// sibling *Templates.ts files and is merged into the one TEMPLATES map below;
// metadata for every template is in library.ts.

export type { LetterContext } from "./parts";

const ORIGINAL_TEMPLATES: Record<string, LetterTemplate> = {
  personal_info_cleanup: (ctx) =>
    header(ctx) +
    `Re: Request to update personal information on my credit file

To Whom It May Concern:

I am writing to request that you update the personal information on my credit file. The following entries are not accurate or no longer apply to me, and I ask that you remove them:

${itemLines(ctx.items, ctx.itemReasons)}

Please keep only my current, correct personal information on file and send me an updated copy of my credit report reflecting these corrections.
` +
    SIGNATURE(ctx),

  dispute_611_accounts: (ctx) =>
    header(ctx) +
    `Re: Dispute of inaccurate account information — FCRA Section 611

To Whom It May Concern:

I am exercising my right under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i) to dispute the following accounts on my credit report. I believe each item listed below is inaccurate, unverifiable, or outdated:

${itemLines(ctx.items, ctx.itemReasons)}

Please conduct a reasonable reinvestigation of each item, and delete or correct any information that cannot be verified as accurate and complete. Please send me written results of your reinvestigation and a free updated copy of my report if any change is made.
` +
    SIGNATURE(ctx),

  dispute_611_inquiries: (ctx) =>
    header(ctx) +
    `Re: Dispute of unauthorized or inaccurate inquiries — FCRA Section 611

To Whom It May Concern:

I dispute the following inquiries appearing on my credit report. I do not recognize them as authorized by me, or I believe they are being reported inaccurately:

${itemLines(ctx.items, ctx.itemReasons)}

Under FCRA Section 604, a consumer report may only be furnished with a permissible purpose. Please investigate whether each inquiry listed had a permissible purpose and remove any that did not, and confirm the results to me in writing.
` +
    SIGNATURE(ctx),

  dispute_611_public_records: (ctx) =>
    header(ctx) +
    `Re: Dispute of public record information — FCRA Section 611

To Whom It May Concern:

I dispute the following public record entries on my credit report as inaccurate, unverifiable, or outdated:

${itemLines(ctx.items, ctx.itemReasons)}

Please reinvestigate each entry under FCRA Section 611, identify the actual source of the record, and delete any entry that cannot be fully verified as accurate, complete, and within the allowed reporting period. Please send me the written results of your reinvestigation.
` +
    SIGNATURE(ctx),

  mov_request: (ctx) =>
    header(ctx) +
    `Re: Request for method of verification — FCRA Section 611(a)(6)(B)(iii)

To Whom It May Concern:

I previously disputed the items listed below and you reported them as "verified." Under FCRA Section 611(a)(6)(B)(iii), I am requesting a description of the procedure used to determine the accuracy and completeness of the disputed information, including the business name, address, and telephone number of each furnisher contacted:

${itemLines(ctx.items, ctx.itemReasons)}

If you cannot provide the method of verification, or the items cannot in fact be verified, please delete them and send me an updated copy of my credit report.
` +
    SIGNATURE(ctx),

  furnisher_direct: (ctx) =>
    header(ctx) +
    `Re: Direct dispute of inaccurate information you furnish — FCRA Section 623

To Whom It May Concern:

I am disputing, directly with you as the furnisher, the accuracy of the following information you report about me to consumer reporting agencies:

${itemLines(ctx.items, ctx.itemReasons)}

Under FCRA Section 623(a)(8) and 12 C.F.R. § 1022.43, you are required to conduct a reasonable investigation of this direct dispute. If you cannot verify the disputed information as accurate and complete, you must correct it or cease reporting it to all consumer reporting agencies, and notify me of the outcome.
` +
    SIGNATURE(ctx),

  debt_validation: (ctx) =>
    header(ctx) +
    `Re: Request for validation of debt — FDCPA Section 809(b)

To Whom It May Concern:

I am requesting validation of the debt(s) you claim I owe and which you report to consumer reporting agencies:

${itemLines(ctx.items, ctx.itemReasons)}

Under Section 809(b) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692g), I request that you provide: (1) proof that you own this debt or are authorized to collect it; (2) a complete accounting of the amount claimed, including the original creditor's name and account number; and (3) a copy of the original signed agreement creating the obligation.

Until this debt is validated, please cease reporting it to any consumer reporting agency, or report it as disputed as required by FCRA Section 623(a)(3). If you cannot validate it, please delete your reporting of it and confirm to me in writing.
` +
    SIGNATURE(ctx),

  identity_theft_block: (ctx) =>
    header(ctx) +
    `Re: Request to block information resulting from identity theft — FCRA Section 605B

To Whom It May Concern:

I am a victim of identity theft. The following items on my credit report resulted from transactions I did not make or authorize:

${itemLines(ctx.items, ctx.itemReasons)}

Under FCRA Section 605B (15 U.S.C. § 1681c-2), you must block the reporting of this information within four (4) business days of receiving this request. Enclosed are a copy of my identity theft report and proof of my identity.

Please confirm the block in writing and notify the furnishers of this information as required by law.
` +
    SIGNATURE(ctx),

  goodwill_adjustment: (ctx) =>
    header(ctx) +
    `Re: Goodwill request regarding late payment reporting

To Whom It May Concern:

I am writing about the following account(s), which I have maintained with you:

${itemLines(ctx.items, ctx.itemReasons)}

I am not disputing the accuracy of this information. I am respectfully asking, as a gesture of goodwill, that you remove the late payment notation(s), in light of my overall payment history and the circumstances at the time. I value my relationship with you, and this adjustment would meaningfully help as I work toward my financial goals.

Thank you for your time and consideration. I would appreciate a written response.
` +
    SIGNATURE(ctx),

  secondary_bureau_request: (ctx) =>
    header(ctx) +
    `Re: Request for consumer file disclosure — FCRA Section 609

To Whom It May Concern:

Under FCRA Section 609, I request a complete copy of my consumer file as maintained by your agency. Please include all information in my file at the time of my request and the sources of that information.

If my file contains information I believe to be inaccurate, unverifiable, or outdated, I intend to exercise my dispute rights under FCRA Section 611. Please also let me know your procedure for submitting disputes.
` +
    SIGNATURE(ctx),
};

/**
 * Letters that never print the consumer's dispute reason after an item, even
 * when one was given (LetterContext.itemReasons). A reason says the item is
 * inaccurate, so it belongs in a letter that disputes accuracy with a bureau or
 * a furnisher. It does not belong in:
 *   - a goodwill request, which says the information is accurate;
 *   - a settlement offer, an authorized-user removal or a request to stop
 *     contact, which dispute nothing;
 *   - a letter to a debt collector. Those ask for validation and must never
 *     acknowledge the debt; a reason such as "I paid or settled this account"
 *     could be read as doing so.
 * These letters list their items exactly as before reasons existed.
 */
export const TEMPLATES_WITHOUT_REASONS: ReadonlySet<string> = new Set([
  "goodwill_adjustment",
  "debt_validation",
  "creditor_settlement_offer",
  "creditor_authorized_user_removal",
  "collector_validation_30_day",
  "collector_validation_follow_up",
  "collector_cease_communication",
  "collector_dispute_while_validation_pending",
]);

/** True when this letter prints the consumer's reason after each item that has one. */
export function letterPrintsReasons(templateKey: string): boolean {
  return !TEMPLATES_WITHOUT_REASONS.has(templateKey);
}

const withoutReasons =
  (template: LetterTemplate): LetterTemplate =>
  (ctx) =>
    template({ ...ctx, itemReasons: undefined });

const ALL_TEMPLATES: Record<string, LetterTemplate> = {
  ...BUREAU_TEMPLATES,
  ...CREDITOR_COLLECTOR_TEMPLATES,
  ...IDENTITY_ACCESS_TEMPLATES,
  ...ORIGINAL_TEMPLATES,
};

/** Every letter template, original and library, by key. The originals always win a key clash. */
export const TEMPLATES: Record<string, LetterTemplate> = Object.fromEntries(
  Object.entries(ALL_TEMPLATES).map(([key, template]) => [
    key,
    TEMPLATES_WITHOUT_REASONS.has(key) ? withoutReasons(template) : template,
  ]),
);

/** The ten keys the round engine relies on. */
export const ORIGINAL_TEMPLATE_KEYS: readonly string[] = Object.keys(ORIGINAL_TEMPLATES);

export function renderLetter(templateKey: string, ctx: LetterContext): string {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown letter template: ${templateKey}`);
  return template(ctx);
}
