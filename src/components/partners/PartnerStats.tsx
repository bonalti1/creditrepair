"use client";

import { useMemo } from "react";
import { formatCents } from "@/lib/billing/rules";
import { usePartners } from "@/lib/partners/data";
import { partnerMetrics, PARTNER_METRIC_INFO as PARTNER_METRIC_INFO_ES, PARTNER_METRIC_INFO_EN, type PartnerMetricKey } from "@/lib/partners/metrics";
import { PERIOD_LABELS, type Period } from "@/lib/staff/metrics";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { StaffClient } from "@/lib/staff/types";
import Definition from "@/components/staff/Definition";
import { SectionTitle } from "@/components/staff/ui";

// The "Socios" section of the business dashboard (/equipo/negocio): referrals,
// signed, active and the commission an administrator recorded, each with its
// definition (partners/metrics.ts), then the same per partner. While
// "Comisiones a socios" is off (partners/program.ts) the commission figures
// are not shown at all: the program pays no referral fees.

function Stat({ metric, value, note }: { metric: PartnerMetricKey; value: string; note?: string }) {
  const { locale } = useStaffLocale();
  const info = (locale === "es" ? PARTNER_METRIC_INFO_ES : PARTNER_METRIC_INFO_EN)[metric];
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5" data-testid={`metric-${metric}`}>
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 text-[13px] leading-snug text-slate-500">{info.label}</p>
        <Definition label={info.label} text={info.definition} />
      </div>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{value}</p>
      {note && <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500">{note}</p>}
    </div>
  );
}

export default function PartnerStats({ clients, period, now }: { clients: StaffClient[]; period: Period; now: Date }) {
  const { book, ready } = usePartners();
  const { locale } = useStaffLocale();
  const t = useTx();
  const PARTNER_METRIC_INFO = locale === "es" ? PARTNER_METRIC_INFO_ES : PARTNER_METRIC_INFO_EN;
  const m = useMemo(() => (book ? partnerMetrics(clients, book.partners, book.commissions, period, now) : null), [book, clients, period, now]);
  if (!ready || !m || !book) return null;
  const fees = book.program.commissionsEnabled;
  return (
    <section className="mt-7" aria-labelledby="socios-num" data-testid="partner-stats">
      <SectionTitle>
        <span id="socios-num">
          {t("Socios", "Partners")} · {PERIOD_LABELS[locale][period].toLowerCase()}
        </span>
      </SectionTitle>
      <div className={`card grid grid-cols-2 overflow-hidden sm:grid-cols-3 ${fees ? "lg:grid-cols-6" : "lg:grid-cols-4"} [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-slate-900/[0.06]`}>
        <Stat metric="partnerReferrals" value={String(m.referrals)} />
        <Stat metric="partnerSigned" value={String(m.signed)} />
        <Stat metric="partnerActive" value={String(m.active)} />
        {fees && <Stat metric="partnerOwed" value={formatCents(m.owedCents)} />}
        {fees && <Stat metric="partnerPaid" value={formatCents(m.paidCents)} />}
        <Stat metric="partnersApproved" value={String(m.approved)} note={m.pending > 0 ? t(`(${m.pending} por revisar)`, `(${m.pending} to review)`) : undefined} />
      </div>
      {m.rows.length > 0 && (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[14px] tabular-nums">
            <thead>
              <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">{t("Socio", "Partner")}</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerReferrals.definition}>{t("Referidos", "Referrals")}</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerSigned.definition}>{t("Firmaron", "Signed")}</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerActive.definition}>{t("Activos hoy", "Active today")}</th>
                {fees && <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerOwed.definition}>{t("Registrado", "Recorded")}</th>}
                {fees && <th className="px-3 py-2.5 pr-5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerPaid.definition}>{t("Pagado", "Paid")}</th>}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((row) => (
                <tr key={row.id} className="border-b hairline last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-900">{row.name}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.referrals}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.signed}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.active}</td>
                  {fees && <td className="px-3 py-2.5 text-right text-slate-900">{formatCents(row.owedCents)}</td>}
                  {fees && <td className="px-3 py-2.5 pr-5 text-right text-slate-900">{formatCents(row.paidCents)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
        {fees
          ? t(
              "Las comisiones son las que una persona administradora registró en Socios. La app no las calcula ni las paga, y ninguna depende de lo que pase en un reporte.",
              "Commissions are the ones an administrator recorded under Partners. The app doesn't calculate or pay them, and none depends on what happens on a report.",
            )
          : t(
              "Comisiones a socios: apagadas hasta que el abogado lo apruebe. El programa no paga comisiones por referir, así que no hay cifras de comisión.",
              "Partner commissions: off until the attorney approves them. The program pays no referral commissions, so there are no commission figures.",
            )}
      </p>
    </section>
  );
}
