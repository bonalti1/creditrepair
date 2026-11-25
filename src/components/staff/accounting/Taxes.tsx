"use client";

import { useState } from "react";
import type { useAccounting } from "@/lib/accounting/data";
import { formatCents } from "@/lib/accounting/money";
import { yearToDate, type MonthKey } from "@/lib/accounting/periods";
import { totalsFor } from "@/lib/accounting/summary";
import { TAX_DISCLAIMER, taxSetAside, upcomingDeadlines } from "@/lib/accounting/taxes";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { longDay } from "@/lib/staff/format";
import { Chip, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL_INLINE, Money, Note, Tile, TileGrid, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

const SCOPE = {
  everyone: { en: "Everyone", es: "Todos" },
  payroll: { en: "If you run payroll", es: "Si hay nómina" },
  partners: { en: "If you paid partners or contractors", es: "Si pagaste socios o contratistas" },
  entity: { en: "Depends on your entity", es: "Depende de tu tipo de empresa" },
};

export default function Taxes({ acc, month }: { acc: Acc; month: MonthKey }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const [pct, setPct] = useState(String(acc.book.settings.taxSetAsideBps / 100));
  const [message, setMessage] = useState<string | null>(null);
  const ytd = totalsFor(acc.input, yearToDate(month));
  const aside = taxSetAside(ytd.netProfitCents, acc.book.settings.taxSetAsideBps);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const deadlines = upcomingDeadlines(today);

  const save = async () => {
    const bps = Math.round(Number(pct) * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > 6000) return setMessage(t("Un porcentaje de 0 a 60.", "A percentage from 0 to 60."));
    const result = await acc.act({ action: "set_tax_rate", bps });
    setMessage(result.ok ? t("Guardado.", "Saved.") : bi(result.message));
  };

  return (
    <div className="space-y-6" data-testid="taxes">
      <Note tone="warn" testId="tax-disclaimer">
        {bi(TAX_DISCLAIMER)}
      </Note>
      <TileGrid cols="grid-cols-1 sm:grid-cols-3">
        <Tile label={t("Ganancia en el año", "Profit year to date")}>
          <Money cents={ytd.netProfitCents} empty={!ytd.hasData} />
        </Tile>
        <Tile label={t("Porcentaje para impuestos (lo eliges tú)", "Tax set-aside (your choice)")}>
          <div className="flex items-center gap-2">
            <input className={`${CONTROL_INLINE} w-24`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label={t("Porcentaje", "Percentage")} data-testid="tax-pct" />
            <span className="text-[18px]">%</span>
            <button type="button" className={SECONDARY_BUTTON} onClick={save}>
              {t("Guardar", "Save")}
            </button>
          </div>
        </Tile>
        <Tile label={t("Apartar (estimado)", "Set aside (estimate)")} note={bi(TAX_DISCLAIMER)} testId="tax-aside">
          {ytd.hasData ? formatCents(aside) : <Money cents={null} />}
        </Tile>
      </TileGrid>
      {message && <Note>{message}</Note>}

      <section aria-labelledby="deadlines">
        <SectionTitle>
          <span id="deadlines">{t("Fechas de los próximos 12 meses", "Dates in the next 12 months")}</span>
        </SectionTitle>
        <ul className="card divide-y divide-slate-900/[0.06]" data-testid="deadlines">
          {deadlines.map((d) => (
            <li key={`${d.due}-${d.title.en}`} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <p className="text-[14.5px] font-medium text-slate-900">{d.title[locale]}</p>
                <p className="text-[13px] text-slate-500">{d.detail[locale]}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[14px] font-semibold tabular-nums text-slate-900">{longDay(`${d.due}T18:00:00Z`, locale)}</span>
                <Chip tone="bg-slate-100 text-slate-600">{SCOPE[d.scope][locale]}</Chip>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-[12.5px] text-slate-500">
          {t(
            "Fechas comunes, movidas al siguiente día hábil si caen en fin de semana (no se cuentan los feriados). ¿Aplica el impuesto de ventas de Texas a los servicios de Credalti? Es una pregunta abierta para el contador (ver docs/ACCOUNTING.md); aquí no se calcula.",
            "Common dates, moved to the next weekday when they fall on a weekend (holidays are not counted). Does Texas sales tax apply to Credalti's services? That is an open question for the CPA (see docs/ACCOUNTING.md); nothing is computed for it here.",
          )}
        </p>
      </section>
    </div>
  );
}
