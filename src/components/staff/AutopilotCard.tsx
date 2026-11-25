"use client";

import { useState } from "react";
import { followupStates, followupText, openHold } from "@/lib/autopilot/followups";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
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
  const { locale } = useStaffLocale();
  const t = useTx();
  const day = (iso: string) => formatDay(new Date(iso), locale);
  const [holding, setHolding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hold = openHold(client);
  const states = followupStates(client, now, env).filter((s) => !s.exhausted);
  const messages = [...(client.outbound ?? [])].sort((a, b) => (b.sentAt ?? b.queuedAt).localeCompare(a.sentAt ?? a.queuedAt));

  const act = async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    const result = await fn();
    if (!result.ok) {
      setError(staffMessage(result.message, locale));
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
        <span id="piloto">{t("Piloto automático", "Autopilot")}</span>
      </SectionTitle>
      <div className="card divide-y divide-slate-900/[0.06]" data-testid="autopilot-card">
        <div className="px-5 py-4">
          {hold ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] leading-snug text-slate-700">
                <span className="font-semibold text-amber-700">{t("Detenido", "On hold")}</span>{" "}
                {t(`por ${hold.by} el ${day(hold.at)}`, `by ${hold.by} on ${day(hold.at)}`)}: «{hold.reason}».{" "}
                {t(
                  "El sistema no envía rondas ni recordatorios por su cuenta; los avisos de estado sí llegan.",
                  "The system doesn't send rounds or reminders on its own; status notices still go out.",
                )}
              </p>
              {canHold && (
                <button type="button" onClick={() => act(() => autopilot.release(client.id, by))} className={SECONDARY_BUTTON_COMPACT}>
                  {t("Soltar", "Release")}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] leading-snug text-slate-600">
                {env.settings.roundsEnabled || env.settings.followupsEnabled
                  ? t("El sistema trabaja este caso por su cuenta.", "The system works this case on its own.")
                  : t("El piloto automático está apagado para todo el equipo.", "The autopilot is off for the whole team.")}
              </p>
              {canHold ? (
                <button type="button" onClick={() => setHolding(!holding)} className={QUIET_BUTTON} data-testid="client-hold">
                  {t("Detener para este cliente", "Hold for this client")}
                </button>
              ) : (
                <DeniedNote>{holdDenied}</DeniedNote>
              )}
            </div>
          )}
          {holding && (
            <div className="mt-3">
              <label htmlFor="hold-reason" className="block text-[13px] font-medium text-slate-700">
                {t("¿Por qué se detiene? Queda en el registro.", "Why is it on hold? This goes on the record.")}
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
                  {t("Detener", "Hold")}
                </button>
                <button type="button" onClick={() => setHolding(false)} className={QUIET_BUTTON}>
                  {t("Cancelar", "Cancel")}
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
                <span className="font-semibold text-slate-800">{t("No recibe mensajes automáticos.", "Doesn't get automatic messages.")}</span>{" "}
                {t(
                  `Lo pidió (${client.optOut.keyword}) el ${day(client.optOut.at)}. Sus avisos llegan a una persona.`,
                  `They asked (${client.optOut.keyword}) on ${day(client.optOut.at)}. Their notices go to a person.`,
                )}
              </>
            ) : (
              t("Recibe mensajes automáticos. Si te dice que no los quiere, anótalo aquí.", "Gets automatic messages. If they tell you they don't want them, note it here.")
            )}
          </p>
          {canOptOut && (
            <button
              type="button"
              onClick={() => act(() => autopilot.setOptOut(client.id, !client.optOut, by))}
              className={QUIET_BUTTON}
            >
              {client.optOut ? t("Pidió volver a recibirlos", "Wants them again") : t("No quiere mensajes", "Doesn't want messages")}
            </button>
          )}
        </div>

        {states.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[13px] font-semibold text-slate-700">{t("Recordatorios en curso", "Reminders in progress")}</p>
            <ul className="mt-1.5 space-y-1 text-[14px] leading-snug text-slate-600">
              {states.map((s) => (
                <li key={s.situation.key}>
                  {followupText(s.situation.kind, locale).label}: {t(`${s.sent.length} de 3 enviados`, `${s.sent.length} of 3 sent`)}
                  {s.block
                    ? ` · ${blockLine(s.block, locale)}`
                    : s.next
                      ? t(` · el siguiente, el ${day(s.next.dueAt)}`, ` · the next one on ${day(s.next.dueAt)}`)
                      : t(" · esperando al cliente", " · waiting on the client")}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-5 py-4">
          <p className="text-[13px] font-semibold text-slate-700">{t("Mensajes automáticos", "Automatic messages")}</p>
          {messages.length === 0 ? (
            <p className="mt-1 text-[14px] text-slate-500">{t("Todavía ninguno.", "None yet.")}</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5" data-testid="outbound-log">
              {messages.slice(0, 12).map((m) => (
                <li key={m.id} className="text-[13px] leading-snug">
                  <details>
                    <summary className="cursor-pointer py-3 text-slate-700 md:py-0">
                      <span className="tabular-nums text-slate-500">{shortDateTime(m.sentAt ?? m.queuedAt, locale)}</span> · {outboundLine(m, locale)}
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

function blockLine(block: string, locale: StaffLocale): string {
  const es = locale === "es";
  switch (block) {
    case "disabled":
      return es ? "apagados" : "turned off";
    case "opted_out":
      return es ? "no quiere mensajes" : "doesn't want messages";
    case "held":
      return es ? "detenido" : "on hold";
    case "template_not_approved":
      return es ? "falta aprobar la plantilla" : "template not approved yet";
    default:
      return es ? "sin canal para escribirle" : "no channel to reach them";
  }
}
