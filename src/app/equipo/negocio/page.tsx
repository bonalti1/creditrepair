"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PLAN_TYPE_LABEL } from "@/lib/billing/plans";
import { formatCents } from "@/lib/billing/rules";
import {
  businessMetrics,
  formatPercent,
  METRIC_INFOS,
  monthlySeries,
  PERIOD_LABELS,
  PERIODS,
  type MetricKey,
  type MonthPoint,
  type Period,
} from "@/lib/staff/metrics";
import { ROLE_LABELS, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { useMail } from "@/lib/mail/useMail";
import Definition from "@/components/staff/Definition";
import PartnerStats from "@/components/partners/PartnerStats";
import OutcomesLearning from "@/components/staff/OutcomesLearning";
import { DashboardPulse } from "@/components/staff/PulseCards";
import { NoAccess, SectionTitle } from "@/components/staff/ui";

// The numbers an owner checks, from the same records the console shows.
// Numbers first, a definition behind every one ("Cómo se cuenta"), and two
// plain monthly charts. Nothing here claims a result a report cannot prove:
// the one number about reports is "Puntos que ya no aparecen en el reporte".
// Administrators only.

function Stat({ metric, value, note }: { metric: MetricKey; value: string; note?: string }) {
  const { locale } = useStaffLocale();
  const info = METRIC_INFOS[locale][metric];
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

/** A grid of stats with hairlines between cells, on any width. */
function StatGrid({ children, cols }: { children: React.ReactNode; cols: string }) {
  return <div className={`card grid overflow-hidden [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-slate-900/[0.06] ${cols}`}>{children}</div>;
}

function Bars({ title, points, value, format, definition }: { title: string; points: MonthPoint[]; value: (p: MonthPoint) => number; format: (n: number) => string; definition: string }) {
  const t = useTx();
  const max = Math.max(1, ...points.map(value));
  return (
    <figure className="card px-5 pb-4 pt-4" aria-label={title}>
      <figcaption className="flex items-start gap-1.5">
        <span className="text-[14px] font-semibold text-slate-900">{title}</span>
        <Definition label={title} text={definition} />
      </figcaption>
      <div className="mt-4 flex h-36 items-end gap-2 border-b border-slate-200" role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${format(value(p))}`).join(", ")}`}>
        {points.map((p, i) => {
          const v = value(p);
          const last = i === points.length - 1;
          return (
            <div key={p.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <span
                className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[12px] font-medium text-white tabular-nums ${last ? "block" : "hidden group-hover:block"}`}
                style={{ bottom: `calc(${(v / max) * 100}% + 6px)` }}
              >
                {format(v)}
              </span>
              <div
                className={`mx-auto w-full max-w-10 rounded-t-[4px] ${last ? "bg-blue-700" : "bg-blue-700/45 group-hover:bg-blue-700/70"}`}
                style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {points.map((p, i) => (
          <span key={p.key} className={`min-w-0 flex-1 text-center text-[12px] ${i === points.length - 1 ? "font-semibold text-slate-700" : "text-slate-500"}`}>
            {p.label}
          </span>
        ))}
      </div>
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-0">{t("Ver como tabla", "See as a table")}</summary>
        <table className="mt-2 w-full text-[13px] tabular-nums">
          <tbody>
            {points.map((p) => (
              <tr key={p.key} className="border-t hairline">
                <td className="py-1.5 text-slate-600">{p.label}</td>
                <td className="py-1.5 text-right text-slate-900">{format(value(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const TEAM_COLUMNS: Array<[MetricKey, { es: string; en: string }]> = [
  ["memberAssigned", { es: "Clientes", en: "Clients" }],
  ["memberRounds", { es: "Rondas", en: "Rounds" }],
  ["memberReplies", { es: "Respuestas", en: "Replies" }],
  ["memberExceptions", { es: "Avisos", en: "Notices" }],
];
const SALES_COLUMNS: Array<[MetricKey, { es: string; en: string }]> = [
  ["salesInvites", { es: "Prospectos", en: "Leads" }],
  ["salesSigned", { es: "Firmaron", en: "Signed" }],
  ["salesCancelled", { es: "Cancelaron", en: "Cancelled" }],
];

/** A table's rows as small blocks, for a phone: the name, then each number under its column name. */
function PhoneRows({ rows, columns }: { rows: Array<{ key: string; name: string; sub?: string; values: string[] }>; columns: string[] }) {
  return (
    <ul className="card overflow-hidden sm:hidden">
      {rows.map((row, i) => (
        <li key={row.key} className={`px-4 py-3 ${i > 0 ? "border-t hairline" : ""}`}>
          <p className="text-[15px] font-medium text-slate-900">
            {row.name}
            {row.sub && <span className="ml-1.5 text-[12px] font-normal text-slate-500">{row.sub}</span>}
          </p>
          <dl className="mt-1.5 grid gap-2 tabular-nums" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
            {columns.map((column, c) => (
              <div key={column} className="min-w-0">
                <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{column}</dt>
                <dd className="text-[16px] font-semibold text-slate-900">{row.values[c]}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** The definitions of a table's columns, one tap away (a tooltip inside a scrolling table would be cut off). */
function HowCounted({ keys }: { keys: MetricKey[] }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const METRIC_INFO = METRIC_INFOS[locale];
  return (
    <details className="px-1 pt-2">
      <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-0">{t("Cómo se cuenta", "How it's counted")}</summary>
      <dl className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-slate-600">
        {keys.map((k) => (
          <div key={k}>
            <dt className="inline font-semibold text-slate-800">{METRIC_INFO[k].label}: </dt>
            <dd className="inline">{METRIC_INFO[k].definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Dashboard() {
  const { ready, clients, members, now, can, locale } = useStaff();
  const t = useTx();
  const METRIC_INFO = METRIC_INFOS[locale];
  const PERIOD_LABEL = PERIOD_LABELS[locale];
  const ROLE_LABEL = ROLE_LABELS[locale];
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const periodParam = params.get("periodo") ?? "";
  const period: Period = (PERIODS as readonly string[]).includes(periodParam) ? (periodParam as Period) : "month";

  const { env, ready: autopilotReady } = useAutopilot();
  const { furnishers, ready: bookReady } = useMail();
  const m = useMemo(() => businessMetrics(clients, members, period, now, env, furnishers), [clients, members, period, now, env, furnishers]);
  const series = useMemo(() => monthlySeries(clients, now, 6, locale), [clients, now, locale]);

  if (!ready || !autopilotReady || !bookReady) return null;
  if (!can("business.view")) return <NoAccess title={t("Negocio", "Business")} reason={deniedReason("business.view", locale)} />;

  const days = (n: number | null) => (n === null ? "—" : t(`${Math.round(n)} días`, `${Math.round(n)} days`));
  const money = (n: number | null) => (n === null ? "—" : formatCents(n));

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Negocio", "Business")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            {t("De los mismos registros que la consola. Toca «?» para ver cómo se cuenta cada número.", "From the same records as the console. Tap “?” to see how each number is counted.")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-3xl bg-slate-100 p-1 sm:flex sm:rounded-full" role="group" aria-label={t("Periodo", "Period")}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => router.replace(p === "month" ? pathname : `${pathname}?periodo=${p}`, { scroll: false })}
              className={`pressable h-11 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold sm:h-8 ${period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-7" aria-labelledby="clientes">
        <SectionTitle>
          <span id="clientes">{t("Clientes", "Clients")}</span>
        </SectionTitle>
        <StatGrid cols="grid-cols-2 sm:grid-cols-4">
          <Stat metric="newLeads" value={String(m.clients.newLeads)} />
          <Stat metric="signed" value={String(m.clients.signed)} />
          <Stat metric="conversion" value={formatPercent(m.clients.conversion)} />
          <Stat metric="cancelled" value={String(m.clients.cancelled)} />
          <Stat metric="active" value={String(m.clients.active)} />
          <Stat metric="paused" value={String(m.clients.paused)} />
          <Stat metric="ended" value={String(m.clients.ended)} />
          <Stat metric="churn" value={formatPercent(m.clients.churn)} />
        </StatGrid>
      </section>

      <section className="mt-7" aria-labelledby="trabajo">
        <SectionTitle>
          <span id="trabajo">{t("Trabajo", "Work")}</span>
        </SectionTitle>
        <StatGrid cols="grid-cols-2 sm:grid-cols-3">
          <Stat metric="roundsMailed" value={String(m.work.roundsMailed)} />
          <Stat metric="lettersMailed" value={String(m.work.lettersMailed)} />
          <Stat metric="itemsDisputed" value={String(m.work.itemsDisputed)} />
          <Stat metric="itemsNoLongerReported" value={String(m.work.itemsNoLongerReported)} />
          <Stat metric="daysToFirstRound" value={days(m.work.daysToFirstRound)} />
          <Stat
            metric="roundsOverdue"
            value={t(`${m.work.roundsOverdue} de ${m.work.inCycle}`, `${m.work.roundsOverdue} of ${m.work.inCycle}`)}
            note={t("clientes con rondas enviadas", "clients with rounds mailed")}
          />
          <Stat
            metric="humanMinutesPerActive"
            value={m.work.humanMinutesPerActive === null ? "—" : `${m.work.humanMinutesPerActive.toFixed(1)} min`}
            note={t(`${m.work.humanMinutes} min estimados entre ${m.clients.active} activos`, `${m.work.humanMinutes} estimated min across ${m.clients.active} active`)}
          />
        </StatGrid>
      </section>

      <section className="mt-7" aria-labelledby="dinero">
        <SectionTitle>
          <span id="dinero">{t("Dinero", "Money")}</span>
        </SectionTitle>
        <StatGrid cols="grid-cols-2 sm:grid-cols-4">
          <Stat metric="charged" value={money(m.money.chargedCents)} />
          <Stat metric="refunded" value={money(m.money.refundedCents)} />
          <Stat metric="net" value={money(m.money.netCents)} />
          <Stat metric="revenuePerActive" value={money(m.money.revenuePerActiveCents)} />
          <Stat metric="failedPayments" value={String(m.money.failedCount)} note={m.money.failedCount > 0 ? money(m.money.failedCents) : undefined} />
          <Stat metric="recoveredPayments" value={String(m.money.recoveredCount)} note={m.money.recoveredCount > 0 ? money(m.money.recoveredCents) : undefined} />
          <Stat metric="scheduled30" value={money(m.money.scheduledCents)} note={m.money.scheduledCount === 1 ? t("1 cobro", "1 charge") : t(`${m.money.scheduledCount} cobros`, `${m.money.scheduledCount} charges`)} />
        </StatGrid>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          {t(
            "Se cobra solo por trabajo ya registrado, con los montos del plan firmado. Lo programado no incluye rondas que todavía no salen.",
            "Charges are only for work already on record, at the signed plan's amounts. What's scheduled doesn't include rounds that haven't gone out.",
          )}
        </p>
      </section>

      <section className="mt-7" aria-labelledby="cobros-planes" data-testid="billing-dashboard">
        <SectionTitle>
          <span id="cobros-planes">{t("Cobros por plan y método", "Billing by plan and method")}</span>
        </SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <figure className="card px-5 py-4" aria-label={METRIC_INFO.revenueByPlan.label} data-testid="metric-revenueByPlan">
            <figcaption className="flex items-start gap-1.5">
              <span className="text-[14px] font-semibold text-slate-900">{METRIC_INFO.revenueByPlan.label}</span>
              <Definition label={METRIC_INFO.revenueByPlan.label} text={METRIC_INFO.revenueByPlan.definition} />
            </figcaption>
            {m.money.byPlanType.length === 0 ? (
              <p className="mt-3 text-[14px] text-slate-500">{t("Nada cobrado en el periodo.", "Nothing charged in the period.")}</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {m.money.byPlanType.map((row) => {
                  const max = Math.max(1, ...m.money.byPlanType.map((r) => r.cents));
                  return (
                    <li key={row.type}>
                      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                        <span className="text-slate-700">{row.type === "legacy" ? t("Por ronda (antes de los planes)", "Per round (before plans)") : PLAN_TYPE_LABEL[row.type][locale]}</span>
                        <span className="font-semibold tabular-nums text-slate-900">{formatCents(row.cents)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
                        <div className="h-2 rounded-full bg-blue-700" style={{ width: `${(row.cents / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </figure>
          <StatGrid cols="grid-cols-2">
            <Stat
              metric="achShare"
              value={m.money.achShare === null ? "—" : formatPercent(m.money.achShare)}
              note={t(`ACH ${formatCents(m.money.achCents)} · tarjeta ${formatCents(m.money.cardCents)}`, `ACH ${formatCents(m.money.achCents)} · card ${formatCents(m.money.cardCents)}`)}
            />
            <Stat metric="feesEstimate" value={formatCents(m.money.feesEstimateCents)} note={t("estimado", "estimate")} />
            <Stat
              metric="chargebackRate"
              value={m.money.chargebackRate === null ? "—" : `${(m.money.chargebackRate * 100).toFixed(2)}%`}
              note={t(`${m.money.chargebacks} contracargos · aviso desde 0.75%`, `${m.money.chargebacks} chargebacks · warning from 0.75%`)}
            />
            <div className="flex min-w-0 flex-col justify-center gap-1.5 px-4 py-4 sm:px-5">
              <a href="/equipo/cobros" className="text-[14px] font-medium text-blue-700 underline-offset-2 hover:underline">
                {t("Facturas y exportar CSV", "Invoices and CSV export")}
              </a>
              <a href="/equipo/planes" className="text-[14px] font-medium text-blue-700 underline-offset-2 hover:underline">
                {t("Planes de cobro", "Billing plans")}
              </a>
            </div>
          </StatGrid>
        </div>
      </section>

      <DashboardPulse pulse={m.pulse} clients={clients} />

      <PartnerStats clients={clients} period={period} now={now} />

      {/* Internal operations data: what happened to past disputes (lib/staff/learning.ts). Never client-facing. */}
      <OutcomesLearning clients={clients} now={now} />

      <section className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2" aria-label={t("Por mes", "By month")}>
        <Bars
          title={t("Rondas enviadas por mes", "Rounds mailed by month")}
          points={series}
          value={(p) => p.roundsMailed}
          format={(n) => String(n)}
          definition={`${METRIC_INFO.roundsMailed.definition} ${t("El mes actual va hasta hoy.", "The current month runs through today.")}`}
        />
        <Bars
          title={t("Neto cobrado por mes", "Net charged by month")}
          points={series}
          value={(p) => p.netCents}
          format={(n) => formatCents(n)}
          definition={`${METRIC_INFO.net.definition} ${t("El mes actual va hasta hoy.", "The current month runs through today.")}`}
        />
      </section>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section aria-labelledby="equipo-num">
          <SectionTitle>
            <span id="equipo-num">
              {t("Equipo", "Team")} · {PERIOD_LABEL[period].toLowerCase()}
            </span>
          </SectionTitle>
          <PhoneRows
            rows={m.team.map((row) => ({
              key: row.handle,
              name: row.name,
              sub: `${ROLE_LABEL[row.role]}${row.active ? "" : t(" · desactivada", " · deactivated")}`,
              values: [row.role === "sales" ? "—" : String(row.assigned), String(row.roundsSent), String(row.replies), row.role === "sales" ? "—" : String(row.openExceptions)],
            }))}
            columns={TEAM_COLUMNS.map(([, short]) => short[locale])}
          />
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[27rem] text-[14px] tabular-nums">
              <thead>
                <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">{t("Persona", "Person")}</th>
                  {TEAM_COLUMNS.map(([k, short]) => (
                    <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold last:pr-5" title={METRIC_INFO[k].definition}>
                      {short[locale]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.team.map((row) => (
                  <tr key={row.handle} className="border-b hairline last:border-b-0">
                    <td className="px-5 py-2.5">
                      <span className="whitespace-nowrap font-medium text-slate-900">{row.name}</span>
                      <span className="block text-[12px] text-slate-500">
                        {ROLE_LABEL[row.role]}
                        {row.active ? "" : t(" · desactivada", " · deactivated")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{row.role === "sales" ? "—" : row.assigned}</td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{row.roundsSent}</td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{row.replies}</td>
                    <td className="px-3 py-2.5 pr-5 text-right text-slate-900">{row.role === "sales" ? "—" : row.openExceptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HowCounted keys={TEAM_COLUMNS.map(([k]) => k)} />
        </section>

        <section aria-labelledby="ventas-num">
          <SectionTitle>
            <span id="ventas-num">
              {t("Ventas", "Sales")} · {PERIOD_LABEL[period].toLowerCase()}
            </span>
          </SectionTitle>
          <PhoneRows
            rows={m.sales.map((row) => ({ key: row.handle, name: row.name, values: [String(row.invites), String(row.signed), String(row.cancelled)] }))}
            columns={SALES_COLUMNS.map(([, short]) => short[locale])}
          />
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[20rem] text-[14px] tabular-nums">
              <thead>
                <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">{t("Quién trajo", "Brought in by")}</th>
                  {SALES_COLUMNS.map(([k, short]) => (
                    <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold last:pr-5" title={METRIC_INFO[k].definition}>
                      {short[locale]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.sales.map((row) => (
                  <tr key={row.handle} className="border-b hairline last:border-b-0">
                    <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-900">{row.name}</td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{row.invites}</td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{row.signed}</td>
                    <td className="px-3 py-2.5 pr-5 text-right text-slate-900">{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HowCounted keys={SALES_COLUMNS.map(([k]) => k)} />
        </section>
      </div>
    </main>
  );
}

export default function Negocio() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
