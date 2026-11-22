"use client";

import { useId } from "react";
import type { ItemCategory } from "@/lib/domain/types";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { confirmBlockers, EMPTY_DRAFT, reasonChoices, type DisputeDraft } from "@/lib/ux/disputeReason";
import { checksSupporting, relatedReasonsForItem, type DataCheck } from "@/lib/domain/checks";
import { CHECKS_COPY } from "@/lib/ux/checksCopy";
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
//
// With `checks` (the data checks on this item, domain/checks.ts), a reason
// that has to do with one of them carries a small tag saying so. The tag is
// information only: it selects nothing and every reason is still offered.
// When the reason picked relates to a check, an unticked box offers to put
// the check's facts in the letter, showing the exact sentence it would add.

export { EMPTY_DRAFT };

export default function DisputeFields({
  category,
  draft,
  onChange,
  checks = [],
  fingerprint = "",
}: {
  category: ItemCategory;
  draft: DisputeDraft;
  onChange: (next: DisputeDraft) => void;
  /** The data checks on this item. */
  checks?: readonly DataCheck[];
  /** The item's fingerprint, to match the checks to it. */
  fingerprint?: string;
}) {
  const { locale, d } = useLocale();
  const id = useId();
  const choices = reasonChoices(category);
  const copy = CHECKS_COPY[locale];
  const related = new Set<string>(relatedReasonsForItem(checks, category));
  const supporting = checksSupporting(checks, fingerprint, draft.reasonCode);
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
              <span className="min-w-0 break-words">
                {choice.label[locale]}
                {related.has(choice.code) && (
                  <span data-testid="reason-related" className="mt-0.5 block text-[12.5px] font-medium text-blue-800">
                    {copy.reasonTag}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {supporting.length > 0 && (
        <label data-testid="include-facts" className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-blue-100 bg-white p-4 text-[15px] leading-snug text-slate-900">
          <input
            type="checkbox"
            checked={Boolean(draft.includeFacts)}
            onChange={(e) => onChange({ ...draft, includeFacts: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
          />
          <span className="min-w-0">
            <span className="block font-medium">{copy.includeTitle}</span>
            <span className="mt-1 block text-[13px] text-slate-600">{copy.includeHelp}</span>
            <span className="mt-2 block text-[12.5px] font-semibold uppercase tracking-wide text-slate-500">{copy.includeLetterLabel}</span>
            {supporting.map((check) => (
              <span key={check.id} lang="en" className="mt-1 block break-words rounded-xl bg-slate-50 px-3 py-2 font-serif text-[13.5px] text-slate-800">
                {check.letterFact}
              </span>
            ))}
          </span>
        </label>
      )}

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
