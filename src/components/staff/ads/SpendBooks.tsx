"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adSpendChecks, type SpendCheck } from "@/lib/ads/books";
import { fetchAdsMonthly } from "@/lib/ads/data";
import { ADS_TEXT } from "@/lib/ads/text";
import type { Expense } from "@/lib/accounting/types";
import { monthLabel } from "@/lib/accounting/periods";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { Chip } from "@/components/staff/ui";
import { money, SourceTag } from "./bits";

// Ad spend and the books (src/lib/ads/books.ts): Meta's spend per month beside
// what the books hold under "Advertising: Meta". A reconciliation SUGGESTION:
// the Ads Manager never writes to the books, because the books are cash basis
// (THE MONEY RULE, accounting/ledger.ts) and Meta's spend is not cash moving.
// A person records Meta's charge from its receipt or the bank file.

const TONE: Record<SpendCheck["status"], string> = {
  match: "bg-green-50 text-green-800",
  books_low: "bg-amber-100 text-blue-900",
  books_high: "bg-amber-100 text-blue-900",
  no_spend: "bg-slate-100 text-slate-600",
};

export function SpendTable({ checks, accounting }: { checks: SpendCheck[]; accounting: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  return (
    <ul className="divide-y divide-slate-100" data-testid="spend-checks">
      {checks.map((c) => (
        <li key={c.month} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5" data-status={c.status}>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold capitalize text-slate-900">{monthLabel(c.month, locale)}</span>
            <span className="block text-[12.5px] text-slate-600 tabular-nums">
              {t("Meta", "Meta")} {money(c.metaCents)} · {t("Libros", "Books")} {money(c.booksCents)}
              {c.status !== "match" && c.status !== "no_spend" && ` · ${t("diferencia", "difference")} ${money(Math.abs(c.differenceCents))}`}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Chip tone={TONE[c.status]}>{text.spend[c.status]}</Chip>
            {accounting && c.status === "books_low" && (
              <Link href={`/equipo/contabilidad?tab=expenses&mes=${c.month}`} className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-blue-700 hover:underline md:min-h-0">
                {t("Registrar el cargo", "Record the charge")}
                <Icon name="chevron" size={13} />
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Why the Ads Manager does not put Meta's spend in the books by itself. */
export function MoneyRuleNote() {
  const t = useTx();
  return (
    <p className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">
      {t(
        "Los libros son base de caja: cuentan el día en que el dinero se movió, con el recibo o el archivo del banco. Meta cobra la tarjeta después (al llegar a un monto o cada mes), así que su gasto no entra solo a los libros: contaría dos veces el mismo dinero y en otro día. Cuando difieran, registra el cargo de Meta con su recibo, bajo «Publicidad: Meta». Las diferencias al final del mes son normales.",
        "The books are cash basis: they count the day money moved, from the receipt or the bank file. Meta charges the card later (at a threshold or monthly), so its spend never goes into the books by itself: it would count the same money twice, on another day. When they differ, record Meta's charge from its receipt, under “Advertising: Meta”. Differences at a month's edge are normal.",
      )}
    </p>
  );
}

/**
 * On Accounting's Expenses tab: Meta's spend for the month beside the books'
 * "Advertising: Meta". Shows only for a member who may see the ads (ads.view),
 * and only once Meta's numbers were read; otherwise nothing.
 */
export function AdSpendCheck({ month, expenses }: { month: string; expenses: readonly Expense[] }) {
  const t = useTx();
  const { viewer } = useViewer();
  const [monthly, setMonthly] = useState<Map<string, number> | null>(null);
  const [sample, setSample] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchAdsMonthly(viewer).then((out) => {
      if (!live || !out) return;
      setMonthly(new Map(out.monthly.map((m) => [m.month, m.spendCents])));
      setSample(out.sample);
    });
    return () => {
      live = false;
    };
  }, [viewer]);
  if (!monthly || monthly.size === 0) return null;
  const [check] = adSpendChecks(monthly, expenses, [month]);
  if (!check || check.status === "no_spend") return null;
  return (
    <section className="card mb-5 px-5 py-4" aria-labelledby="ad-spend-check" data-testid="ad-spend-check">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ad-spend-check" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
          {t("Gasto en anuncios de Meta", "Meta ad spend")}
        </h2>
        <span className="flex items-center gap-1.5">
          <SourceTag source="meta" />
          {sample && <Chip tone="bg-amber-100 text-blue-900">{t("Muestra", "Sample")}</Chip>}
        </span>
      </div>
      <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
        {t("Una sugerencia para conciliar, no un asiento: compara lo que Meta dice que se gastó con lo que los libros tienen.", "A reconciliation suggestion, not an entry: Meta's spend beside what the books hold.")}
      </p>
      <SpendTable checks={[check]} accounting={false} />
      <p className="text-[12.5px] text-slate-500">
        <Link href="/equipo/anuncios?vista=libros" className="font-semibold text-blue-700 hover:underline">
          {t("Ver mes por mes en Anuncios", "See month by month in Ads")}
        </Link>
      </p>
    </section>
  );
}
