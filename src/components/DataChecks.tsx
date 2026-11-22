"use client";

import { CHECK_KIND_LABEL, checksReadAloud, relatedReasons, type DataCheck } from "@/lib/domain/checks";
import type { ItemCategory } from "@/lib/domain/types";
import { reasonLabel } from "@/lib/ux/disputeReason";
import { CHECKS_COPY } from "@/lib/ux/checksCopy";
import type { Locale } from "@/lib/i18n/dictionaries";
import SpeakButton from "@/components/SpeakButton";
import Icon from "@/components/Icon";

// "Lo que notamos en tus datos": the data checks on one report item
// (domain/checks.ts). Read-only on every screen. It shows what the data says
// and the reasons that have to do with it, as plain text: nothing here can be
// tapped to answer, pick a reason or include a fact. The customer does that,
// if they want to, in the form below it (DisputeFields).
//
// variant "client": the review screens, with read-aloud.
// variant "staff": the team's client page, with each check's kind, and which
// facts the client chose to include (`included`).

export default function DataChecks({
  checks,
  category,
  locale,
  variant = "client",
  included,
  className = "",
}: {
  checks: readonly DataCheck[];
  category: ItemCategory;
  locale: Locale;
  variant?: "client" | "staff";
  /** Staff only: the ids of the checks the client chose to include in their letter. */
  included?: readonly string[];
  className?: string;
}) {
  if (checks.length === 0) return null;
  const copy = CHECKS_COPY[locale];
  const staff = variant === "staff";
  const chosen = new Set(included ?? []);

  return (
    <section data-testid="data-checks" aria-label={staff ? copy.staffTitle : copy.title} className={`rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3.5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold leading-snug text-slate-900">
            <Icon name="search" size={18} className="shrink-0 text-blue-700" />
            {staff ? copy.staffTitle : copy.title}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{staff ? copy.staffLead : copy.lead}</p>
        </div>
        {!staff && <SpeakButton compact text={checksReadAloud(checks, locale)} label={copy.title} />}
      </div>
      <ul className="mt-2.5 space-y-2.5">
        {checks.map((check) => {
          const reasons = relatedReasons(check, category)
            .map((code) => reasonLabel(code, locale))
            .filter((label): label is string => Boolean(label));
          return (
            <li key={check.id} data-check-kind={check.kind} className="rounded-xl bg-white px-3.5 py-3">
              <p className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                    check.strength === "objective" ? "bg-blue-50 text-blue-800" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {copy.strength[check.strength]}
                </span>
                {staff && <span className="text-[12px] font-medium text-slate-500">{CHECK_KIND_LABEL[check.kind].es}</span>}
                {staff && chosen.has(check.id) && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700">{copy.staffIncluded}</span>
                )}
              </p>
              <p className="mt-1.5 text-[14.5px] leading-snug text-slate-800">{check.explanation[locale]}</p>
              {reasons.length > 0 && (
                <p className="mt-1.5 text-[13px] leading-snug text-slate-600">
                  {copy.relatedReasons} <span className="font-medium text-slate-800">{reasons.join(" · ")}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {!staff && <p className="mt-2.5 text-[13.5px] font-medium leading-snug text-slate-700">{copy.youDecide}</p>}
    </section>
  );
}
