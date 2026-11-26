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
  content: "grid",
  ads: "megaphone",
  seo: "search",
  support: "chat",
  partners: "link",
  ideas: "bulb",
  health: "info",
};

/** The section of the console's menu each card belongs to (lib/staff/nav.ts), shown as ALTO's "3 · LEADS". */
const NUMBER: Partial<Record<DeptCard["key"], string>> = { leads: "3", clients: "1", money: "5", content: "2", ads: "2", seo: "2", support: "4", partners: "7", ideas: "8", health: "9" };

/** «Needs you»: a red circle with the count (ALTO's), "✓ Clear" at zero, a dash when it is not known. */
function NeedsYou({ card }: { card: DeptCard }) {
  const t = useTx();
  const needs = card.needsYou.count;
  return (
    <Link
      href={card.needsYou.href}
      className={`pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold md:min-h-9 ${
        needs === null ? "border-slate-200 bg-slate-50 text-slate-600" : needs > 0 ? "border-red-200 bg-white text-slate-900 hover:border-red-600" : "border-green-200 bg-green-50 text-green-800"
      }`}
      data-testid={`needs-${card.key}`}
    >
      {needs !== null && needs === 0 ? (
        <>
          <Icon name="check" size={14} />
          {t("Al día", "Clear")}
          <span className="sr-only">
            {card.needsYou.label}: 0
          </span>
        </>
      ) : (
        <>
          {needs === null ? (
            <span className="tabular-nums">{card.needsYou.label}: —</span>
          ) : (
            <>
            {card.needsYou.label}
            <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[12px] leading-none text-white tabular-nums">
              <span className="sr-only">: </span>
              {needs}
            </span>
            </>
          )}
        </>
      )}
      <Icon name="chevron" size={14} />
    </Link>
  );
}

function Card({ card }: { card: DeptCard }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const noData = OVERVIEW_TEXT[locale].noData;
  const big = card.metrics.length <= 4;
  return (
    <section className="card flex flex-col px-5 py-4" aria-labelledby={`card-${card.key}`} data-testid={`dept-${card.key}`} id={card.key === "health" ? "health" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`card-${card.key}`} className="flex min-w-0 items-center gap-2 font-display text-[15px] font-semibold uppercase leading-tight tracking-[0.06em] text-blue-900">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
            <Icon name={ICON[card.key]} size={17} />
          </span>
          <span className="min-w-0">
            {NUMBER[card.key] && <span className="text-slate-500">{NUMBER[card.key]} · </span>}
            {card.title}
          </span>
        </h2>
        <NeedsYou card={card} />
      </div>
      {big ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
          {card.metrics.map((m) => (
            <div key={m.key} className="min-w-0">
              <dt className="console-label text-[11.5px] text-slate-600">{m.label}</dt>
              <dd className="mt-1">
                {m.value === null ? (
                  <span className="block text-[13px] font-semibold text-slate-500" data-testid="no-data">
                    {noData}
                  </span>
                ) : (
                  <span className="block font-display text-[26px] font-semibold leading-tight text-blue-900 tabular-nums [overflow-wrap:anywhere]">{m.value}</span>
                )}
                {m.hint && <span className="mt-0.5 block text-[12px] leading-snug text-slate-500 tabular-nums">{m.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="mt-3 divide-y divide-slate-100">
          {card.metrics.map((m) => (
            <div key={m.key} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="min-w-0 text-[14px] leading-snug text-slate-700">{m.label}</dt>
              <dd className="max-w-[60%] shrink-0 text-right">
                {m.value === null ? (
                  <span className="block text-[13px] font-semibold text-slate-500" data-testid="no-data">
                    {noData}
                  </span>
                ) : (
                  <span className="block font-display text-[17px] font-semibold leading-tight text-blue-900 tabular-nums">{m.value}</span>
                )}
                {m.hint && <span className="block text-[12px] text-slate-500 tabular-nums">{m.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {card.metrics.filter((m) => m.value === null && m.why).map((m) => (
        <p key={`${m.key}-why`} className="mt-2 rounded-[10px] bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">
          {card.metrics.length > 1 ? `${m.label}: ` : ""}
          {m.why}
        </p>
      ))}
      {card.link && (
        <Link href={card.link.href} className="mt-auto inline-flex min-h-11 items-center gap-1 self-start pt-2 text-[13.5px] font-semibold text-blue-700 underline-offset-2 hover:underline md:min-h-9" data-testid={`open-${card.key}`}>
          {card.link.label}
          <Icon name="chevron" size={14} />
        </Link>
      )}
      {card.key === "health" && (
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          {t(
            "Cuándo pasó cada cosa por última vez. Cada servicio, cada tarea programada y «Revisar ahora» están en «Listo para lanzar» · Salud del sistema.",
            "When each thing last happened. Every service, every scheduled job and “Check now” are in Launch readiness · System health.",
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
