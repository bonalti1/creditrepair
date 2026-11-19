"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { getCategoryExplainers, getTermGlossary } from "@/lib/ux/explainers";
import { useFlags } from "@/lib/ux/flagsStore";
import { itemCheckHints, itemFacts, itemKindLine, itemTitle } from "@/lib/ux/itemDisplay";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/dictionaries";
import Icon from "@/components/Icon";
import ItemFacts from "@/components/ItemFacts";

// Guided review wizard — the anti-Dispute-Beast item experience. Instead of a
// wall of rows, ONE item at a time: what it is in plain language, what to
// check, honest choices. "Looks correct" is a first-class answer — we never
// nudge toward dispute-everything (Armor #2/#3). A list view shows the full
// picture and lets the user revisit any decision: "review again" reopens that
// item in the guide straight away, so a cleared decision is never left hanging.
// Once everything is reviewed, the closing card is the journey's one next step,
// the same one Home shows.

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

const CATEGORY_LABEL: Record<Locale, Record<string, string>> = {
  es: {
    tradeline: "Cuenta",
    inquiry: "Consulta",
    public_record: "Registro público",
    personal_info: "Dato personal",
  },
  en: {
    tradeline: "Account",
    inquiry: "Inquiry",
    public_record: "Public record",
    personal_info: "Personal info",
  },
};

function glossaryFor(data: Record<string, unknown>, locale: Locale): string[] {
  const glossary = getTermGlossary(locale);
  const haystack = JSON.stringify(data).toLowerCase();
  return Object.entries(glossary)
    .filter(([term]) => haystack.includes(term))
    .map(([, plain]) => plain);
}

