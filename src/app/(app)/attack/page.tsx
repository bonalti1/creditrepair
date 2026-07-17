"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { buildAttackPlan } from "@/lib/domain/attack";
import { renderLetter } from "@/lib/letters/templates";
import type { ItemFlag, PlannedLetter } from "@/lib/domain/types";
import { getStageExplainers } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { useLocale } from "@/lib/i18n";

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

  const attestedFlags: ItemFlag[] = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, f]) => f.state === "attested" && f.attestedAt)
        .map(([fingerprint, f]) => ({
          fingerprint,
          reason: f.reason ?? "",
          attested: true,
          attestedAt: f.attestedAt!,
        })),
    [flags],
  );

  const hasPersonalInfo = useMemo(
    () =>
      DEMO_REPORT.items.some(
        (i) =>
          i.category === "personal_info" &&
          attestedFlags.some((f) => f.fingerprint === i.fingerprint),
      ),
    [attestedFlags],
  );

  // Round 1 handles personal-info cleanup; if the user attested no personal-info
  // items, jump straight to the round-2 dispute plan so the attack isn't empty.
  const roundNumber = hasPersonalInfo ? 1 : 2;
  const plan = useMemo(
    () =>
      buildAttackPlan({
        roundNumber,
        items: DEMO_REPORT.items,
        flags: attestedFlags,
        history: {},
      }),
    [roundNumber, attestedFlags],
  );

  if (!hydrated) return null;

  if (attestedFlags.length === 0) {
    return (
      <main>
        <h1 className="text-2xl font-bold">{d.attack.title(1)}</h1>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-3xl">🔍</p>
          <h2 className="mt-2 text-lg font-bold">{d.attack.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            {d.attack.emptyBody}
            {counts.flagged > 0 && d.attack.emptyFlagged(counts.flagged)}
          </p>
          <Link
            href="/items"
            className="mt-4 inline-block rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
          >
            {d.attack.goToReview}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">{d.attack.title(roundNumber)}</h1>
      <p className="mt-1 text-slate-600">{d.attack.subtitle(plan.letters.length, attestedFlags.length)}</p>

      <div className="mt-6 space-y-3">
        {plan.letters.map((letter, idx) => (
          <LetterCard
            key={idx}
            letter={letter}
            open={openLetter === idx}
            onToggle={() => setOpenLetter(openLetter === idx ? null : idx)}
            roundNumber={roundNumber}
          />
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-6">
        {roundApproved ? (
          <div className="text-center">
            <p className="text-3xl">🎉📬</p>
            <p className="mt-2 font-bold text-green-800">{d.attack.approvedTitle}</p>
            <p className="mt-1 text-sm text-green-700">{d.attack.approvedBody}</p>
            <div className="mt-4 flex justify-center gap-3">
              <Link
                href="/rounds"
                className="rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800"
              >
                {d.attack.trackRound}
              </Link>
              <button
                onClick={() => setRoundApproved(false)}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm text-slate-600 hover:bg-white"
              >
                {d.attack.resetDemo}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-blue-900">{d.attack.approveNote}</p>
            <button
              onClick={() => setRoundApproved(true)}
              className="mt-4 w-full rounded-xl bg-blue-700 px-6 py-4 text-lg font-bold text-white hover:bg-blue-800 sm:w-auto"
            >
              {d.attack.approveButton(plan.letters.length)}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function LetterCard({
  letter,
  open,
  onToggle,
  roundNumber,
}: {
  letter: PlannedLetter;
  open: boolean;
  onToggle: () => void;
  roundNumber: number;
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{letter.target.name}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {explainer?.name ?? letter.stage} ·{" "}
              {letter.itemFingerprints.length > 0
                ? d.attack.itemCount(letter.itemFingerprints.length)
                : d.attack.fileRequest}
            </p>
          </div>
          <span className="text-slate-400">{open ? "▲" : d.attack.readLetter}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          {explainer && (
            <div className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-semibold">{d.attack.inPlainWords}</p>
              <p className="mt-1">{explainer.plain}</p>
            </div>
          )}
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-serif text-sm text-slate-800">
            {body}
          </pre>
          <p className="mt-2 text-xs text-slate-500">{d.attack.letterFootnote}</p>
        </div>
      )}
    </div>
  );
}
