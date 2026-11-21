"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { renderLetter } from "@/lib/letters/templates";
import type { PlannedLetter } from "@/lib/domain/types";
import type { ItemReasons } from "@/lib/letters/parts";
import { getStageExplainers } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { letterCoverage, waitingNote } from "@/lib/ux/roundCopy";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { roundMailedDate, teamRoundStatus } from "@/lib/ux/teamRound";
import { isFullService } from "@/lib/service/mode";
import { useLocale } from "@/lib/i18n";
import IdentityDocs from "@/components/IdentityDocs";
import Icon from "@/components/Icon";
import { WaitingNote } from "@/components/RoundNotes";

// The letters page: no black box. Every letter is readable in full, with an
// "in plain words" summary of what it does and which law it invokes. The
// letters reflect the client's own confirmed review (shared flags store).
//
// Full service (the business today): the page is read-only. It is headed "this
// is what your team mails for you", each letter carries its status (being
// prepared, or mailed on a date and waiting for a response), and there is no
// approve button: the team prepares and mails.
// Self-serve (kept for later, NEXT_PUBLIC_SERVICE_MODE=self_serve): the client
// reads the letters and approves them, as before.

const DEMO_USER = {
  id: "demo",
  fullName: "Tu Nombre",
  addressLines: ["Tu dirección", "Houston, TX 77002"],
  locale: "es" as const,
};

