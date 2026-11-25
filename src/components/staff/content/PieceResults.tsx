"use client";

import { useState } from "react";
import { CHANNEL_LABEL, METRIC_LABEL, NO_DATA, STATUS_LABEL } from "@/lib/content/labels";
import { formatCount, pieceResults, type Attribution } from "@/lib/content/results";
import type { ActResult } from "@/lib/content/store";
import { RESULT_METRICS, type Channel, type ContentEvent, type ContentPiece, type ContentResult, type ResultMetric } from "@/lib/content/types";
import { shortDateTime } from "@/lib/staff/format";
import { can } from "@/lib/staff/permissions";
import type { StaffRole } from "@/lib/staff/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, Notice } from "./ui";

// A piece's results: the newest numbers per channel (typed in, or read from
// the network once connected), and the leads that arrived through its tracked
// links. Real numbers only: what nobody measured reads "No data yet".

export function MetricGrid({ values, attribution }: { values: Record<ResultMetric, number | null>; attribution?: Attribution | null }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {RESULT_METRICS.map((m) => (
        <div key={m} className="rounded-xl bg-slate-50 px-3 py-2">
          <dt className="text-[12px] text-slate-500">{METRIC_LABEL[locale][m]}</dt>
          <dd className={`tabular-nums ${values[m] === null ? "text-[13px] text-slate-400" : "text-[17px] font-semibold text-slate-900"}`}>{values[m] === null ? NO_DATA[locale] : formatCount(values[m]!, locale)}</dd>
        </div>
      ))}
      {attribution ? (
        <div className="col-span-2 rounded-xl bg-blue-50 px-3 py-2 sm:col-span-4">
          <dt className="text-[12px] text-blue-700">{t("Por sus enlaces (código de campaña)", "Through its links (campaign code)")}</dt>
          <dd className="text-[14px] font-semibold text-blue-900 tabular-nums">
            {t(`${attribution.leads} prospectos · ${attribution.clients} se hicieron clientes`, `${attribution.leads} leads · ${attribution.clients} became clients`)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function PieceResults({ piece, results, attribution, role, addResult }: { piece: ContentPiece; results: ContentResult[]; attribution: Attribution | null; role: StaffRole | null; addResult: (input: { id: string; channel: Channel; values: Partial<Record<ResultMetric, number | null>> }) => Promise<ActResult> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const row = pieceResults(piece, results, attribution ? new Map([[piece.campaignCode.toLowerCase(), attribution]]) : new Map());
  const [channel, setChannel] = useState<Channel>(piece.posts[0]?.channel ?? piece.channels[0] ?? "instagram");
  const [values, setValues] = useState<Partial<Record<ResultMetric, string>>>({});
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const posted = piece.posts.length > 0 || ["posted", "measured"].includes(piece.status);
  const editable = can(role, "content.edit") && posted;

  return (
    <section aria-labelledby="results-title" data-testid="piece-results">
      <SectionTitle>
        <span id="results-title">{t("Resultados", "Results")}</span>
      </SectionTitle>
      <div className="card space-y-3 px-4 py-4">
        {!row.hasData ? <p className="text-[14px] text-slate-500">{posted ? t("Sin datos todavía. Agrega los números cuando los tengas.", "No data yet. Add the numbers when you have them.") : t(`Sin datos: la pieza está en «${STATUS_LABEL.es[piece.status]}».`, `No data: the piece is ${STATUS_LABEL.en[piece.status].toLowerCase()}.`)}</p> : <MetricGrid values={row.totals} attribution={row.attribution} />}
        {row.byChannel.size > 1 ? (
          <ul className="space-y-1 text-[13px] text-slate-600">
            {[...row.byChannel.entries()].map(([c, v]) => (
              <li key={c}>
                <span className="font-medium">{CHANNEL_LABEL[locale][c]}:</span>{" "}
                {RESULT_METRICS.filter((m) => v[m] !== null)
                  .map((m) => `${METRIC_LABEL[locale][m]} ${formatCount(v[m]!, locale)}`)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        ) : null}
        {editable ? (
          <form
            className="space-y-2 border-t hairline pt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const parsed: Partial<Record<ResultMetric, number | null>> = {};
              for (const m of RESULT_METRICS) {
                const raw = values[m]?.trim();
                if (raw) parsed[m] = Number(raw.replace(/[,.\s](?=\d{3}\b)/g, ""));
              }
              const r = await addResult({ id: piece.id, channel, values: parsed });
              setMessage(r.ok ? { text: t("Números guardados.", "Numbers saved."), tone: "info" } : { text: r.message[locale], tone: "error" });
              if (r.ok) setValues({});
            }}
          >
            <h3 className="text-[14px] font-semibold text-slate-900">{t("Agregar números", "Add numbers")}</h3>
            <p className="text-[12.5px] text-slate-500">{t("Solo lo que mediste. Deja vacío lo que no sabes: no es cero.", "Only what you measured. Leave blank what you don't know: blank is not zero.")}</p>
            <label className="block max-w-xs">
              <span className="sr-only">{t("Canal", "Channel")}</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={`${FIELD} h-11`}>
                {piece.channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[locale][c]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RESULT_METRICS.map((m) => (
                <label key={m} className="block text-[12.5px] font-medium text-slate-600">
                  {METRIC_LABEL[locale][m]}
                  <input value={values[m] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [m]: e.target.value }))} inputMode="numeric" pattern="[0-9.,\s]*" className={`${FIELD} mt-1 h-11 tabular-nums`} />
                </label>
              ))}
            </div>
            <button type="submit" className={SECONDARY_BUTTON_COMPACT}>
              {t("Guardar números", "Save numbers")}
            </button>
          </form>
        ) : null}
        {message ? <Notice message={message.text} tone={message.tone} /> : null}
      </div>
    </section>
  );
}

const EVENT_TEXT: Record<ContentEvent["kind"], [string, string]> = {
  created: ["la creó", "created it"],
  edited: ["la editó", "edited it"],
  moved: ["la movió", "moved it"],
  submitted: ["la mandó a revisión", "sent it for review"],
  checked: ["corrió la revisión", "ran the check"],
  approved: ["la aprobó", "approved it"],
  approval_reset: ["cambió algo aprobado: volvió a revisión", "changed approved content: back to review"],
  changes_requested: ["pidió cambios", "asked for changes"],
  posted: ["registró la publicación", "recorded the post"],
  scheduled: ["la programó", "scheduled it"],
  schedule_cancelled: ["canceló una programación", "cancelled a schedule"],
  result_added: ["agregó resultados", "added results"],
  asset_added: ["agregó un archivo", "added a file"],
  asset_removed: ["quitó un archivo", "removed a file"],
  archived: ["la archivó", "archived it"],
  restored: ["la restauró", "restored it"],
  failed: ["no pudo publicarla", "could not post it"],
};

export function PieceHistory({ events }: { events: ContentEvent[] }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="history-title" data-testid="history">
      <SectionTitle>
        <span id="history-title">{t("Historial", "History")}</span>
      </SectionTitle>
      <ol className="card divide-y divide-slate-100 px-4 py-1">
        {[...events]
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, 30)
          .map((e) => (
            <li key={e.id} className="py-2 text-[13.5px] text-slate-700">
              <span className="font-medium text-slate-900">{e.by === "system" ? t("El sistema", "The system") : e.by}</span> {t(...EVENT_TEXT[e.kind])}
              {e.to && e.kind === "moved" ? ` → ${STATUS_LABEL[locale][e.to]}` : ""}
              {e.note && ["changes_requested", "failed"].includes(e.kind) ? <span className="block text-slate-500">“{e.note}”</span> : null}
              <span className="block text-[12px] text-slate-500 tabular-nums">{shortDateTime(e.at, locale)}</span>
            </li>
          ))}
      </ol>
    </section>
  );
}
