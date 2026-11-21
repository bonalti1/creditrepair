"use client";

import { useId } from "react";
import type { ItemCategory } from "@/lib/domain/types";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { confirmBlockers, EMPTY_DRAFT, reasonChoices, type DisputeDraft } from "@/lib/ux/disputeReason";
import { useLocale } from "@/lib/i18n";
import { InfoNote } from "@/components/RoundNotes";

// What a customer fills in after "I believe it's inaccurate", the same on both
// review screens: the reason (required), their own words (optional, required
// with "another reason"), and the attestation checkbox.
//
// The reasons are the catalogue's, in the catalogue's order, for this kind of
// item. None is selected to begin with and all look the same: the customer
// states the reason, the screen does not suggest one. The attestation text is
// the legal one, unchanged, and still gates the confirm button (see
// canConfirmDispute, which the screens use for the button).

export { EMPTY_DRAFT };

export default function DisputeFields({
  category,
  draft,
  onChange,
}: {
  category: ItemCategory;
  draft: DisputeDraft;
  onChange: (next: DisputeDraft) => void;
}) {
  const { locale, d } = useLocale();
  const id = useId();
  const choices = reasonChoices(category);
  const blockers = confirmBlockers(category, draft);
  const other = draft.reasonCode === "other";
  const hint = blockers.includes("reason") ? d.items.reasonRequired : blockers.includes("note") ? d.items.otherNeedsNote : null;

  return (
    <div>
      <fieldset data-testid="reason-picker" className="min-w-0">
        <legend className="text-[17px] font-semibold leading-snug text-slate-900">{d.items.reasonTitle}</legend>
        <p className="mt-1 text-[14px] leading-snug text-slate-600">{d.items.reasonHelp}</p>
        <div className="mt-3 grid gap-2">
          {choices.map((choice) => (
            <label
              key={choice.code}
              data-reason={choice.code}
              className="pressable flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3 text-[16px] leading-snug text-slate-900 has-[:checked]:bg-blue-50 has-[:checked]:ring-2 has-[:checked]:ring-blue-700 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700"
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={choice.code}
                checked={draft.reasonCode === choice.code}
                onChange={() => onChange({ ...draft, reasonCode: choice.code })}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-400 bg-white peer-checked:border-blue-700 [&>span]:opacity-0 peer-checked:[&>span]:opacity-100"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-blue-700" />
              </span>
              <span className="min-w-0 break-words">{choice.label[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {draft.reasonCode === "identity_theft" && (
        <InfoNote testId="identity-theft-note" className="mt-3">
          {d.items.identityTheftNote}
        </InfoNote>
      )}

      <label htmlFor={`${id}-note`} className="mt-5 block text-[15px] font-medium leading-snug text-slate-900">
        {other ? d.items.detailsLabelOther : d.items.detailsLabel}
      </label>
      <textarea
        id={`${id}-note`}
        value={draft.note}
        onChange={(e) => onChange({ ...draft, note: e.target.value })}
        placeholder={d.items.detailsPlaceholder}
        maxLength={500}
        rows={3}
        className="mt-2 block w-full resize-none rounded-2xl bg-slate-100 px-4 py-3 text-[16px] leading-snug text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
      />
      <p className="mt-1.5 text-[13px] leading-snug text-slate-500">{d.items.detailsNote}</p>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-blue-50 p-4 text-[15px] leading-snug text-slate-900">
        <input
          type="checkbox"
          checked={draft.attested}
          onChange={(e) => onChange({ ...draft, attested: e.target.checked })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
        />
        <span>{ATTESTATION_TEXT[locale]}</span>
      </label>

      {hint && (
        <p data-testid="confirm-hint" role="status" className="mt-3 text-[14px] leading-snug text-slate-600">
          {hint}
        </p>
      )}
    </div>
  );
}
