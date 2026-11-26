"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClientReport, withReport } from "@/lib/ux/reportStore";
import ReportPending from "@/components/ReportPending";
import type { ReportItem } from "@/lib/domain/types";
import { getStageExplainers } from "@/lib/ux/explainers";
import { useFlags } from "@/lib/ux/flagsStore";
import { useAgreement } from "@/lib/ux/agreementStore";
import { itemLabel } from "@/lib/ux/itemDisplay";
import { RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS, nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { letterCoverage, waitingListNote } from "@/lib/ux/roundCopy";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { roundMailedDate, teamRoundStatus } from "@/lib/ux/teamRound";
import { nextRoundDue } from "@/lib/rounds/timing";
import { clientLetterMail, clientResponseWindowStart, letterCameBack, letterMailLine } from "@/lib/mail/clientView";
import { letterMailKey, useLetterMail } from "@/lib/ux/letterMail";
import { useServiceOption } from "@/lib/service/useServiceOption";
import UpgradeOffer from "@/components/service/UpgradeOffer";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";
import { InfoNote } from "@/components/RoundNotes";
import BureauLetterUpload from "@/components/BureauLetterUpload";

// Rounds, with a real timeline: when letters mailed, when the FCRA ~30-day
// response window closes, when the next round is due (rounds/timing.ts: about
// day 35–45, from the certified delivery when known). The waiting
// period is where Dispute Beast users feel abandoned — here the clock is always
// visible and explained.
//
// Full service (the business today): the page is the team's timeline. Once the
// client finishes the review, the round shows as "being prepared" with the
// letters the team is working on; once the letters are out, it shows the dates.
// The client logs nothing here: the team looks at the report again after each
// round. Self-serve (kept for later): the client approves the letters and logs
// the bureaus' responses, as before.
//
// Demo: the page shows what this browser has saved and nothing else. A round
// counts as mailed only when the saved state says so (letters approved in
// self-serve mode), from the saved date, or from today for a round approved
// before dates were kept. Otherwise the page says where things stand and
// points to the next step.

const DAY_MS = 24 * 60 * 60 * 1000;

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

export default function Rounds() {
  const { locale, d } = useLocale();
  const { flags, roundFlags, roundApproved, roundMailedAt, hydrated } = useFlags();
  // The agreement is part of the next step, so every screen reads the same one Home does.
  const { agreement } = useAgreement();
  // The sample report in the demo; the client's own with a database (lib/ux/reportStore.ts).
  const view = useClientReport();
  const items = view.items;
  // The round as it was approved: an answer changed afterwards does not rewrite what was mailed.
  const { plan, roundNumber } = useMemo(() => sessionPlan(items, roundFlags), [items, roundFlags]);
  // What is confirmed today, to list what is not in these letters.
  const confirmedNow = useMemo(() => sessionPlan(items, flags).attestedFlags, [items, flags]);
  // How each mailed letter travels and where it is (mail/clientView.ts).
  const savedMail = useLetterMail();
  // The client's option: Credalti Complete (the team mails) or Credalti DIY (the client mails, Alti reminds).
  const { option, hydrated: optionHydrated } = useServiceOption();
  const isFullService = option === "full_service";

  if (!hydrated || !view.ready || !optionHydrated) return null;
  if (view.waiting) {
    return (
      <main className="animate-rise space-y-5">
        <h1 className="px-1 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.rounds.title}</h1>
        <ReportPending />
      </main>
    );
  }

  const fmt = (date: Date) =>
    date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long" });
  const stages = getStageExplainers(locale);
  const sent = roundApproved && plan.letters.length > 0;
  // Full service: the review is finished and the team is preparing these letters.
  const preparing =
    isFullService &&
    teamRoundStatus({
      totalItems: items.length,
      reviewedCount: items.filter((i) => flags[i.fingerprint]).length,
      letterCount: plan.letters.length,
      mailed: roundApproved,
    }) === "preparing";

  const mailedAt = roundMailedDate(sent, roundMailedAt) ?? new Date();
  const elapsedDays = Math.max(0, Math.floor((Date.now() - mailedAt.getTime()) / DAY_MS));
  const letterMail = plan.letters.map((l) =>
    clientLetterMail({ templateKey: l.templateKey, targetType: l.target.type }, sent ? mailedAt.toISOString() : null, savedMail[letterMailKey(l.target.key, l.templateKey)]),
  );
  // The bureaus' 30 days run from receipt: a certified letter's delivery date when the post office
  // recorded one, else the mailing date (mail/clientView.ts: clientResponseWindowStart).
  const windowStart = new Date(clientResponseWindowStart(mailedAt.toISOString(), letterMail));
  const windowDays = Math.max(0, Math.floor((Date.now() - windowStart.getTime()) / DAY_MS));
  const daysLeft = Math.max(0, RESPONSE_WINDOW_DAYS - windowDays);
  const responseDue = new Date(windowStart.getTime() + RESPONSE_WINDOW_DAYS * DAY_MS);
  // The next round's date, from the same evidence (rounds/timing.ts): 30 days from receipt (a
  // certified delivery scan, else mailing + 5 days), plus 5 for the answer; at most 45 from mailing.
  const nextRoundAt = new Date(nextRoundDue({ mailedAt: mailedAt.toISOString() }, letterMail)!.dueAt);
  const cycleDays = Math.max(1, Math.round((nextRoundAt.getTime() - mailedAt.getTime()) / DAY_MS));

  // The items in this round's letters: the ones a bureau response will be about.
  const inRound = new Set(plan.letters.flatMap((l) => l.itemFingerprints));
  const roundItems = items.filter((i) => inRound.has(i.fingerprint));
  // Confirmed, and not in these letters: they go in the next round.
  const confirmedFps = new Set(confirmedNow.map((f) => f.fingerprint));
  const waitingItems = items.filter((i) => confirmedFps.has(i.fingerprint) && !inRound.has(i.fingerprint));

  // Nothing mailed: the one next step, the same one Home shows.
  const step = nextAction(withReport(sessionJourneyState(items, flags, sent, agreement), view, roundMailedAt), locale);

  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.rounds.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          {(isFullService ? d.team.roundsSubtitle : d.diy.roundsSubtitle)(RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS)}
        </p>
      </header>

      {sent || preparing ? (
        <section data-testid={sent ? "round-mailed" : "round-preparing"} className="card overflow-hidden">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold tabular-nums text-slate-900">
                {locale === "es" ? "Ronda" : "Round"} #{roundNumber}
              </h2>
              <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                {!sent ? d.team.statusPreparing : isFullService ? d.team.statusWaiting : d.rounds.inProgress}
              </span>
            </div>

            {sent ? (
              <div className="mt-4">
                <div className="h-1.5 rounded-full bg-slate-200">
                  {/* How far into the ~40-day cycle. A sliver on day 0: the clock has only just started. */}
                  <div
                    className="h-1.5 rounded-full bg-amber-400"
                    style={{ width: `${Math.min(100, Math.max(4, Math.round((elapsedDays / cycleDays) * 100)))}%` }}
                  />
                </div>
                <div className="mt-3 space-y-1 text-[13px] tabular-nums text-slate-500">
                  <p>{d.rounds.mailed(fmt(mailedAt))}</p>
                  <p>{d.rounds.responseBy(fmt(responseDue))}</p>
                  <p>{d.rounds.nextRound(roundNumber + 1, fmt(nextRoundAt))}</p>
                </div>
                {daysLeft > 0 && (
                  <p className="mt-3 text-[15px] leading-relaxed text-slate-700">
                    {(isFullService ? d.team.waitDays : d.diy.waitDays)(daysLeft)}
                  </p>
                )}
              </div>
            ) : (
              // Nothing mailed yet, so no dates: only what the team is doing.
              <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{d.team.roundPreparingBody}</p>
            )}
          </div>

          <p className="border-t hairline px-5 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {isFullService ? d.team.lettersInRound(plan.letters.length) : d.rounds.lettersSent(plan.letters.length)}
          </p>
          <ul>
            {plan.letters.map((l, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 px-5 py-3.5 text-[15px] leading-snug text-slate-500 ${i > 0 ? "border-t hairline" : ""}`}
              >
                <Icon name="doc" size={18} className="mt-px shrink-0 text-slate-400" />
                <span className="min-w-0 break-words">
                  <span className="font-medium text-slate-900">{l.target.name}</span> —{" "}
                  {(stages[l.templateKey] ?? stages[l.stage])?.name ?? l.stage}
                  {/* "Enviada el … · Certificada · Entregada el …" once the letter is out. */}
                  {sent && letterMailLine(letterMail[i]!, locale) && (
                    <span
                      data-testid="letter-mail-status"
                      className={`mt-1 block text-[13px] font-medium ${
                        letterCameBack(letterMail[i]!) ? "text-amber-700" : letterMail[i]!.status === "delivered" ? "text-green-700" : "text-slate-600"
                      }`}
                    >
                      {letterMailLine(letterMail[i]!, locale)}
                    </span>
                  )}
                  {/* What the letter covers, by name. */}
                  {letterCoverage(l, items, locale).map((c) => (
                    <span key={c} data-testid="letter-covers" className="mt-0.5 block text-[14px] text-slate-700">
                      {c}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          {waitingItems.length > 0 && (
            <div data-testid="waiting-list" className="border-t hairline bg-amber-50 px-5 pb-4 pt-4">
              <h3 className="flex items-center gap-2 text-[17px] font-semibold leading-snug text-slate-900">
                <Icon name="clock" size={20} className="shrink-0 text-amber-700" />
                {d.rounds.waitingTitle}
              </h3>
              <ul className="mt-2.5 space-y-1.5">
                {waitingItems.map((item) => (
                  <li key={item.fingerprint} className="flex gap-2.5 text-[15px] leading-snug text-slate-900">
                    <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{itemLabel(item, locale)}</span>
                      <span className="text-slate-600"> · {BUREAU_LABEL[item.bureau]}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[14px] leading-relaxed text-slate-700">{waitingListNote(locale)}</p>
            </div>
          )}

          {!sent ? (
            <div className="border-t hairline px-5 py-4">
              <Link
                href="/attack"
                className="pressable flex h-12 items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
              >
                {d.team.readLetters(plan.letters.length)}
              </Link>
            </div>
          ) : isFullService ? (
            // The team looks at the report again after the round; the client logs nothing.
            <div className="border-t hairline px-5 py-4">
              <InfoNote testId="response-note">{d.team.responseNote}</InfoNote>
            </div>
          ) : (
            roundItems.length > 0 && <ResponseLogger items={roundItems} />
          )}
        </section>
      ) : (
        <section className="card px-6 pb-6 pt-8 text-center">
          {/* Full service: the team mails the letters, so the team character stands here. */}
          {isFullService ? (
            <span className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <Icon name="mail" size={32} />
            </span>
          ) : (
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-900">
              <Icon name="clock" size={26} />
            </span>
          )}
          <h2 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">
            {isFullService ? d.team.roundsEmptyTitle : d.diy.roundsEmptyTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
            {isFullService ? d.team.roundsEmptyBody : d.diy.roundsEmptyBody}
          </p>
          <p className="mx-auto mt-4 max-w-sm text-[15px] font-medium leading-snug text-slate-900">{step.title}</p>
          <Link
            href={step.href}
            className="pressable mt-4 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {step.cta}
          </Link>
        </section>
      )}

      {/* Credalti DIY: when the next round is due, Alti offers the team's help once (no pressure). */}
      {!isFullService && sent && Date.now() >= nextRoundAt.getTime() && <UpgradeOffer moment={`round-due:${roundNumber + 1}`} />}

      {/* Optional: results come from the next report; a letter is never asked for (components/BureauLetterUpload.tsx). */}
      <BureauLetterUpload />
    </main>
  );
}

type Outcome = "deleted" | "corrected" | "verified" | "no_response";
const OUTCOME_KEY = "bonalti.outcomes.v1";

// Bureau-response intake, self-serve only: in CRC an agency employee does this
// data entry; here the consumer logs it in two taps when the response letter
// arrives. (Under full service the team re-imports the report instead.) Feeds the
// escalation engine (a logged "verified" is what justifies the MOV letter).
// Demo: localStorage; authed: also POSTs to /api/letters/outcome (TODO once
// letter ids flow to the client).
function ResponseLogger({ items }: { items: ReportItem[] }) {
  const { locale, d } = useLocale();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OUTCOME_KEY);
      if (raw) setOutcomes(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const log = (fp: string, outcome: Outcome) => {
    const next = { ...outcomes, [fp]: outcome };
    setOutcomes(next);
    try {
      window.localStorage.setItem(OUTCOME_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const options: Array<{ key: Outcome; label: string }> = [
    { key: "deleted", label: d.responses.deleted },
    { key: "corrected", label: d.responses.corrected },
    { key: "verified", label: d.responses.verified },
    { key: "no_response", label: d.responses.no_response },
  ];

  const anyVerified = items.some((i) => outcomes[i.fingerprint] === "verified");

  return (
    <div className="border-t hairline px-5 pb-5 pt-5">
      <p className="text-[17px] font-semibold leading-snug text-slate-900">{d.responses.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{d.responses.note}</p>
      <div className="mt-4 space-y-5">
        {items.map((item) => (
          <div key={item.fingerprint}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-[15px] font-medium text-slate-900">
                {itemLabel(item, locale)}
                <span className="font-normal text-slate-500"> · {BUREAU_LABEL[item.bureau]}</span>
              </p>
              {outcomes[item.fingerprint] && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {d.responses.saved}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {options.map((o) => (
                <button
                  key={o.key}
                  onClick={() => log(item.fingerprint, o.key)}
                  aria-pressed={outcomes[item.fingerprint] === o.key}
                  className={`pressable min-h-11 rounded-full px-3 py-2 text-[13px] leading-tight ${
                    outcomes[item.fingerprint] === o.key
                      ? o.key === "deleted"
                        ? "bg-green-50 font-semibold text-green-700 ring-1 ring-inset ring-green-600"
                        : "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-600"
                      : "bg-slate-100 font-medium text-slate-900 hover:bg-slate-200"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {anyVerified && (
        <p className="mt-5 flex gap-2.5 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] leading-relaxed text-blue-900">
          <Icon name="sparkle" size={18} className="mt-px shrink-0 text-blue-700" />
          <span>{d.responses.verifiedHint}</span>
        </p>
      )}
    </div>
  );
}
