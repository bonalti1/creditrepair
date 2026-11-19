"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { renderLetter } from "@/lib/letters/templates";
import type { PlannedLetter } from "@/lib/domain/types";
import { getStageExplainers } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { useLocale } from "@/lib/i18n";
import IdentityDocs from "@/components/IdentityDocs";
import Icon from "@/components/Icon";

// Attack builder — no black box. Every letter is readable in full BEFORE
// approval, with an "in plain words" summary of what it does and which law it
// invokes. The attack reflects the user's real attested review from the wizard
// (shared flags store). Approval is explicit and celebratory.

const DEMO_USER = {
  id: "demo",
  fullName: "Tu Nombre",
  addressLines: ["Tu dirección", "Houston, TX 77002"],
  locale: "es" as const,
};

export default function Attack() {
  const { flags, roundApproved, setRoundApproved, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const [openLetter, setOpenLetter] = useState<number | null>(null);

  const counts = countByState(flags);

  // Round 1 handles personal-info cleanup; if the user attested no personal-info
  // items, the plan jumps straight to round 2 so the attack isn't empty.
  const { attestedFlags, roundNumber, plan } = useMemo(() => sessionPlan(DEMO_REPORT.items, flags), [flags]);

  if (!hydrated) return null;

  if (attestedFlags.length === 0) {
    return (
      <main className="animate-rise space-y-5">
        <h1 className="px-1 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
          {d.attack.title(1)}
        </h1>
        <section className="card px-6 pb-6 pt-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-900">
            <Icon name="search" size={26} />
          </span>
          <h2 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{d.attack.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
            {d.attack.emptyBody}
            {counts.flagged > 0 && d.attack.emptyFlagged(counts.flagged)}
          </p>
          <Link
            href="/items"
            className="pressable mt-5 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {d.attack.goToReview}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
          {d.attack.title(roundNumber)}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          {d.attack.subtitle(plan.letters.length, attestedFlags.length)}
        </p>
      </header>

      <div className="card overflow-hidden">
        {plan.letters.map((letter, idx) => (
          <LetterCard
            key={idx}
            letter={letter}
            open={openLetter === idx}
            onToggle={() => setOpenLetter(openLetter === idx ? null : idx)}
            roundNumber={roundNumber}
            first={idx === 0}
          />
        ))}
      </div>

      {/* IdentityDocs brings its own bordered box; present it as a card like the rest of the page. */}
      <div className="card overflow-hidden [&>div]:mt-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:p-5">
        <IdentityDocs />
      </div>

      <section className="card px-5 py-5">
        {roundApproved ? (
          <div className="pt-3 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
              <Icon name="mail" size={26} />
            </span>
            <p className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{d.attack.approvedTitle}</p>
            <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">{d.attack.approvedBody}</p>
            <div className="mt-5 grid gap-2.5">
              <Link
                href="/rounds"
                className="pressable flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
              >
                {d.attack.trackRound}
              </Link>
              <button
                onClick={() => setRoundApproved(false)}
                className="pressable h-12 rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
              >
                {d.attack.resetDemo}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed text-slate-700">{d.attack.approveNote}</p>
            <button
              onClick={() => setRoundApproved(true)}
              className="pressable mt-4 flex min-h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 py-2.5 text-center text-[17px] font-semibold leading-snug text-blue-900 hover:bg-amber-500"
            >
              {d.attack.approveButton(plan.letters.length)}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

function LetterCard({
  letter,
  open,
  onToggle,
  roundNumber,
  first,
}: {
  letter: PlannedLetter;
  open: boolean;
  onToggle: () => void;
  roundNumber: number;
  first: boolean;
}) {
  const { locale, d } = useLocale();
  const stages = getStageExplainers(locale);
  const explainer = stages[letter.templateKey] ?? stages[letter.stage] ?? null;

  const body = useMemo(() => {
    const items = DEMO_REPORT.items.filter((i) => letter.itemFingerprints.includes(i.fingerprint));
    return renderLetter(letter.templateKey, {
      user: DEMO_USER,
      target: letter.target,
      items,
      date: new Date().toISOString(),
      roundNumber,
    });
  }, [letter, roundNumber]);

  return (
    <div className={first ? "" : "border-t hairline"}>
      <button
        onClick={onToggle}
        className="pressable flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="break-words text-[17px] font-medium leading-snug text-slate-900">{letter.target.name}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
            {explainer?.name ?? letter.stage} ·{" "}
            {letter.itemFingerprints.length > 0
              ? d.attack.itemCount(letter.itemFingerprints.length)
              : d.attack.fileRequest}
          </p>
        </div>
        {open ? (
          <Icon name="chevron" size={18} className="shrink-0 -rotate-90 text-slate-400" />
        ) : (
          <span className="shrink-0 whitespace-nowrap text-[13px] font-medium text-blue-700">{d.attack.readLetter}</span>
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1">
          {explainer && (
            <div className="mb-4">
              <p className="text-[15px] font-semibold text-slate-900">{d.attack.inPlainWords}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{explainer.plain}</p>
            </div>
          )}
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 font-serif text-[14px] leading-relaxed text-slate-800">
            {body}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">{d.attack.letterFootnote}</p>
        </div>
      )}
    </div>
  );
}