export default function Items() {
  const items = DEMO_REPORT.items;
  const { flags, review, clear, roundApproved, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const [mode, setMode] = useState<"wizard" | "list">("wizard");
  /** The item the customer asked to review again; the guide opens on it. */
  const [focus, setFocus] = useState<string | null>(null);

  const pending = useMemo(() => items.filter((i) => !flags[i.fingerprint]), [items, flags]);
  const current = pending.find((i) => i.fingerprint === focus) ?? pending[0];
  const done = pending.length === 0;
  const progressPct = Math.round(((items.length - pending.length) / items.length) * 100);

  if (!hydrated) return null;

  const step = nextAction(sessionJourneyState(items, flags, roundApproved), locale);

  const reviewAgain = (fingerprint: string) => {
    clear(fingerprint);
    setFocus(fingerprint);
    setMode("wizard");
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="animate-rise space-y-5">
      <div className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.items.title}</h1>
        <button
          onClick={() => setMode(mode === "wizard" ? "list" : "wizard")}
          className="pressable mt-1 inline-flex h-11 items-center text-[15px] font-medium text-blue-700"
        >
          {mode === "wizard" ? d.items.viewList : d.items.viewWizard}
        </button>

        <div className="mt-1">
          <div className="flex items-center justify-between text-[13px] tabular-nums text-slate-500">
            <span>{d.items.reviewed(items.length - pending.length, items.length)}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-200">
            <div
              className="h-1.5 rounded-full bg-blue-700 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {mode === "wizard" && !done && current && (
        <WizardCard
          key={current.fingerprint}
          item={current}
          remaining={pending.length}
          onCorrect={() => {
            review(current.fingerprint, "correct");
            setFocus(null);
          }}
          onFlag={(reason) => {
            review(current.fingerprint, "flagged", { reason });
            setFocus(null);
          }}
          onAttest={(reason) => {
            review(current.fingerprint, "attested", {
              reason,
              attestedAt: new Date().toISOString(),
            });
            setFocus(null);
          }}
        />
      )}

      {mode === "list" && (
        <div className="card overflow-hidden">
          {items.map((item, index) => {
            const f = flags[item.fingerprint];
            const heading = itemTitle(item, locale);
            return (
              <div key={item.fingerprint} className={`px-5 py-4 ${index > 0 ? "border-t hairline" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {heading.kicker && <p className="text-[13px] font-semibold text-slate-500">{heading.kicker}</p>}
                    <p className="break-words text-[17px] font-medium leading-snug text-slate-900">{heading.title}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {BUREAU_LABEL[item.bureau]} · {CATEGORY_LABEL[locale][item.category]}
                    </p>
                  </div>
                  {f && (
                    <button
                      onClick={() => reviewAgain(item.fingerprint)}
                      className="pressable h-11 shrink-0 text-[15px] font-medium text-blue-700"
                    >
                      {d.items.reviewAgain}
                    </button>
                  )}
                </div>
                {/* Full width, under the title and its button, so the facts are not squeezed into a column. */}
                <ItemFacts facts={itemFacts(item, locale)} variant="inline" className="mt-1" />
                {f?.state === "attested" && f.attestedAt && (
                  <p className="mt-1 text-[13px] font-medium tabular-nums text-blue-700">
                    {d.items.attestedOn(new Date(f.attestedAt).toLocaleString(locale === "es" ? "es-MX" : "en-US"))}
                  </p>
                )}
                {f?.state === "correct" && (
                  <p className="mt-1 text-[13px] font-medium text-green-700">{d.items.markedCorrect}</p>
                )}
                {f?.state === "flagged" && (
                  <p className="mt-1 text-[13px] font-medium text-amber-700">{d.items.flaggedPending}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {done && (
        <section className="card px-6 pb-6 pt-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
            <Icon name={step.key === "waiting" ? "mail" : "check"} size={28} strokeWidth={step.key === "waiting" ? 1.75 : 2.25} />
          </span>
          <h2 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{step.title}</h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">{step.description}</p>
          {step.href === "/items" ? (
            // The next step is on this page: the list is where a decision is changed.
            mode === "wizard" && (
              <button
                onClick={() => setMode("list")}
                className="pressable mt-5 flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
              >
                {step.cta}
              </button>
            )
          ) : (
            <Link
              href={step.href}
              className="pressable mt-5 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
            >
              {step.cta}
            </Link>
          )}
        </section>
      )}
    </main>
  );
}

function WizardCard({
  item,
  remaining,
  onCorrect,
  onFlag,
  onAttest,
}: {
  item: (typeof DEMO_REPORT.items)[number];
  remaining: number;
  onCorrect: () => void;
  onFlag: (reason: string) => void;
  onAttest: (reason: string) => void;
}) {
  const { locale, d } = useLocale();
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const [attestChecked, setAttestChecked] = useState(false);
  const explainer = getCategoryExplainers(locale)[item.category];
  const glossary = glossaryFor(item.data as Record<string, unknown>, locale);
  const heading = itemTitle(item, locale);
  const facts = itemFacts(item, locale);

  // Each item gets its own card (keyed by fingerprint). Start it at its title
  // and facts; otherwise the page stays scrolled down at the last card's buttons.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <section className="card animate-rise overflow-hidden">
      <div className="px-5 pb-5 pt-5">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {d.items.remaining(remaining)}
        </p>
        {heading.kicker && <p className="mt-2 text-[14px] font-semibold text-slate-500">{heading.kicker}</p>}
        <h2 className={`break-words text-[22px] font-semibold leading-tight text-slate-900 ${heading.kicker ? "mt-0.5" : "mt-2"}`}>
          {heading.title}
        </h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-slate-500">
          <span>
            {BUREAU_LABEL[item.bureau]} · {CATEGORY_LABEL[locale][item.category]}
          </span>
          {item.negative && (
            <span className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              {d.items.negativeBadge}
            </span>
          )}
        </p>
        <ItemFacts facts={facts} heading={d.items.reportSays} className="mt-4" />
      </div>

      <div className="border-t hairline px-5 py-4">
        <p className="text-[15px] font-semibold text-slate-900">{d.items.whatIsThis}</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{itemKindLine(item, locale)}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{explainer.whyItMatters}</p>
        {glossary.map((g, i) => (
          <p key={i} className="mt-3 flex gap-2.5 rounded-2xl bg-slate-50 px-4 py-3 text-[14px] leading-snug text-slate-600">
            <Icon name="sparkle" size={18} className="mt-px shrink-0 text-amber-600" />
            <span>{g}</span>
          </p>
        ))}
      </div>

      <div className="border-t hairline px-5 py-4">
        <p className="text-[15px] font-semibold text-slate-900">{d.items.checkFirst}</p>
        <ul className="mt-2.5 space-y-2">
          {itemCheckHints(item, locale).map((h, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-snug text-slate-600">
              <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </div>

      {!flagging ? (
        <div className="grid gap-2.5 border-t hairline px-5 py-5 sm:grid-cols-2">
          <button
            onClick={onCorrect}
            className="pressable rounded-2xl bg-slate-100 px-4 py-3.5 text-left hover:bg-slate-200"
          >
            <p className="text-[17px] font-medium text-slate-900">{d.items.looksCorrect}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{d.items.looksCorrectSub}</p>
          </button>
          <button
            onClick={() => setFlagging(true)}
            className="pressable rounded-2xl bg-slate-100 px-4 py-3.5 text-left hover:bg-slate-200"
          >
            <p className="text-[17px] font-medium text-slate-900">{d.items.looksWrong}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{d.items.looksWrongSub}</p>
          </button>
        </div>
      ) : (
        <div className="border-t hairline px-5 py-5">
          <label htmlFor="reason" className="block text-[15px] font-medium leading-snug text-slate-900">
            {d.items.reasonLabel}
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={d.items.reasonPlaceholder}
            rows={3}
            className="mt-2 block w-full resize-none rounded-2xl bg-slate-100 px-4 py-3 text-[16px] leading-snug text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
          />
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-blue-50 p-4 text-[15px] leading-snug text-slate-900">
            <input
              type="checkbox"
              checked={attestChecked}
              onChange={(e) => setAttestChecked(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
            />
            <span>{ATTESTATION_TEXT[locale]}</span>
          </label>
          <div className="mt-4 grid gap-2.5">
            <button
              onClick={() => (attestChecked ? onAttest(reason) : onFlag(reason))}
              disabled={!attestChecked}
              className="pressable h-14 rounded-full bg-amber-400 px-5 text-[17px] font-semibold text-blue-900 enabled:hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
            >
              {d.items.confirm}
            </button>
            <button
              onClick={() => {
                setFlagging(false);
                setAttestChecked(false);
              }}
              className="pressable h-12 rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
            >
              {d.items.back}
            </button>
          </div>
          {!attestChecked && (
            <p className="mt-3 text-[13px] leading-relaxed text-slate-500">{d.items.attestationRequired}</p>
          )}
        </div>
      )}
    </section>
  );
}
