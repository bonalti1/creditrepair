import type { ItemCategory } from "../domain/types";
import type { Bilingual } from "./library";

// Standard dispute reasons: the short list a client (or staff, with the client)
// picks from to say WHY an item is wrong. Each reason carries the one English,
// first-person sentence that can follow the item's line in a letter, and the
// template that fits it best.
//
// The client picks the reason when they mark an item as inaccurate (the review
// screens, through ux/disputeReason.ts), it is stored with their answer
// (item_flags.reason_code), and letters that dispute accuracy print its
// sentence on the item's line (parts.ts: itemLines). The round engine does not
// use `suggestedTemplate` yet: it still picks the template by category and stage.
// A reason is the client's own statement. Nobody picks one for them.

export type DisputeReasonCode =
  | "not_mine"
  | "never_late"
  | "wrong_balance"
  | "wrong_dates"
  | "duplicate"
  | "paid_or_settled"
  | "closed_by_me"
  | "in_bankruptcy"
  | "obsolete"
  | "mixed_file"
  | "unauthorized_inquiry"
  | "identity_theft"
  | "wrong_personal_info"
  | "other";

export interface DisputeReason {
  code: DisputeReasonCode;
  label: Bilingual;
  /** The kinds of report item this reason can apply to. */
  appliesTo: ItemCategory[];
  /** English, first person, one sentence: goes after the item's line in a letter. */
  sentence: string;
  /** The template that fits this reason best. */
  suggestedTemplate: string;
  /** Where the best template differs by item category. */
  templateByCategory?: Partial<Record<ItemCategory, string>>;
}

export const DISPUTE_REASONS: DisputeReason[] = [
  {
    code: "not_mine",
    label: { es: "Esta cuenta no es mía", en: "This account is not mine" },
    appliesTo: ["tradeline"],
    sentence: "This account is not mine; I did not open it and did not authorize anyone to open it in my name.",
    suggestedTemplate: "bureau_not_my_account",
  },
  {
    code: "never_late",
    label: { es: "Nunca pagué tarde", en: "I was never late" },
    appliesTo: ["tradeline"],
    sentence: "I made my payments on this account on time, and the late payments reported are not accurate.",
    suggestedTemplate: "bureau_never_late",
  },
  {
    code: "wrong_balance",
    label: { es: "El saldo o el límite de crédito está mal", en: "The balance or credit limit is wrong" },
    appliesTo: ["tradeline"],
    sentence: "The balance or credit limit reported for this account does not match my records and is not accurate.",
    suggestedTemplate: "bureau_wrong_balance",
  },
  {
    code: "wrong_dates",
    label: { es: "Las fechas están mal", en: "The dates are wrong" },
    appliesTo: ["tradeline", "public_record"],
    sentence: "One or more of the dates reported for this item do not match my records and are not accurate.",
    suggestedTemplate: "bureau_wrong_dates",
    templateByCategory: { public_record: "bureau_incorrect_public_record" },
  },
  {
    code: "duplicate",
    label: { es: "Aparece más de una vez", en: "It appears more than once" },
    appliesTo: ["tradeline"],
    sentence: "This account is reported more than once on my credit report.",
    suggestedTemplate: "bureau_duplicate_account",
  },
  {
    code: "paid_or_settled",
    label: { es: "Ya la pagué o la liquidé", en: "I already paid or settled it" },
    appliesTo: ["tradeline"],
    sentence: "I paid or settled this account, but it is still reported with a balance owing.",
    suggestedTemplate: "bureau_paid_or_settled",
  },
  {
    code: "closed_by_me",
    label: { es: "Yo cerré esta cuenta", en: "I closed this account myself" },
    appliesTo: ["tradeline"],
    sentence: "I closed this account at my own request, and that is not what is being reported.",
    suggestedTemplate: "bureau_closed_by_consumer",
  },
  {
    code: "in_bankruptcy",
    label: { es: "Se incluyó en mi bancarrota", en: "It was included in my bankruptcy" },
    appliesTo: ["tradeline"],
    sentence: "This debt was included in my bankruptcy case and discharged, but it is still reported with a balance owing.",
    suggestedTemplate: "bureau_included_in_bankruptcy",
  },
  {
    code: "obsolete",
    label: { es: "Es demasiado antigua para seguir en mi reporte", en: "It is too old to still be on my report" },
    appliesTo: ["tradeline", "public_record"],
    sentence: "Based on my records, this item is older than the period for which it may be reported.",
    suggestedTemplate: "bureau_obsolete_item",
  },
  {
    code: "mixed_file",
    label: { es: "Es de otra persona", en: "It belongs to someone else" },
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
    sentence: "This item does not belong to me; I believe it belongs to another person with a similar name or address.",
    suggestedTemplate: "bureau_mixed_file",
  },
  {
    code: "unauthorized_inquiry",
    label: { es: "No autoricé esta consulta", en: "I did not authorize this inquiry" },
    appliesTo: ["inquiry"],
    sentence: "I did not apply with this company or give it permission to obtain my credit report.",
    suggestedTemplate: "bureau_unauthorized_inquiry",
  },
  {
    code: "identity_theft",
    label: { es: "Es resultado de robo de identidad", en: "It is the result of identity theft" },
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
    sentence: "This item resulted from identity theft; I did not make or authorize the transaction.",
    suggestedTemplate: "identity_theft_block",
  },
  {
    code: "wrong_personal_info",
    label: { es: "Este dato personal está mal o ya no es mío", en: "This personal detail is wrong or no longer mine" },
    appliesTo: ["personal_info"],
    sentence: "This personal information is not accurate or no longer applies to me.",
    suggestedTemplate: "personal_info_cleanup",
  },
  {
    code: "other",
    label: { es: "Otro motivo", en: "Another reason" },
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
    sentence: "I believe this information is not accurate or not complete.",
    suggestedTemplate: "dispute_611_accounts",
    templateByCategory: {
      inquiry: "dispute_611_inquiries",
      public_record: "dispute_611_public_records",
      personal_info: "personal_info_cleanup",
    },
  },
];

const BY_CODE = new Map(DISPUTE_REASONS.map((reason) => [reason.code, reason]));

export function getDisputeReason(code: string): DisputeReason | undefined {
  return BY_CODE.get(code as DisputeReasonCode);
}

/** The reasons a client can give for an item of this category. */
export function reasonsFor(category: ItemCategory): DisputeReason[] {
  return DISPUTE_REASONS.filter((reason) => reason.appliesTo.includes(category));
}

/** The template that fits a reason for an item of this category. */
export function suggestedTemplateFor(reason: DisputeReason, category: ItemCategory): string {
  return reason.templateByCategory?.[category] ?? reason.suggestedTemplate;
}
