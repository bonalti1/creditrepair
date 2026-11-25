"use client";

import Link from "next/link";
import type { DeptCard } from "@/lib/control/overview";
import { OVERVIEW_TEXT } from "@/lib/control/overview";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon, { type IconName } from "@/components/Icon";
import SafeBoundary from "./SafeBoundary";

// The Overview's department cards (src/lib/control/overview.ts): the numbers,
// and "Needs you" opening the screen where it is done. A number we could not
// read says "No data yet" and why, never a 0.

const ICON: Record<DeptCard["key"], IconName> = {
  leads: "inbox",
  clients: "person",
  money: "calc",
  support: "chat",
  partners: "link",
  health: "info",
};

function Card({ card }: { card: DeptCard }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const noData = OVERVIEW_TEXT[locale].noData;
  const needs = card.needsYou.count;
  return (
    <section className="card flex flex-col px-5 py-4" aria-labelledby={`card-${card.key}`} data-testid={`dept-${card.key}`} id={card.key === "health" ? "health" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`card-${card.key}`} className="flex items-center gap-2 font-display text-[17px] font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <Icon name={ICON[card.key]} size={17} />
          </span>
          {card.title}
        </h2>
        <Link
          href={card.needsYou.href}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold md:min-h-9 ${
            needs === null ? "bg-slate-100 text-slate-600" : needs > 0 ? "bg-amber-400 text-blue-900 hover:bg-amber-500" : "bg-green-50 text-green-700"
          }`}
          data-testid={`needs-${card.key}`}
        >
          {card.needsYou.label}: <span className="tabular-nums">{needs === null ? "—" : needs}</span>
          <Icon name="chevron" size={14} />
        </Link>
      </div>
      <dl className="mt-3 divide-y divide-slate-100">
        {card.metrics.map((m) => (
          <div key={m.key} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="min-w-0 text-[14px] leading-snug text-slate-600">{m.label}</dt>
            <dd className="shrink-0 text-right">
              {m.value === null ? (
                <span className="block text-[13px] font-semibold text-slate-500" data-testid="no-data">
                  {noData}
                </span>
              ) : (
                <span className="block text-[18px] font-semibold leading-tight text-slate-900 tabular-nums">{m.value}</span>
              )}
              {m.hint && <span className="block text-[12px] text-slate-500 tabular-nums">{m.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {card.metrics.filter((m) => m.value === null && m.why).map((m) => (
        <p key={`${m.key}-why`} className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
          {card.metrics.length > 1 ? `${m.label}: ` : ""}
          {m.why}
        </p>
      ))}
      {card.key === "health" && (
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          {t(
            "Solo lo que ya se puede revisar: cuándo pasó cada cosa por última vez. Las alertas de caídas y la revisión completa llegan en la fase 3.",
            "Only what can be checked today: when each thing last happened. Outage alerts and the full check-up come in phase 3.",
          )}
        </p>
      )}
    </section>
  );
}

export default function OverviewCards({ cards }: { cards: DeptCard[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="overview-cards">
      {cards.map((card) => (
        <SafeBoundary key={card.key}>
          <Card card={card} />
        </SafeBoundary>
      ))}
    </div>
  );
}