export default function Attack() {
  const { flags, roundFlags, roundApproved, roundMailedAt, setRoundApproved, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const [openLetter, setOpenLetter] = useState<number | null>(null);

  const counts = countByState(flags);

  // Round 1 handles personal-info cleanup; if the user attested no personal-info
  // items, the plan jumps straight to round 2 so the round isn't empty.
  // Once the letters are out, the page keeps showing them as they went out.
  const session = useMemo(() => sessionPlan(DEMO_REPORT.items, roundFlags), [roundFlags]);
  const { attestedFlags, roundNumber, plan, inRound, itemReasons } = session;
  // Confirmed items that are not in these letters, said plainly.
  const waiting = waitingNote(session, locale);

  if (!hydrated) return null;

  // Full service: where the team's work stands. Never set from this page.
  const status = teamRoundStatus({
    totalItems: DEMO_REPORT.items.length,
    reviewedCount: DEMO_REPORT.items.filter((i) => flags[i.fingerprint]).length,
    letterCount: plan.letters.length,
    mailed: roundApproved,
  });
  const mailedAt = roundMailedDate(roundApproved, roundMailedAt);
  const mailedOn = mailedAt
    ? mailedAt.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long" })
    : "";

  if (isFullService && status === "reviewing") {
    // The team starts once the review is finished: say so, and point back to it.
    // No round number yet: which round comes first depends on the answers still to come.
    return (
      <main className="animate-rise space-y-5">
        <h1 className="px-1 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
          {d.nav.attack}
        </h1>
        <section data-testid="review-first" className="card px-6 pb-6 pt-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-900">
            <Icon name="search" size={26} />
          </span>
          <h2 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{d.team.reviewFirstTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">{d.team.reviewFirstBody}</p>
          <Link
            href="/asistente"
            className="pressable mt-5 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {d.team.continueReview}
          </Link>
        </section>
        {/* The team needs these before it can mail anything, so they can be uploaded from the start. */}
        <div className="card overflow-hidden [&>div]:mt-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:p-5">
          <IdentityDocs />
        </div>
      </main>
    );
  }

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
        {isFullService && (
          <p className="mt-2 text-[17px] font-semibold leading-snug text-slate-900">{d.team.lettersLead}</p>
        )}
        <p className={`text-[15px] leading-relaxed text-slate-500 ${isFullService ? "mt-1" : "mt-2"}`}>
          {isFullService
            ? d.team.lettersSubtitle(plan.letters.length, inRound.length)
            : d.attack.subtitle(plan.letters.length, inRound.length)}
        </p>
      </header>

      {isFullService && (
        // Where the team's work stands, before the letters themselves.
        <section data-testid="team-status" className="card flex items-start gap-3.5 px-5 py-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              status === "mailed" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            <Icon name={status === "mailed" ? "mail" : "clock"} size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-snug text-slate-900">
              {status === "mailed" ? d.team.mailedTitle : d.team.preparingTitle}
            </h2>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-600">
              {status === "mailed" ? d.team.mailedBody(mailedOn) : d.team.preparingBody}
            </p>
          </div>
        </section>
      )}

      <div className="card overflow-hidden">
        {plan.letters.map((letter, idx) => (
          <LetterCard
            key={idx}
            letter={letter}
            open={openLetter === idx}
            onToggle={() => setOpenLetter(openLetter === idx ? null : idx)}
            roundNumber={roundNumber}
            itemReasons={itemReasons}
            first={idx === 0}
            date={mailedAt}
            status={
              !isFullService
                ? null
                : status === "mailed"
                  ? [
                      { label: d.team.statusMailed(mailedOn), done: true },
                      { label: d.team.statusWaiting, done: false },
                    ]
                  : [{ label: d.team.statusPreparing, done: false }]
            }
          />
        ))}
      </div>

      {/* IdentityDocs brings its own bordered box; present it as a card like the rest of the page. */}
      <div className="card overflow-hidden [&>div]:mt-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:p-5">
        <IdentityDocs />
      </div>

      {waiting && <WaitingNote note={waiting} />}

      {isFullService ? (
        // Read-only: nothing to approve. What to do if something is not right, and where to follow the round.
        <section className="card px-5 py-5">
          <p className="text-[15px] leading-relaxed text-slate-700">{d.team.changeNote}</p>
          <Link
            href="/rounds"
            className="pressable mt-4 flex h-12 items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
          >
            {d.team.trackRound}
          </Link>
        </section>
      ) : (
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
      )}
    </main>
  );
}

function LetterCard({
  letter,
  open,
  onToggle,
  roundNumber,
  itemReasons,
  first,
  date,
  status,
}: {
  letter: PlannedLetter;
  open: boolean;
  onToggle: () => void;
  roundNumber: number;
  /** The reason the customer gave for each confirmed item: the letter prints its sentence after the item. */
  itemReasons: ItemReasons;
  first: boolean;
  /** The date the letter carries: the day it was mailed, or today while it has not been. */
  date: Date | null;
  /** Full service: where this letter stands ("being prepared", or "mailed on…" and "waiting for a response"). */
  status: Array<{ label: string; done: boolean }> | null;
}) {
  const { locale, d } = useLocale();
  const stages = getStageExplainers(locale);
  const explainer = stages[letter.templateKey] ?? stages[letter.stage] ?? null;

  const coverage = letterCoverage(letter, DEMO_REPORT.items, locale);

  const body = useMemo(() => {
    const items = DEMO_REPORT.items.filter((i) => letter.itemFingerprints.includes(i.fingerprint));
    return renderLetter(letter.templateKey, {
      user: DEMO_USER,
      target: letter.target,
      items,
      date: (date ?? new Date()).toISOString(),
      roundNumber,
      itemReasons,
    });
  }, [letter, roundNumber, itemReasons, date]);

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
          {status && (
            <p data-testid="letter-status" className="mt-1.5 flex flex-wrap gap-1.5">
              {status.map(({ label, done }) => (
                <span
                  key={label}
                  className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
                    done ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {label}
                </span>
              ))}
            </p>
          )}
          {/* What this letter is about, by name, so the recipient is never the only thing shown. */}
          {letter.itemFingerprints.length > 0 && (
            <p data-testid="letter-covers" className="mt-1.5 text-[14px] leading-snug text-slate-700">
              <span className="text-slate-500">{d.attack.covers}</span>{" "}
              {coverage.length === 1 ? (
                <span className="break-words font-medium text-slate-900">{coverage[0]}</span>
              ) : (
                coverage.map((c) => (
                  <span key={c} className="mt-0.5 block break-words font-medium text-slate-900">
                    {c}
                  </span>
                ))
              )}
            </p>
          )}
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
          <p className="mb-2 text-[13px] leading-relaxed text-slate-600">{d.attack.placeholderNote}</p>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 font-serif text-[14px] leading-relaxed text-slate-800">
            {body}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">{d.attack.letterFootnote}</p>
        </div>
      )}
    </div>
  );
}
