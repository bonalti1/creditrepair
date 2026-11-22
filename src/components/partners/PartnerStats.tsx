"use client";

import { useMemo } from "react";
import { formatCents } from "@/lib/billing/rules";
import { usePartners } from "@/lib/partners/data";
import { partnerMetrics, PARTNER_METRIC_INFO, type PartnerMetricKey } from "@/lib/partners/metrics";
import { PERIOD_LABEL, type Period } from "@/lib/staff/metrics";
import type { StaffClient } from "@/lib/staff/types";
import Definition from "@/components/staff/Definition";
import { SectionTitle } from "@/components/staff/ui";

// The "Socios" section of the business dashboard (/equipo/negocio): referrals,
// signed, active and the commission an administrator recorded, each with its
// definition (partners/metrics.ts), then the same per partner.

function Stat({ metric, value, note }: { metric: PartnerMetricKey; value: string; note?: string }) {
  const info = PARTNER_METRIC_INFO[metric];
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
  const m = useMemo(() => (book ? partnerMetrics(clients, book.partners, book.commissions, period, now) : null), [book, clients, period, now]);
  if (!ready || !m) return null;
  return (
    <section className="mt-7" aria-labelledby="socios-num" data-testid="partner-stats">
      <SectionTitle>
        <span id="socios-num">Socios · {PERIOD_LABEL[period].toLowerCase()}</span>
      </SectionTitle>
      <div className="card grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-6 [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-slate-900/[0.06]">
        <Stat metric="partnerReferrals" value={String(m.referrals)} />
        <Stat metric="partnerSigned" value={String(m.signed)} />
        <Stat metric="partnerActive" value={String(m.active)} />
        <Stat metric="partnerOwed" value={formatCents(m.owedCents)} />
        <Stat metric="partnerPaid" value={formatCents(m.paidCents)} />
        <Stat metric="partnersApproved" value={String(m.approved)} note={m.pending > 0 ? `(${m.pending} por revisar)` : undefined} />
      </div>
      {m.rows.length > 0 && (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[14px] tabular-nums">
            <thead>
              <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Socio</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerReferrals.definition}>Referidos</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerSigned.definition}>Firmaron</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerActive.definition}>Activos hoy</th>
                <th className="px-3 py-2.5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerOwed.definition}>Registrado</th>
                <th className="px-3 py-2.5 pr-5 text-right font-semibold" title={PARTNER_METRIC_INFO.partnerPaid.definition}>Pagado</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((row) => (
                <tr key={row.id} className="border-b hairline last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-900">{row.name}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.referrals}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.signed}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{row.active}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{formatCents(row.owedCents)}</td>
                  <td className="px-3 py-2.5 pr-5 text-right text-slate-900">{formatCents(row.paidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
        Las comisiones son las que una persona administradora registró en Socios. La app no las calcula ni las paga, y ninguna depende de lo que pase en un reporte.
      </p>
    </section>
  );
}
