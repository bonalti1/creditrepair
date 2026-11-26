"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import UpgradeOffer from "@/components/service/UpgradeOffer";
import { formatAgreementDay, workMayStart } from "@/lib/agreement/gate";
import { formatCents } from "@/lib/billing/money";
import { MAILED_ON_PROBLEM_TEXT, mailedOnProblem, mailQuote, unmailedTooLong } from "@/lib/diy/rules";
import { useDiyRound } from "@/lib/diy/useDiyRound";
import { useLocale } from "@/lib/i18n";
import { readStoredAgreement } from "@/lib/ux/agreementLocal";

// Credalti DIY's three actions on the letters page (docs/SERVICE-OPTIONS.md):
// "Print my letters", "I mailed them" (the date starts the bureaus' 30 days
// and Alti's next-round reminder) and "Mail them for me" (paid per letter,
// the cost shown before confirming, charged after we mail them). Shown only to
// a DIY client; a Complete client sees the team's status instead.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function DiyLetterActions({
  roundNumber,
  letterCount,
  mailed,
  mailedAt,
  onMailed,
}: {
  roundNumber: number;
  letterCount: number;
  /** The round is recorded as mailed (by the client, or by us for all its letters). */
  mailed: boolean;
  mailedAt: Date | null;
  /** Tell the page the round went out, with the date. */
  onMailed: (iso: string) => void;
}) {
  const { locale, d } = useLocale();
  const t = d.diy;
  const diy = useDiyRound();
  const [mailedOn, setMailedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  if (!diy.hydrated || !now) return null;
  const day = (iso: string | Date) => new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long" });
  const fail = (code: string) =>
    setError(code === "quote_changed" ? t.errors.quote_changed : code.includes("cancellation_window") ? t.errors.in_cancellation_window : t.errors.generic);

  // Inside the cancellation window nothing is prepared (the demo reads this device's agreement; the server checks its own).
  const gate = diy.demo ? workMayStart(readStoredAgreement(), now) : null;
  if (gate && !gate.allowed && gate.code === "in_cancellation_window") {
    return (
      <section data-testid="diy-window" className="card px-5 py-5">
        <h2 className="text-[17px] font-semibold text-slate-900">{t.windowTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.windowBody(gate.startsAt ? formatAgreementDay(new Date(gate.startsAt), locale) : "")}</p>
      </section>
    );
  }

  if (mailed) {
    return (
      <section data-testid="diy-mailed" className="card px-5 py-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
          <Icon name="mail" size={26} />
        </span>
        <p className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{d.attack.approvedTitle}</p>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
          {diy.request?.status === "mailed" && diy.request.mailedAt ? t.mailForMeMailed(day(diy.request.mailedAt)) : mailedAt ? t.mailedSaved(day(mailedAt)) : d.attack.approvedBody}
        </p>
        <Link href="/rounds" className="pressable mt-5 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500">
          {d.attack.trackRound}
        </Link>
        {diy.demo && (
          <button
            type="button"
            onClick={() => {
              diy.reset();
              window.localStorage.removeItem("bonalti.roundApproved.v1");
              window.location.reload();
            }}
            className="pressable mt-2.5 h-12 w-full rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
          >
            {d.attack.resetDemo}
          </button>
        )}
      </section>
    );
  }

  if (!diy.prepared) {
    return (
      <section data-testid="diy-prepare" className="card px-5 py-5">
        <h2 className="text-[17px] font-semibold text-slate-900">{t.prepareTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.prepareBody}</p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await diy.prepare(roundNumber);
            setBusy(false);
            if (!result.ok) fail(result.code);
          }}
          className="pressable mt-4 flex min-h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 py-2.5 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:opacity-60"
        >
          {busy ? t.preparing : t.prepareButton(letterCount)}
        </button>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{d.attack.approveNote}</p>
        {error && <p role="alert" className="mt-3 text-[14px] text-red-700">{error}</p>}
      </section>
    );
  }

  const quote = diy.feeCents ? mailQuote(diy.feeCents, diy.round?.letters.filter((l) => l.status === "draft" && !l.requested).length || letterCount) : null;
  const problem = mailedOnProblem(mailedOn, now, diy.preparedAt);

  return (
    <div className="space-y-5">
      {unmailedTooLong(diy.preparedAt, false, now) && <UpgradeOffer moment={`unmailed:${roundNumber}`} />}

      <section data-testid="diy-print" className="card px-5 py-5">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <Icon name="doc" size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-slate-900">{t.printButton}</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.printHint}</p>
          </div>
        </div>
        <Link href="/attack/imprimir" className="pressable mt-4 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500">
          {t.printButton}
        </Link>
      </section>

      <section data-testid="diy-mailed-form" className="card px-5 py-5">
        <h2 className="text-[17px] font-semibold text-slate-900">{t.mailedTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.mailedBody}</p>
        <label className="mt-4 block">
          <span className="block pb-1 text-[14px] font-medium text-slate-700">{t.mailedDate}</span>
          <input
            type="date"
            value={mailedOn}
            max={today()}
            onChange={(e) => setMailedOn(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900"
          />
        </label>
        {problem && mailedOn && <p className="mt-2 text-[14px] text-red-700">{MAILED_ON_PROBLEM_TEXT[problem][locale]}</p>}
        <button
          type="button"
          disabled={busy || Boolean(problem)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await diy.markMailed(roundNumber, mailedOn);
            setBusy(false);
            if (!result.ok) return fail(result.code);
            onMailed(new Date(`${mailedOn}T17:00:00Z`).toISOString());
          }}
          className="pressable mt-4 flex h-14 w-full items-center justify-center rounded-full bg-blue-900 text-[17px] font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {t.mailedButton}
        </button>
      </section>

      <section data-testid="diy-mail-for-me" className="card px-5 py-5">
        <h2 className="text-[17px] font-semibold text-slate-900">{t.mailForMeTitle}</h2>
        {diy.request ? (
          <p className="mt-1 text-[15px] leading-relaxed text-slate-600">
            {diy.request.status === "mailed" && diy.request.mailedAt ? t.mailForMeMailed(day(diy.request.mailedAt)) : t.mailForMeRequested(diy.request.letters, formatCents(diy.request.totalCents))}
          </p>
        ) : !quote ? (
          <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.mailForMeNotOffered}</p>
        ) : (
          <>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.mailForMeBody}</p>
            {/* The cost is always shown before anything is confirmed. */}
            <p data-testid="mail-quote" className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-[15px] font-medium text-slate-900">
              {t.mailForMeCost(quote.line[locale])}
              {diy.demo && <span className="ml-1 text-[13px] font-normal text-slate-500">{locale === "es" ? "(precio de demostración)" : "(demo price)"}</span>}
            </p>
            {confirming ? (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    const result = await diy.mailForMe(roundNumber, quote.letters, quote.totalCents);
                    setBusy(false);
                    setConfirming(false);
                    if (!result.ok) return fail(result.code);
                    if (diy.demo) onMailed(new Date().toISOString());
                  }}
                  className="pressable h-12 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:opacity-60"
                >
                  {t.mailForMeConfirm(formatCents(quote.totalCents))}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="pressable h-12 rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200">
                  {locale === "es" ? "Mejor no" : "Not now"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="pressable mt-3 h-12 w-full rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
              >
                {t.mailForMeTitle}
              </button>
            )}
          </>
        )}
      </section>

      <p className="px-1 text-[14px] leading-relaxed text-slate-500">{t.changeNote}</p>
      {error && <p role="alert" className="px-1 text-[14px] text-red-700">{error}</p>}
    </div>
  );
}
