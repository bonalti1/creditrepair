import type { LetterTargetType } from "../domain/types";
import { getLetterMeta, type LetterCategory, type LetterRecipient } from "../letters/library";
import type { MailClass } from "./types";

// Which mail class a letter goes by, unless staff choose otherwise for a round.
//
// The setting is per kind of letter (the library's categories). A first
// dispute to a bureau goes first class: the bureau's own records show when it
// arrived, and the next report shows the answer. Letters whose proof of
// delivery may matter later go certified: a follow-up that says the bureau
// already had 30 days (method of verification, no response, reinsertion),
// anything to a furnisher or a debt collector (the §623 direct dispute and the
// FDCPA §809(b) validation request both run from receipt), and identity theft
// letters (FCRA §605B gives the bureau 4 business days from receipt).
//
// Staff can change the class of any letter on the send screen before the
// round goes out. A return receipt is never the default: it costs more and
// the certified tracking already records the delivery date.

export const MAIL_CLASS_DEFAULTS: Record<LetterCategory, MailClass> = {
  bureau_dispute: "first_class",
  inquiries: "first_class",
  personal_information: "first_class",
  file_access: "first_class",
  bureau_follow_up: "certified",
  creditor: "certified",
  collector: "certified",
  identity_theft: "certified",
};

/** Letters to these recipients go certified whatever their category says. */
const CERTIFIED_RECIPIENTS: ReadonlySet<LetterRecipient | LetterTargetType> = new Set(["furnisher", "collector"]);

/** The default class for one letter, from its template and who it goes to. */
export function defaultMailClass(templateKey: string, recipientType?: LetterTargetType): MailClass {
  if (recipientType && CERTIFIED_RECIPIENTS.has(recipientType)) return "certified";
  const meta = getLetterMeta(templateKey);
  if (!meta) return "first_class";
  if (CERTIFIED_RECIPIENTS.has(meta.recipient)) return "certified";
  return MAIL_CLASS_DEFAULTS[meta.category];
}

/** True for the classes USPS tracks door to door and that carry a tracking number. */
export function isCertified(mailClass: MailClass): boolean {
  return mailClass === "certified" || mailClass === "certified_return_receipt";
}

export const MAIL_CLASS_LABEL: Record<MailClass, { es: string; en: string; short: { es: string; en: string } }> = {
  first_class: {
    es: "Primera clase",
    en: "First class",
    short: { es: "Primera clase", en: "First class" },
  },
  certified: {
    es: "Certificada",
    en: "Certified",
    short: { es: "Certificada", en: "Certified" },
  },
  certified_return_receipt: {
    es: "Certificada con acuse de recibo electrónico",
    en: "Certified with electronic return receipt",
    short: { es: "Certificada + acuse", en: "Certified + receipt" },
  },
};

export function isMailClass(value: unknown): value is MailClass {
  return value === "first_class" || value === "certified" || value === "certified_return_receipt";
}
