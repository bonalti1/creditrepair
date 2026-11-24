"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { checkedOnLabel, type LessonSource } from "@/lib/learn/lessons";
import { AFTERCARE_SOURCES, type AftercareSourceKey } from "@/lib/aftercare/sources";
import { AFFILIATE_LINE, OFFER_KIND_LABEL, OFFER_LABELS, OFFERS_INTRO, yearlyCostLabel, type Offer } from "@/lib/aftercare/offers";
import type { PersonalItem } from "@/lib/aftercare/plan";

// The pieces /construir, the home-ready path, the ITIN guide and graduation
// share: sources with the day they were checked (or "Pending review"), the
// "Mark as done" button, one plan item, and the partner offers with their
// disclosure. Words come from src/lib/aftercare/.

type L = "es" | "en";

export function SourceList({ keys, locale, title }: { keys: readonly AftercareSourceKey[]; locale: L; title?: string }) {
  const es = locale === "es";
  const seen = new Set<string>();
  const sources = keys.map((k) => AFTERCARE_SOURCES[k] as LessonSource).filter((s) => (seen.has(s.url + s.status) ? false : (seen.add(s.url + s.status), true)));
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 border-t hairline pt-3" data-testid="aftercare-sources">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title ?? (es ? "Fuentes" : "Sources")}</p>
      <ul className="mt-1 space-y-1.5">
        {sources.map((s) => (
          <li key={s.url + s.status} className="text-[13px] leading-snug text-slate-600">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-block py-1 font-medium text-blue-700 underline underline-offset-2">
              {s.publisher}: {s.title}
            </a>
            <span className="block text-[12px] text-slate-500">
              {s.status === "verified"
                ? es
                  ? `Revisado el ${checkedOnLabel(s.checkedOn, "es")}`
                  : `Checked on ${checkedOnLabel(s.checkedOn, "en")}`
                : es
                  ? "Pendiente de revisión: no lo pudimos confirmar en la página oficial"
                  : "Pending review: we could not confirm it on the official page"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GeneralInfoNote({ locale, className = "" }: { locale: L; className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-slate-600 ${className}`}>
      {locale === "es"
        ? "Información general, no consejo legal ni financiero. Nadie puede prometer cómo cambia un puntaje: los burós y los prestamistas deciden."
        : "General information, not legal or financial advice. No one can promise how a score changes: the bureaus and lenders decide."}
    </p>
  );
}

export function MarkButton({ done, onToggle, locale, testId }: { done: boolean; onToggle: () => Promise<unknown> | void; locale: L; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const es = locale === "es";
  return (
    <button
      type="button"
      aria-pressed={done}
      disabled={busy}
      data-testid={testId}
      onClick={async () => {
        setBusy(true);
        try {
          await onToggle();
        } finally {
          setBusy(false);
        }
      }}
      className={`pressable inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold ${
        done ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"
      }`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-white text-blue-700" : "border-2 border-slate-400"}`} aria-hidden="true">
        {done && <Icon name="check" size={12} strokeWidth={3} />}
      </span>
      {done ? (es ? "Hecho" : "Done") : es ? "Marcar como hecho" : "Mark as done"}
    </button>
  );
}

export function PlanItemCard({ entry, locale, done, onToggle, open, onOpen }: { entry: PersonalItem; locale: L; done: boolean; onToggle: () => Promise<unknown>; open: boolean; onOpen: () => void }) {
  const es = locale === "es";
  const { item, note } = entry;
  return (
    <li className="card overflow-hidden" data-testid={`plan-${item.key}`}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="pressable flex w-full items-start gap-3.5 px-4 py-4 text-left hover:bg-slate-50">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-blue-700 text-white" : "border-2 border-slate-300 text-transparent"}`} aria-hidden="true">
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold leading-snug text-slate-900">{item.title[locale]}</span>
          {note && <span className="mt-1 block text-[14px] leading-snug text-blue-900">{note}</span>}
        </span>
        <Icon name="chevron" size={18} className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t hairline px-4 pb-4 pt-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Por qué importa" : "Why it matters"}</p>
          <p className="mt-1 text-[16px] leading-relaxed text-slate-800">{item.why[locale]}</p>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Qué hacer" : "What to do"}</p>
          <ul className="mt-1 space-y-1.5">
            {item.steps[locale].map((s) => (
              <li key={s} className="flex gap-2 text-[16px] leading-relaxed text-slate-800">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" />
                {s}
              </li>
            ))}
          </ul>
          {item.options && (
            <div className="mt-4 space-y-3" data-testid="tradeline-options">
              {item.options.map((o) => (
                <div key={o.key} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[16px] font-semibold text-slate-900">{o.title[locale]}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{o.how[locale]}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "A favor" : "Pros"}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[14px] leading-snug text-slate-700">
                        {o.pros[locale].map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "En contra" : "Cons"}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[14px] leading-snug text-slate-700">
                        {o.cons[locale].map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-2 text-[14px] leading-snug text-slate-700">
                    <span className="font-semibold">{es ? "Costo: " : "Cost: "}</span>
                    {o.cost[locale]}
                  </p>
                  <p className="mt-1 text-[14px] leading-snug text-slate-700">
                    <span className="font-semibold">ITIN: </span>
                    {o.itin[locale]}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MarkButton done={done} onToggle={onToggle} locale={locale} testId={`mark-${item.key}`} />
            {item.tool === "utilizacion" && (
              <Link href="/aprende/herramientas/utilizacion" className="pressable inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-blue-700">
                <Icon name="calc" size={18} />
                {es ? "Usar la calculadora" : "Use the calculator"}
              </Link>
            )}
            {item.lesson && (
              <Link href={`/aprende/${item.lesson}`} className="pressable inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-blue-700">
                <Icon name="book" size={18} />
                {es ? "Lección" : "Lesson"}
              </Link>
            )}
          </div>
          <SourceList keys={item.sources} locale={locale} />
        </div>
      )}
    </li>
  );
}

export function OfferCard({ offer, locale }: { offer: Offer; locale: L }) {
  const l = OFFER_LABELS[locale];
  return (
    <li className="card p-4" data-testid="offer">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">{OFFER_KIND_LABEL[locale][offer.kind]}</span>
        {offer.itinFriendly && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-semibold text-blue-900" data-testid="offer-itin">{l.itin}</span>}
      </div>
      <p className="mt-2 text-[17px] font-semibold leading-snug text-slate-900">{offer.name}</p>
      <p className="text-[14px] text-slate-600">{offer.provider}</p>
      <dl className="mt-2 text-[14px] leading-snug">
        <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{l.cost}</dt>
        <dd className="mt-0.5 font-medium text-slate-900">{yearlyCostLabel(offer.yearlyCostCents, locale)}</dd>
        <dd className="text-slate-600">{offer.costNote}</dd>
      </dl>
      {offer.affiliate && (
        <div className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 text-[14px] leading-snug text-blue-900" data-testid="offer-disclosure" role="note">
          <p className="font-semibold">{AFFILIATE_LINE[locale]}</p>
          {offer.affiliateDisclosure && <p className="mt-1">{offer.affiliateDisclosure}</p>}
        </div>
      )}
      <a
        href={offer.url}
        target="_blank"
        rel={offer.affiliate ? "noopener noreferrer sponsored" : "noopener noreferrer"}
        className="pressable mt-3 flex h-12 items-center justify-center rounded-full bg-slate-100 text-[16px] font-semibold text-slate-900 hover:bg-slate-200"
      >
        {l.visit}
      </a>
    </li>
  );
}

export function OffersSection({ offers, locale, itinOnly = false }: { offers: readonly Offer[]; locale: L; itinOnly?: boolean }) {
  const i = OFFERS_INTRO[locale];
  const shown = itinOnly ? offers.filter((o) => o.itinFriendly) : offers;
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="offers" data-testid="offers">
      <h2 id="offers" className="px-1 pb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{i.title}</h2>
      <div className="card mb-3 px-4 py-3.5">
        <p className="text-[15px] leading-relaxed text-slate-800">{i.lead}</p>
        <ul className="mt-2 space-y-1 text-[13.5px] leading-snug text-slate-600">
          {i.never.map((n) => (
            <li key={n} className="flex gap-2">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-slate-400" />
              {n}
            </li>
          ))}
        </ul>
      </div>
      <ol className="space-y-3">
        {shown.map((o) => (
          <OfferCard key={o.id} offer={o} locale={locale} />
        ))}
      </ol>
    </section>
  );
}
