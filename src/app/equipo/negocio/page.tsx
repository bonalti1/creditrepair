"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatCents } from "@/lib/billing/rules";
import {
  businessMetrics,
  formatPercent,
  METRIC_INFO,
  monthlySeries,
  PERIOD_LABEL,
  PERIODS,
  type MetricKey,
  type MonthPoint,
  type Period,
} from "@/lib/staff/metrics";
import { ROLE_LABEL, deniedReason } from "@/lib/staff/permissions";
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
  const info = METRIC_INFO[metric];
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
        <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-0">Ver como tabla</summary>
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

const TEAM_COLUMNS: Array<[MetricKey, string]> = [
  ["memberAssigned", "Clientes"],
  ["memberRounds", "Rondas"],
  ["memberReplies", "Respuestas"],
  ["memberExceptions", "Avisos"],
];
const SALES_COLUMNS: Array<[MetricKey, string]> = [
  ["salesInvites", "Prospectos"],
  ["salesSigned", "Firmaron"],
  ["salesCancelled", "Cancelaron"],
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
  return (
    <details className="px-1 pt-2">
      <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-0">Cómo se cuenta</summary>
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
  const { ready, clients, members, now, can } = useStaff();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const periodParam = params.get("periodo") ?? "";
  const period: Period = (PERIODS as readonly string[]).includes(periodParam) ? (periodParam as Period) : "month";

  const { env, ready: autopilotReady } = useAutopilot();
  const { furnishers, ready: bookReady } = useMail();
  const m = useMemo(() => businessMetrics(clients, members, period, now, env, furnishers), [clients, members, period, now, env, furnishers]);
  const series = useMemo(() => monthlySeries(clients, now, 6), [clients, now]);

  if (!ready || !autopilotReady || !bookReady) return null;
  if (!can("business.view")) return <NoAccess title="Negocio" reason={deniedReason("business.view")} />;

  const days = (n: number | null) => (n === null ? "—" : `${Math.round(n)} días`);
  const money = (n: number | null) => (n === null ? "—" : formatCents(n));

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Negocio</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">De los mismos registros que la consola. Toca «?» para ver cómo se cuenta cada número.</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-3xl bg-slate-100 p-1 sm:flex sm:rounded-full" role="group" aria-label="Periodo">
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
          <span id="clientes">Clientes</span>
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
          <span id="trabajo">Trabajo</span>
        </SectionTitle>
        <StatGrid cols="grid-cols-2 sm:grid-cols-3">
          <Stat metric="roundsMailed" value={String(m.work.roundsMailed)} />
          <Stat metric="lettersMailed" value={String(m.work.lettersMailed)} />
          <Stat metric="itemsDisputed" value={String(m.work.itemsDisputed)} />
          <Stat metric="itemsNoLongerReported" value={String(m.work.itemsNoLongerReported)} />
          <Stat metric="daysToFirstRound" value={days(m.work.daysToFirstRound)} />
          <Stat metric="roundsOverdue" value={`${m.work.roundsOverdue} de ${m.work.inCycle}`} note="clientes con rondas enviadas" />
          <Stat
            metric="humanMinutesPerActive"
            value={m.work.humanMinutesPerActive === null ? "—" : `${m.work.humanMinutesPerActive.toFixed(1)} min`}
            note={`${m.work.humanMinutes} min estimados entre ${m.clients.active} activos`}
          />
        </StatGrid>
      </section>

      <section className="mt-7" aria-labelledby="dinero">
        <SectionTitle>
          <span id="dinero">Dinero</span>
        </SectionTitle>
        <StatGrid cols="grid-cols-2 sm:grid-cols-4">
          <Stat metric="charged" value={money(m.money.chargedCents)} />
          <Stat metric="refunded" value={money(m.money.refundedCents)} />
          <Stat metric="net" value={money(m.money.netCents)} />
          <Stat metric="revenuePerActive" value={money(m.money.revenuePerActiveCents)} />
          <Stat metric="failedPayments" value={String(m.money.failedCount)} note={m.money.failedCount > 0 ? money(m.money.failedCents) : undefined} />
          <Stat metric="recoveredPayments" value={String(m.money.recoveredCount)} note={m.money.recoveredCount > 0 ? money(m.money.recoveredCents) : undefined} />
          <Stat metric="scheduled30" value={money(m.money.scheduledCents)} note={`${m.money.scheduledCount === 1 ? "1 cobro" : `${m.money.scheduledCount} cobros`}`} />
        </StatGrid>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          Se cobra solo por rondas ya enviadas, a la cuota del acuerdo firmado. Lo programado no incluye rondas que todavía no salen.
        </p>
      </section>

      <DashboardPulse pulse={m.pulse} clients={clients} />

      <PartnerStats clients={clients} period={period} now={now} />

      {/* Internal operations data: what happened to past disputes (lib/staff/learning.ts). Never client-facing. */}
      <OutcomesLearning clients={clients} now={now} />

      <section className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2" aria-label="Por mes">
        <Bars title="Rondas enviadas por mes" points={series} value={(p) => p.roundsMailed} format={(n) => String(n)} definition={`${METRIC_INFO.roundsMailed.definition} El mes actual va hasta hoy.`} />
        <Bars title="Neto cobrado por mes" points={series} value={(p) => p.netCents} format={(n) => formatCents(n)} definition={`${METRIC_INFO.net.definition} El mes actual va hasta hoy.`} />
      </section>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section aria-labelledby="equipo-num">
          <SectionTitle>
            <span id="equipo-num">Equipo · {PERIOD_LABEL[period].toLowerCase()}</span>
          </SectionTitle>
          <PhoneRows
            rows={m.team.map((row) => ({
              key: row.handle,
              name: row.name,
              sub: `${ROLE_LABEL[row.role]}${row.active ? "" : " · desactivada"}`,
              values: [row.role === "sales" ? "—" : String(row.assigned), String(row.roundsSent), String(row.replies), row.role === "sales" ? "—" : String(row.openExceptions)],
            }))}
            columns={TEAM_COLUMNS.map(([, short]) => short)}
          />
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[27rem] text-[14px] tabular-nums">
              <thead>
                <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">Persona</th>
                  {TEAM_COLUMNS.map(([k, short]) => (
                    <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold last:pr-5" title={METRIC_INFO[k].definition}>
                      {short}
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
                        {row.active ? "" : " · desactivada"}
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
            <span id="ventas-num">Ventas · {PERIOD_LABEL[period].toLowerCase()}</span>
          </SectionTitle>
          <PhoneRows
            rows={m.sales.map((row) => ({ key: row.handle, name: row.name, values: [String(row.invites), String(row.signed), String(row.cancelled)] }))}
            columns={SALES_COLUMNS.map(([, short]) => short)}
          />
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[20rem] text-[14px] tabular-nums">
              <thead>
                <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">Quién trajo</th>
                  {SALES_COLUMNS.map(([k, short]) => (
                    <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold last:pr-5" title={METRIC_INFO[k].definition}>
                      {short}
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
