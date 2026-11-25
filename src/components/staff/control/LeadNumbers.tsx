"use client";

import { SOURCE_LABELS } from "@/lib/leads/inbox";
import { leadQuality, minutesText, percent, QUALITY_TEXT, QUALITY_WINDOW_DAYS, type Rate } from "@/lib/leads/metrics";
import { LEAD_SOURCES, type Lead } from "@/lib/leads/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// Lead quality numbers (src/lib/leads/metrics.ts), from the records only. A
// rate with no lead behind it is "No data yet" and says why; each number
// carries its definition.

function Tile({ label, value, sub, definition, why, testId }: { label: string; value: string | null; sub?: string; definition: string; why?: string; testId: string }) {
  const { locale } = useStaffLocale();
  return (
    <div className="card px-4 py-3.5" data-testid={testId}>
      <p className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {value === null ? (
        <p className="mt-1 text-[15px] font-semibold text-slate-500" data-testid="no-data">
          {QUALITY_TEXT[locale].noData}
        </p>
      ) : (
        <p className="mt-1 text-[24px] font-semibold leading-tight text-slate-900 tabular-nums">{value}</p>
      )}
      {sub && <p className="text-[12.5px] text-slate-500 tabular-nums">{sub}</p>}
      {why && <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{why}</p>}
      <details className="mt-1.5">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-6">{locale === "es" ? "Qué cuenta" : "What it counts"}</summary>
        <p className="text-[12.5px] leading-relaxed text-slate-600">{definition}</p>
      </details>
    </div>
  );
}

export default function LeadNumbers({ leads, now, compact = false }: { leads: Lead[]; now: Date; compact?: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const q = leadQuality(leads, now);
  const text = QUALITY_TEXT[locale];
  const d = text.definitions;
  const rate = (r: Rate) => (r.value === null ? null : percent(r.value));
  const of = (r: Rate) => (r.value === null ? undefined : t(`${r.count} de ${r.of}`, `${r.count} of ${r.of}`));
  const bySource = (counts: Partial<Record<string, number>>) =>
    LEAD_SOURCES.filter((s) => counts[s])
      .map((s) => `${SOURCE_LABELS[locale][s]} ${counts[s]}`)
      .join(" · ");
  const tiles = (
    <>
      <Tile testId="q-today" label={t("Nuevos hoy", "New today")} value={String(q.today.total)} sub={bySource(q.today.bySource) || undefined} definition={d.today} />
      <Tile testId="q-week" label={t("Nuevos, 7 días", "New, 7 days")} value={String(q.week.total)} sub={bySource(q.week.bySource) || undefined} definition={d.week} />
      <Tile
        testId="q-first-reply"
        label={t("Primera respuesta (mediana)", "First reply (median)")}
        value={q.medianFirstReplyMinutes === null ? null : minutesText(q.medianFirstReplyMinutes)}
        sub={q.medianFirstReplyMinutes === null ? undefined : t(`de ${q.repliedCount} prospectos`, `over ${q.repliedCount} leads`)}
        why={q.medianFirstReplyMinutes === null ? (q.windowLeads === 0 ? text.noLeadsWhy : text.noRepliesWhy) : undefined}
        definition={d.firstReply}
      />
      <Tile testId="q-contacted" label={t("Contactados", "Contacted")} value={rate(q.contacted)} sub={of(q.contacted)} why={q.contacted.value === null ? text.noLeadsWhy : undefined} definition={d.contacted} />
      <Tile testId="q-invited" label={t("Invitados", "Invited")} value={rate(q.invited)} sub={of(q.invited)} why={q.invited.value === null ? text.noLeadsWhy : undefined} definition={d.invited} />
      <Tile testId="q-signed" label={t("Firmaron", "Signed")} value={rate(q.signed)} sub={of(q.signed)} why={q.signed.value === null ? text.noLeadsWhy : undefined} definition={d.signed} />
    </>
  );
  return (
    <section aria-label={t("Calidad de los prospectos", "Lead quality")} data-testid="lead-numbers">
      <div className={`grid grid-cols-2 gap-3 ${compact ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-3"}`}>{tiles}</div>
      <p className="mt-2 px-1 text-xs leading-relaxed text-slate-500">
        {t(
          `Las tasas son de los prospectos que llegaron en los últimos ${QUALITY_WINDOW_DAYS} días, contados con los hechos (respuestas, invitaciones, firmas), nunca estimados.`,
          `Rates are over the leads that arrived in the last ${QUALITY_WINDOW_DAYS} days, counted from what happened (replies, invitations, signatures), never estimated.`,
        )}
      </p>
    </section>
  );
}

/** The same numbers in one line, on top of the inbox; "Numbers" has the definitions. */
export function QualityStrip({ leads, now, onMore }: { leads: Lead[]; now: Date; onMore: () => void }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const q = leadQuality(leads, now);
  const none = QUALITY_TEXT[locale].noData;
  const items: Array<[string, string | null]> = [
    [t("Nuevos hoy", "New today"), String(q.today.total)],
    [t("7 días", "7 days"), String(q.week.total)],
    [t("1.ª respuesta", "1st reply"), q.medianFirstReplyMinutes === null ? null : minutesText(q.medianFirstReplyMinutes)],
    [t("Contactados", "Contacted"), percent(q.contacted.value)],
    [t("Invitados", "Invited"), percent(q.invited.value)],
    [t("Firmaron", "Signed"), percent(q.signed.value)],
  ];
  return (
    <button type="button" onClick={onMore} className="pressable card flex w-full flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 text-left hover:bg-slate-50" data-testid="quality-strip">
      {items.map(([label, value]) => (
        <span key={label} className="text-[13px] text-slate-600">
          {label} <span className={`font-semibold tabular-nums ${value === null ? "text-slate-400" : "text-slate-900"}`}>{value ?? none}</span>
        </span>
      ))}
      <span className="ml-auto text-[13px] font-semibold text-blue-700">{t("Ver los números", "See the numbers")}</span>
    </button>
  );
}
