"use client";

import { useMemo, useState } from "react";
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  disputeAttempts,
  MIN_SAMPLE,
  OUTCOME_DEFINITIONS,
  outcomeTable,
  type Dimension,
  type OutcomeRow,
} from "@/lib/staff/learning";
import type { StaffClient } from "@/lib/staff/types";
import { SectionTitle } from "@/components/staff/ui";
import Icon from "@/components/Icon";

// "Qué está funcionando": what happened to past disputes, by bureau, company,
// the client's reason, letter and stage, and what the data showed
// (src/lib/staff/learning.ts). Internal operations data for administrators on
// the business dashboard. Never shown to clients, never in marketing.

const COLUMNS: Array<[keyof OutcomeRow, string]> = [
  ["deleted", "Borradas"],
  ["updated", "Actualizadas"],
  ["verified", "Verificadas"],
  ["otherAnswer", "Otra respuesta"],
  ["noAnswer", "Sin respuesta"],
  ["waiting", "Esperando"],
];

function days(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)} d`;
}

export default function OutcomesLearning({ clients, now }: { clients: readonly StaffClient[]; now: Date }) {
  const [dimension, setDimension] = useState<Dimension>("bureau");
  const attempts = useMemo(() => disputeAttempts(clients, now), [clients, now]);
  const rows = useMemo(() => outcomeTable(attempts, dimension), [attempts, dimension]);
  const shown = rows.filter((r) => r.enough);
  const small = rows.filter((r) => !r.enough);

  return (
    <section className="mt-7" aria-labelledby="funcionando" data-testid="outcomes-learning">
      <SectionTitle>
        <span id="funcionando">Qué está funcionando</span>
      </SectionTitle>
      <p className="mb-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-[13.5px] leading-snug text-amber-900" role="note">
        <Icon name="info" size={18} className="mt-px shrink-0" />
        <span>
          Datos internos de operación, para decidir mejor cómo preparar las disputas. Nunca se muestran a clientes ni se usan en
          publicidad o ventas. Describen lo que pasó con disputas ya enviadas; no predicen nada: cada resultado lo decide el buró.
          Todas las rondas desde el inicio (no cambia con el periodo).
        </span>
      </p>

      <div className="mb-3 flex flex-wrap gap-1 rounded-3xl bg-slate-100 p-1 sm:inline-flex sm:rounded-full" role="group" aria-label="Agrupar por">
        {DIMENSIONS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={dimension === d}
            onClick={() => setDimension(d)}
            className={`pressable h-11 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold sm:h-8 ${dimension === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
          >
            {DIMENSION_LABEL[d]}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-[14px] tabular-nums">
          <thead>
            <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 font-semibold">{DIMENSION_LABEL[dimension]}</th>
              <th className="px-3 py-2.5 text-right font-semibold">Disputas</th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                  {label}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2.5 pr-5 text-right font-semibold">Mediana</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-b hairline last:border-b-0" data-testid="outcome-row">
                <td className="px-5 py-2.5 font-medium text-slate-900">{row.label}</td>
                <td className="px-3 py-2.5 text-right text-slate-900">{row.sent}</td>
                {COLUMNS.map(([key]) => (
                  <td key={key} className="px-3 py-2.5 text-right text-slate-900">
                    {String(row[key])}
                  </td>
                ))}
                <td className="px-3 py-2.5 pr-5 text-right text-slate-900">{days(row.medianDays)}</td>
              </tr>
            ))}
            {small.map((row) => (
              <tr key={row.key} className="border-b hairline last:border-b-0 text-slate-500" data-testid="outcome-row-small">
                <td className="px-5 py-2.5">{row.label}</td>
                <td className="px-3 py-2.5 text-right">{row.sent}</td>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-2.5 pr-5 text-right text-[12.5px]">
                  Menos de {MIN_SAMPLE}: no se muestra
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="px-5 py-4 text-slate-500">
                  Todavía no hay rondas enviadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
        {attempts.length} {attempts.length === 1 ? "disputa" : "disputas"} en total. Las filas con menos de {MIN_SAMPLE} disputas solo muestran cuántas
        son: con tan pocas no se puede sacar ninguna conclusión.
      </p>
      <details className="px-1 pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium text-blue-700 md:min-h-0">Cómo se cuenta</summary>
        <dl className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-slate-600">
          {OUTCOME_DEFINITIONS.map(({ term, definition }) => (
            <div key={term}>
              <dt className="inline font-semibold text-slate-800">{term}: </dt>
              <dd className="inline">{definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
