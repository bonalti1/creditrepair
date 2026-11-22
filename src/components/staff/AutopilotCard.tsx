"use client";

import { useState } from "react";
import { FOLLOWUP_SCHEDULES, followupStates, openHold } from "@/lib/autopilot/followups";
import { outboundLine } from "@/lib/autopilot/queue";
import type { AutopilotData } from "@/lib/autopilot/data";
import type { AutopilotEnv } from "@/lib/autopilot/types";
import { formatDay } from "@/lib/staff/stage";
import { shortDateTime } from "@/lib/staff/format";
import type { StaffClient } from "@/lib/staff/types";
import { DeniedNote, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";

// One client and the autopilot: a hold, an opt-out, the reminders in
// progress, and every automatic message the client was sent, with its words.

export default function AutopilotCard({
  client,
  now,
  env,
  autopilot,
  by,
  canHold,
  canOptOut,
  holdDenied,
  onChanged,
}: {
  client: StaffClient;
  now: Date;
  env: AutopilotEnv;
  autopilot: AutopilotData;
  by: string;
  canHold: boolean;
  canOptOut: boolean;
  holdDenied: string;
  onChanged: () => void | Promise<void>;
}) {
  const [holding, setHolding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hold = openHold(client);
  const states = followupStates(client, now, env).filter((s) => !s.exhausted);
  const messages = [...(client.outbound ?? [])].sort((a, b) => (b.sentAt ?? b.queuedAt).localeCompare(a.sentAt ?? a.queuedAt));

  const act = async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    const result = await fn();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setHolding(false);
    setReason("");
    await onChanged();
  };

  return (
    <section aria-labelledby="piloto">
      <SectionTitle>
        <span id="piloto">Piloto automático</span>
      </SectionTitle>
      <div className="card divide-y divide-slate-900/[0.06]" data-testid="autopilot-card">
        <div className="px-5 py-4">
          {hold ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] leading-snug text-slate-700">
                <span className="font-semibold text-amber-700">Detenido</span> por {hold.by} el {formatDay(new Date(hold.at))}: «{hold.reason}». El
                sistema no envía rondas ni recordatorios por su cuenta; los avisos de estado sí llegan.
              </p>
              {canHold && (
                <button type="button" onClick={() => act(() => autopilot.release(client.id, by))} className={SECONDARY_BUTTON_COMPACT}>
                  Soltar
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] leading-snug text-slate-600">
                {env.settings.roundsEnabled || env.settings.followupsEnabled
                  ? "El sistema trabaja este caso por su cuenta."
                  : "El piloto automático está apagado para todo el equipo."}
              </p>
              {canHold ? (
                <button type="button" onClick={() => setHolding(!holding)} className={QUIET_BUTTON} data-testid="client-hold">
                  Detener para este cliente
                </button>
              ) : (
                <DeniedNote>{holdDenied}</DeniedNote>
              )}
            </div>
          )}
          {holding && (
            <div className="mt-3">
              <label htmlFor="hold-reason" className="block text-[13px] font-medium text-slate-700">
                ¿Por qué se detiene? Queda en el registro.
              </label>
              <textarea
                id="hold-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px]"
              />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => act(() => autopilot.hold(client.id, reason, by))} className={SECONDARY_BUTTON_COMPACT}>
                  Detener
                </button>
                <button type="button" onClick={() => setHolding(false)} className={QUIET_BUTTON}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <p className="min-w-0 text-[14px] leading-snug text-slate-600">
            {client.optOut ? (
              <>
                <span className="font-semibold text-slate-800">No recibe mensajes automáticos.</span> Lo pidió ({client.optOut.keyword}) el{" "}
                {formatDay(new Date(client.optOut.at))}. Sus avisos llegan a una persona.
              </>
            ) : (
              "Recibe mensajes automáticos. Si te dice que no los quiere, anótalo aquí."
            )}
          </p>
          {canOptOut && (
            <button
              type="button"
              onClick={() => act(() => autopilot.setOptOut(client.id, !client.optOut, by))}
              className={QUIET_BUTTON}
            >
              {client.optOut ? "Pidió volver a recibirlos" : "No quiere mensajes"}
            </button>
          )}
        </div>

        {states.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[13px] font-semibold text-slate-700">Recordatorios en curso</p>
            <ul className="mt-1.5 space-y-1 text-[14px] leading-snug text-slate-600">
              {states.map((s) => (
                <li key={s.situation.key}>
                  {FOLLOWUP_SCHEDULES[s.situation.kind].label}: {s.sent.length} de 3 enviados
                  {s.block ? ` · ${blockLine(s.block)}` : s.next ? ` · el siguiente, el ${formatDay(new Date(s.next.dueAt))}` : " · esperando al cliente"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-5 py-4">
          <p className="text-[13px] font-semibold text-slate-700">Mensajes automáticos</p>
          {messages.length === 0 ? (
            <p className="mt-1 text-[14px] text-slate-500">Todavía ninguno.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5" data-testid="outbound-log">
              {messages.slice(0, 12).map((m) => (
                <li key={m.id} className="text-[13px] leading-snug">
                  <details>
                    <summary className="cursor-pointer text-slate-700">
                      <span className="tabular-nums text-slate-500">{shortDateTime(m.sentAt ?? m.queuedAt)}</span> · {outboundLine(m)}
                    </summary>
                    <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-slate-600">{m.body}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function blockLine(block: string): string {
  switch (block) {
    case "disabled":
      return "apagados";
    case "opted_out":
      return "no quiere mensajes";
    case "held":
      return "detenido";
    case "template_not_approved":
      return "falta aprobar la plantilla";
    default:
      return "sin canal para escribirle";
  }
}
