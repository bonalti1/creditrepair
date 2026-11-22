"use client";

import Link from "next/link";
import { PULSE_COPY, PULSE_MOMENTS, PULSE_RATINGS, type PulseMoment, type PulseRating, type PulseSummary } from "@/lib/pulse/pulse";
import { shortDay } from "@/lib/staff/format";
import { METRIC_INFOS } from "@/lib/staff/metrics";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { fullName, type StaffClient } from "@/lib/staff/types";
import { Face } from "@/components/Pulse";
import Definition from "@/components/staff/Definition";
import { SectionTitle } from "@/components/staff/ui";

// "¿Cómo vamos?" for the team: the client's own answers on their page, and
// the summary with the recent comments on the business dashboard. Staff read
// them by the 0018 policies: an administrator, everyone's; a specialist, the
// clients assigned to them; sales, none. Nobody on the team can change them.

export const MOMENT_LABEL: Record<PulseMoment, string> = {
  agreement_signed: "Al firmar",
  first_round_mailed: "Primeras cartas",
  first_answer: "Primera respuesta",
};

export const MOMENT_LABEL_EN: Record<PulseMoment, string> = {
  agreement_signed: "At signing",
  first_round_mailed: "First letters",
  first_answer: "First answer",
};

const RATING_TONE: Record<PulseRating, string> = {
  1: "bg-red-50 text-red-700",
  2: "bg-amber-50 text-amber-700",
  3: "bg-green-50 text-green-700",
};

function RatingChip({ rating }: { rating: PulseRating }) {
  const { locale } = useStaffLocale();
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-semibold ${RATING_TONE[rating]}`}>
      <Face rating={rating} size={18} />
      {PULSE_COPY[locale].ratings[rating]}
    </span>
  );
}

/** On the client page: what this client answered. */
export function ClientPulse({ client }: { client: StaffClient }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const pulses = client.pulses ?? [];
  return (
    <section aria-labelledby="pulso">
      <SectionTitle>
        <span id="pulso">{t("¿Cómo vamos?", "How are we doing?")}</span>
      </SectionTitle>
      <ul className="card overflow-hidden" data-testid="client-pulse">
        {pulses.map((p, i) => (
          <li key={`${p.moment}`} className={`px-5 py-3 ${i > 0 ? "border-t hairline" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <RatingChip rating={p.rating} />
              <span className="text-[13px] text-slate-500">
                {t(MOMENT_LABEL[p.moment], MOMENT_LABEL_EN[p.moment])} · {shortDay(p.createdAt, locale)}
              </span>
            </div>
            {p.comment && <p className="mt-1.5 text-[14.5px] leading-snug text-slate-800">«{p.comment}»</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On the business dashboard: the average, the faces, by moment, and the recent comments with whose they are. */
export function DashboardPulse({ pulse, clients }: { pulse: PulseSummary; clients: StaffClient[] }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const byId = new Map(clients.map((c) => [c.id, c]));
  const info = METRIC_INFOS[locale].pulse;
  const answers = METRIC_INFOS[locale].pulseAnswers;
  return (
    <section className="mt-8" aria-labelledby="pulso-negocio" data-testid="dashboard-pulse">
      <SectionTitle>
        <span id="pulso-negocio">{t("Cómo se sienten los clientes", "How clients feel")}</span>
      </SectionTitle>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="card px-5 py-4">
          <div className="flex items-start gap-1.5">
            <p className="min-w-0 text-[13px] leading-snug text-slate-500">{info.label}</p>
            <Definition label={info.label} text={info.definition} />
          </div>
          <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums" data-testid="metric-pulse">
            {pulse.average === null ? "—" : t(`${pulse.average.toFixed(1)} de 3`, `${pulse.average.toFixed(1)} of 3`)}
          </p>
          <div className="mt-3 flex items-start gap-1.5">
            <p className="min-w-0 text-[13px] leading-snug text-slate-500">
              {answers.label}: <span className="font-semibold text-slate-900 tabular-nums">{pulse.count}</span>
            </p>
            <Definition label={answers.label} text={answers.definition} />
          </div>
          <ul className="mt-2 space-y-1.5">
            {[...PULSE_RATINGS].reverse().map((r) => {
              const n = pulse.distribution[r];
              const share = pulse.count === 0 ? 0 : n / pulse.count;
              return (
                <li key={r} className="flex items-center gap-2 text-[13px] tabular-nums">
                  <span className="w-32 shrink-0">
                    <RatingChip rating={r} />
                  </span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-blue-700/70" style={{ width: `${share * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-slate-700">{n}</span>
                </li>
              );
            })}
          </ul>
          <table className="mt-3 w-full text-[13px] tabular-nums">
            <tbody>
              {PULSE_MOMENTS.map((m) => (
                <tr key={m} className="border-t hairline">
                  <td className="py-1.5 text-slate-600">{t(MOMENT_LABEL[m], MOMENT_LABEL_EN[m])}</td>
                  <td className="py-1.5 text-right text-slate-900">
                    {pulse.byMoment[m].average === null ? "—" : pulse.byMoment[m].average!.toFixed(1)}
                    <span className="text-slate-500"> · {pulse.byMoment[m].count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card overflow-hidden">
          <p className="border-b hairline px-5 py-2.5 text-[13px] leading-snug text-slate-600">
            {t(
              "Comentarios recientes. Solo los ven un administrador y el especialista que trabaja cada caso; nadie del equipo puede cambiarlos.",
              "Recent comments. Only an administrator and the specialist working each case see them; nobody on the team can change them.",
            )}
          </p>
          {pulse.comments.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-slate-500">{t("Nadie dejó un comentario en este periodo.", "Nobody left a comment in this period.")}</p>
          ) : (
            <ul data-testid="pulse-comments">
              {pulse.comments.slice(0, 8).map((c, i) => {
                const client = byId.get(c.userId);
                return (
                  <li key={`${c.userId}:${c.moment}`} className={`px-5 py-3 ${i > 0 ? "border-t hairline" : ""}`}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <RatingChip rating={c.rating} />
                      {client ? (
                        <Link href={`/equipo/clientes/${client.id}`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-slate-900 underline-offset-2 hover:underline">
                          {fullName(client)}
                        </Link>
                      ) : (
                        <span className="text-[14px] text-slate-500">{t("Cliente", "Client")}</span>
                      )}
                      <span className="text-[13px] text-slate-500">
                        {t(MOMENT_LABEL[c.moment], MOMENT_LABEL_EN[c.moment])} · {shortDay(c.createdAt, locale)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[14.5px] leading-snug text-slate-800">«{c.comment}»</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
