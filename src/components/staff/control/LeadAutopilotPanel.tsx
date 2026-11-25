"use client";

import { useEffect, useState } from "react";
import { autopilotSamples } from "@/lib/leads/autopilot";
import type { AutopilotView, LeadData } from "@/lib/leads/data";
import { HANDOFF_LABELS } from "@/lib/leads/inbox";
import { AUTOPILOT_LIMITS, type HandoffReason, type LeadAutopilotSettings } from "@/lib/leads/types";
import { shortDateTime } from "@/lib/staff/format";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { DeniedNote, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";

// The lead autopilot's switch (docs/CONTROL.md). OFF by default; only an
// administrator turns it on. Shows the exact words it may send, what it never
// does, when it hands a chat to a person, and the record of every automatic
// message.

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DELAYS = [30, 60, 120, 300, 600, 900];
const HANDOFFS: HandoffReason[] = ["complaint", "billing", "legal", "results", "wants_person", "personal_data", "no_fact", "guardrails"];

function hourLabel(h: number, locale: "en" | "es"): string {
  const date = new Date(Date.UTC(2026, 0, 1, h));
  return date.toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", { hour: "numeric", timeZone: "UTC" });
}

export default function LeadAutopilotPanel({ data, canManage, appUrl }: { data: LeadData; canManage: boolean; appUrl: string }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [view, setView] = useState<AutopilotView | null>(null);
  const [draft, setDraft] = useState<LeadAutopilotSettings | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    try {
      const next = await data.autopilot();
      setView(next);
      setDraft(next.settings);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => {
    void load();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- loaded once per data source

  if (failed) return <div className="card px-5 py-5 text-[14px] text-slate-600">{t("No se pudo leer la configuración ahora.", "The settings couldn't be read right now.")}</div>;
  if (!view || !draft) return null;
  const s = view.settings;
  const samples = autopilotSamples(appUrl);
  const save = async (patch: Partial<LeadAutopilotSettings>) => {
    const result = await data.saveAutopilot(patch);
    setMessage(result.ok ? t("Guardado. Queda en el registro con tu nombre.", "Saved. It goes on the record with your name.") : result.message);
    await load();
  };
  const changed = (["replyDelaySeconds", "perLeadDailyCap", "dailyCap", "quietStartHour", "quietEndHour", "sendSignupLink"] as const).some((k) => draft[k] !== s[k]);
  const field = "mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[15px] disabled:bg-slate-50";

  return (
    <div className="space-y-4" data-testid="lead-autopilot">
      <section className={`card px-5 py-5 ${s.enabled ? "ring-2 ring-green-500/40" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-[20px] font-semibold text-slate-900">{t("Piloto automático para prospectos", "Autopilot for leads")}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-slate-600">
              {t(
                "Cuando nadie del equipo puede, Alti (IA, y lo dice en cada mensaje) responde a prospectos por WhatsApp con un saludo, una respuesta de las preguntas frecuentes o el enlace para registrarse. Nada más.",
                "When nobody on the team can, Alti (AI, and every message says so) answers leads on WhatsApp with a greeting, an answer from the FAQ or the signup link. Nothing else.",
              )}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${s.enabled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-700"}`} data-testid="autopilot-state">
            {s.enabled ? t("Encendido", "On") : t("Apagado", "Off")}
          </span>
        </div>
        {s.enabled && s.enabledAt && (
          <p className="mt-2 text-[13px] text-slate-600">
            {t(`Encendido desde ${shortDateTime(s.enabledAt, "es")}${s.updatedBy ? ` por ${s.updatedBy}` : ""}. Nunca responde mensajes de antes.`, `On since ${shortDateTime(s.enabledAt, "en")}${s.updatedBy ? ` by ${s.updatedBy}` : ""}. It never answers older messages.`)}
          </p>
        )}
        {!view.whatsapp && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900">
            {t("WhatsApp no está conectado en el servidor: aunque esté encendido, no se envía nada (queda «no se pudo enviar» en el registro).", "WhatsApp isn't connected on the server: even when on, nothing is sent (the record says it couldn't be sent).")}
          </p>
        )}
        <div className="mt-4">
          {!canManage ? (
            <DeniedNote>{deniedReason("autopilot.manage", locale)}</DeniedNote>
          ) : s.enabled ? (
            <button type="button" className={SECONDARY_BUTTON_COMPACT} onClick={() => void save({ enabled: false })} data-testid="autopilot-off">
              {t("Apagarlo", "Turn it off")}
            </button>
          ) : confirming ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[14px] leading-snug text-slate-800">
                {t(
                  `Desde ahora, a un mensaje nuevo de un prospecto que nadie respondió en ${draft.replyDelaySeconds} segundos, Alti le contesta con uno de los tres textos de abajo, fuera de las horas de silencio y hasta los límites. Las quejas, el dinero, lo legal y lo que no sabe pasan a una persona.`,
                  `From now on, when a lead's new message has no answer after ${draft.replyDelaySeconds} seconds, Alti replies with one of the three texts below, outside quiet hours and up to the limits. Complaints, money, legal questions and anything it doesn't know go to a person.`,
                )}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className={PRIMARY_BUTTON_COMPACT} onClick={() => void save({ enabled: true }).then(() => setConfirming(false))} data-testid="autopilot-confirm">
                  {t("Encenderlo", "Turn it on")}
                </button>
                <button type="button" className={QUIET_BUTTON} onClick={() => setConfirming(false)}>
                  {t("Cancelar", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={PRIMARY_BUTTON_COMPACT} onClick={() => setConfirming(true)} data-testid="autopilot-on">
              {t("Encenderlo…", "Turn it on…")}
            </button>
          )}
          {message && <p className="mt-2 text-[13px] text-slate-600" role="status">{message}</p>}
        </div>
      </section>

      <section className="card px-5 py-5" aria-labelledby="ap-numbers">
        <h3 id="ap-numbers" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {t("Los números", "The numbers")}
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-[13.5px] font-medium text-slate-700">
            {t("Espera antes de responder", "Wait before replying")}
            <select disabled={!canManage} className={field} value={draft.replyDelaySeconds} onChange={(e) => setDraft({ ...draft, replyDelaySeconds: Number(e.target.value) })}>
              {DELAYS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} s` : `${d / 60} min`}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] font-normal text-slate-500">{t("Para que una persona pueda contestar primero.", "So a person can answer first.")}</span>
          </label>
          <label className="block text-[13.5px] font-medium text-slate-700">
            {t("Máximo por prospecto al día", "Most per lead per day")}
            <input type="number" min={AUTOPILOT_LIMITS.perLeadDailyCap[0]} max={AUTOPILOT_LIMITS.perLeadDailyCap[1]} disabled={!canManage} className={field} value={draft.perLeadDailyCap} onChange={(e) => setDraft({ ...draft, perLeadDailyCap: Number(e.target.value) })} />
          </label>
          <label className="block text-[13.5px] font-medium text-slate-700">
            {t("Máximo para todos al día", "Most for everyone per day")}
            <input type="number" min={AUTOPILOT_LIMITS.dailyCap[0]} max={AUTOPILOT_LIMITS.dailyCap[1]} disabled={!canManage} className={field} value={draft.dailyCap} onChange={(e) => setDraft({ ...draft, dailyCap: Number(e.target.value) })} />
          </label>
          <label className="block text-[13.5px] font-medium text-slate-700">
            {t("Silencio desde", "Quiet from")}
            <select disabled={!canManage} className={field} value={draft.quietStartHour} onChange={(e) => setDraft({ ...draft, quietStartHour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[13.5px] font-medium text-slate-700">
            {t("Silencio hasta", "Quiet until")}
            <select disabled={!canManage} className={field} value={draft.quietEndHour} onChange={(e) => setDraft({ ...draft, quietEndHour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h, locale)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] font-normal text-slate-500">{t("En la hora del prospecto (Texas si no se sabe).", "On the lead's clock (Texas when unknown).")}</span>
          </label>
          <label className="flex items-start gap-3 text-[13.5px] font-medium text-slate-700">
            <input type="checkbox" disabled={!canManage} className="mt-1 h-5 w-5 accent-blue-700" checked={draft.sendSignupLink} onChange={(e) => setDraft({ ...draft, sendSignupLink: e.target.checked })} />
            <span>
              {t("Puede mandar el enlace para registrarse", "May send the signup link")}
              <span className="mt-0.5 block text-[12px] font-normal text-slate-500">{t("Solo cuando el prospecto pregunta cómo empezar.", "Only when the lead asks how to start.")}</span>
            </span>
          </label>
        </div>
        {canManage && changed && (
          <button type="button" className={`${SECONDARY_BUTTON_COMPACT} mt-4`} onClick={() => void save({ replyDelaySeconds: draft.replyDelaySeconds, perLeadDailyCap: draft.perLeadDailyCap, dailyCap: draft.dailyCap, quietStartHour: draft.quietStartHour, quietEndHour: draft.quietEndHour, sendSignupLink: draft.sendSignupLink })}>
            {t("Guardar los números", "Save the numbers")}
          </button>
        )}
      </section>

      <section className="card px-5 py-5" aria-labelledby="ap-words">
        <h3 id="ap-words" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {t("Lo único que puede decir", "The only things it can say")}
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(["en", "es"] as const).map((lang) => (
            <div key={lang} className="space-y-2">
              <p className="text-[12.5px] font-semibold text-slate-500">{lang === "en" ? t("A quien escribe en inglés", "To someone writing in English") : t("A quien escribe en español", "To someone writing in Spanish")}</p>
              <p className="whitespace-pre-wrap rounded-2xl bg-amber-50 px-3 py-2.5 text-[13.5px] leading-snug text-slate-800 shadow-[0_0_0_1px_rgba(239,181,55,0.45)]">{samples[lang].greeting}</p>
              <p className="whitespace-pre-wrap rounded-2xl bg-amber-50 px-3 py-2.5 text-[13.5px] leading-snug text-slate-800 shadow-[0_0_0_1px_rgba(239,181,55,0.45)]">{samples[lang].signup}</p>
              <p className="rounded-2xl bg-amber-50 px-3 py-2.5 text-[13.5px] leading-snug text-slate-800 shadow-[0_0_0_1px_rgba(239,181,55,0.45)]">
                {samples[lang].faqIntro} {t("…la respuesta aprobada de las preguntas frecuentes del sitio, tal cual.", "…the website FAQ's approved answer, word for word.")}
              </p>
            </div>
          ))}
        </div>
        <ul className="mt-4 grid gap-1.5 text-[13.5px] leading-snug text-slate-700 md:grid-cols-2">
          {[
            t("Nunca precios, descuentos ni promesas de resultados.", "Never prices, discounts or promises of results."),
            t("Nunca por mensaje de texto (SMS): solo WhatsApp.", "Never by text message (SMS): WhatsApp only."),
            t("Nunca fuera de la ventana de 24 horas de WhatsApp.", "Never outside WhatsApp's 24-hour window."),
            t("Nunca a quien pidió BAJA, ni a un chat donde una persona escribió en las últimas 6 horas.", "Never to someone who said STOP, or a chat a person wrote in during the last 6 hours."),
            t("Nunca mueve un prospecto de etapa: eso es de las personas.", "Never moves a lead's stage: that's for people."),
            t("Cada mensaje dice «Alti · Asistente con IA» y queda en el registro.", "Every message says “Alti · AI assistant” and goes on the record."),
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] font-semibold text-slate-700">{t("Se lo pasa a una persona, sin responder, cuando:", "It hands the chat to a person, without answering, when:")}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{HANDOFFS.map((h, i) => (i === 0 ? HANDOFF_LABELS[locale][h] : HANDOFF_LABELS[locale][h].replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase()))).join(" · ")}.</p>
      </section>

      <section className="card px-5 py-5" aria-labelledby="ap-record">
        <h3 id="ap-record" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {t("Registro de mensajes automáticos", "Record of automatic messages")}
        </h3>
        {view.recent.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-500">{t("Todavía no hay ninguno.", "None yet.")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {view.recent.slice(0, 15).map((m) => (
              <li key={m.id} className="py-2 text-[13.5px] leading-snug" data-testid="auto-record">
                <span className="font-semibold text-slate-900">
                  {m.kind === "handoff"
                    ? t("Pasó a una persona", "Handed to a person")
                    : m.status === "sent"
                      ? t("Enviado", "Sent")
                      : m.status === "failed"
                        ? t("No se pudo enviar", "Couldn't be sent")
                        : t("Reservado", "Claimed")}
                </span>
                <span className="text-slate-500 tabular-nums"> · {shortDateTime(m.at, locale)}</span>
                {m.kind === "handoff" && m.reason && <span className="block text-slate-600">{HANDOFF_LABELS[locale][m.reason as HandoffReason] ?? m.reason}</span>}
                {m.body && <span className="mt-0.5 line-clamp-2 block text-slate-600">{m.body.replace(/^🤖[^\n]*\n/, "")}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
