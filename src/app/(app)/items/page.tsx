"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { getCategoryExplainers, getTermGlossary } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/dictionaries";

// Guided review wizard — the anti-Dispute-Beast item experience. Instead of a
// wall of rows, ONE item at a time: what it is in plain language, what to
// check, honest choices. "Looks correct" is a first-class answer — we never
// nudge toward dispute-everything (Armor #2/#3). A list view shows the full
// picture and lets the user revisit any decision.

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
  const { flags, review, clear, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const [mode, setMode] = useState<"wizard" | "list">("wizard");

  const counts = countByState(flags);
  const pending = useMemo(() => items.filter((i) => !flags[i.fingerprint]), [items, flags]);
  const current = pending[0];
  const done = pending.length === 0;
  const progressPct = Math.round(((items.length - pending.length) / items.length) * 100);

  if (!hydrated) return null;

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{d.items.title}</h1>
        <button
          onClick={() => setMode(mode === "wizard" ? "list" : "wizard")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {mode === "wizard" ? d.items.viewList : d.items.viewWizard}
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{d.items.reviewed(items.length - pending.length, items.length)}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {mode === "wizard" && !done && current && (
        <WizardCard
          key={current.fingerprint}
          item={current}
          remaining={pending.length}
          onCorrect={() => review(current.fingerprint, "correct")}
          onFlag={(reason) => review(current.fingerprint, "flagged", { reason })}
          onAttest={(reason) =>
            review(current.fingerprint, "attested", {
              reason,
              attestedAt: new Date().toISOString(),
            })
          }
        />
      )}

      {mode === "wizard" && done && (
        <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-3xl">🎉</p>
          <h2 className="mt-2 text-xl font-bold text-green-900">{d.items.doneTitle}</h2>
          <p className="mt-2 text-sm text-green-800">
            {counts.attested > 0 ? d.items.doneWithItems(counts.attested) : d.items.doneNoItems}
          </p>
          {counts.attested > 0 && (
            <Link
              href="/attack"
              className="mt-4 inline-block rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
            >
              {d.items.goToAttack}
            </Link>
          )}
        </div>
      )}

      {mode === "list" && (
        <div className="mt-6 space-y-3">
          {items.map((item) => {
            const f = flags[item.fingerprint];
            return (
              <div
                key={item.fingerprint}
                className={`rounded-lg border bg-white p-4 ${
                  f?.state === "attested"
                    ? "border-blue-400"
                    : f?.state === "correct"
                      ? "border-green-300"
                      : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-slate-500">
                      {BUREAU_LABEL[item.bureau]} · {CATEGORY_LABEL[locale][item.category]}
                    </p>
                    {f?.state === "attested" && f.attestedAt && (
                      <p className="mt-1 text-xs text-blue-700">
                        {d.items.attestedOn(new Date(f.attestedAt).toLocaleString(locale === "es" ? "es-MX" : "en-US"))}
                      </p>
                    )}
                    {f?.state === "correct" && (
                      <p className="mt-1 text-xs text-green-700">{d.items.markedCorrect}</p>
                    )}
                    {f?.state === "flagged" && (
                      <p className="mt-1 text-xs text-amber-700">{d.items.flaggedPending}</p>
                    )}
                  </div>
                  {f && (
                    <button
                      onClick={() => clear(item.fingerprint)}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {d.items.reviewAgain}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {d.items.remaining(remaining)}
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{item.name}</h2>
          <p className="text-sm text-slate-500">
            {BUREAU_LABEL[item.bureau]} · {CATEGORY_LABEL[locale][item.category]}
            {item.negative && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                {d.items.negativeBadge}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
        <p className="font-semibold text-slate-700">{d.items.whatIsThis}</p>
        <p className="mt-1 text-slate-600">{explainer.what}</p>
        <p className="mt-2 text-slate-600">{explainer.whyItMatters}</p>
        {glossary.map((g, i) => (
          <p key={i} className="mt-2 rounded-lg bg-white p-2 text-slate-600">
            💡 {g}
          </p>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
        <p className="font-semibold text-blue-900">{d.items.checkFirst}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-blue-800">
          {explainer.checkHints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>

      {!flagging ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={onCorrect}
            className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-4 text-left hover:border-green-400"
          >
            <p className="font-semibold text-green-800">{d.items.looksCorrect}</p>
            <p className="mt-1 text-xs text-green-700">{d.items.looksCorrectSub}</p>
          </button>
          <button
            onClick={() => setFlagging(true)}
            className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-4 text-left hover:border-blue-400"
          >
            <p className="font-semibold text-blue-800">{d.items.looksWrong}</p>
            <p className="mt-1 text-xs text-blue-700">{d.items.looksWrongSub}</p>
          </button>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-blue-200 p-4">
          <label className="text-sm font-semibold text-slate-700">{d.items.reasonLabel}</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={d.items.reasonPlaceholder}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <label className="mt-4 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={attestChecked}
              onChange={(e) => setAttestChecked(e.target.checked)}
              className="mt-0.5"
            />
            <span>{ATTESTATION_TEXT[locale]}</span>
          </label>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => (attestChecked ? onAttest(reason) : onFlag(reason))}
              disabled={!attestChecked}
              className="rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white disabled:bg-slate-300"
            >
              {d.items.confirm}
            </button>
            <button
              onClick={() => {
                setFlagging(false);
                setAttestChecked(false);
              }}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-slate-600 hover:bg-slate-50"
            >
              {d.items.back}
            </button>
          </div>
          {!attestChecked && (
            <p className="mt-2 text-xs text-slate-500">{d.items.attestationRequired}</p>
          )}
        </div>
      )}
    </div>
  );
}
