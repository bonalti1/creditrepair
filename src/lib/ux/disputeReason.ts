import type { ItemCategory } from "../domain/types";
import { DISPUTE_REASONS, getDisputeReason, reasonsFor, type DisputeReason, type DisputeReasonCode } from "../letters/reasons";
import type { Locale } from "../i18n/dictionaries";

// The reason a customer gives when they say an item is inaccurate.
//
// A reason is the customer's own statement, chosen from the standard list
// (letters/reasons.ts) and printed in their letter. These are the rules both
// review screens share: which reasons are offered for an item, what must be
// filled in before the confirm button works, and how a stored code is read
// back. Nothing here picks a reason: the list is shown in the catalogue's
// order, with none selected.

const CODES: ReadonlySet<string> = new Set(DISPUTE_REASONS.map((reason) => reason.code));

/** True for a code in the catalogue. Anything else (a typo, a retired code) is treated as no reason. */
export function isDisputeReasonCode(value: unknown): value is DisputeReasonCode {
  return typeof value === "string" && CODES.has(value);
}

/** True when the reason is in the catalogue and can be given for this kind of item. */
export function reasonApplies(code: unknown, category: ItemCategory): code is DisputeReasonCode {
  return isDisputeReasonCode(code) && reasonsFor(category).some((reason) => reason.code === code);
}

/** The reasons offered for an item, in the catalogue's order. */
export function reasonChoices(category: ItemCategory): DisputeReason[] {
  return reasonsFor(category);
}

export interface DisputeDraft {
  /** The standard reason picked, or null while none is. */
  reasonCode: string | null;
  /** The customer's own words. Optional, except with "other". */
  note: string;
  /** The attestation checkbox. */
  attested: boolean;
}

/** The form as it opens: no reason selected, nothing written, the box unchecked. */
export const EMPTY_DRAFT: DisputeDraft = { reasonCode: null, note: "", attested: false };

/** What is still missing before "confirm" may be pressed, in the order the form asks for it. */
export type ConfirmBlocker = "reason" | "note" | "attestation";

export function confirmBlockers(category: ItemCategory, draft: DisputeDraft): ConfirmBlocker[] {
  const blockers: ConfirmBlocker[] = [];
  if (!reasonApplies(draft.reasonCode, category)) blockers.push("reason");
  // "Another reason" says nothing by itself: the customer has to say what it is.
  else if (draft.reasonCode === "other" && draft.note.trim().length === 0) blockers.push("note");
  if (!draft.attested) blockers.push("attestation");
  return blockers;
}

/** The confirm button works only with a reason, a note when the reason is "other", and the attestation. */
export function canConfirmDispute(category: ItemCategory, draft: DisputeDraft): boolean {
  return confirmBlockers(category, draft).length === 0;
}

/** The reason's label in the customer's language, or null for no reason or an unknown code. */
export function reasonLabel(code: string | null | undefined, locale: Locale): string | null {
  const reason = code ? getDisputeReason(code) : undefined;
  return reason ? reason.label[locale] : null;
}

/** The English sentence a reason adds to the item's line in a letter, or null. */
export function reasonSentence(code: string | null | undefined): string | null {
  const reason = code ? getDisputeReason(code) : undefined;
  return reason ? reason.sentence : null;
}

/**
 * Fingerprint → reason code for the letters, from confirmed answers. Only a
 * code that is in the catalogue is passed on; an answer confirmed before
 * reasons existed has none and its letter line carries no reason.
 */
export function itemReasonsFrom(
  answers: Readonly<Record<string, { reasonCode?: string | null } | undefined>>,
): Record<string, DisputeReasonCode> {
  const reasons: Record<string, DisputeReasonCode> = {};
  for (const [fingerprint, answer] of Object.entries(answers)) {
    if (answer && isDisputeReasonCode(answer.reasonCode)) reasons[fingerprint] = answer.reasonCode;
  }
  return reasons;
}
