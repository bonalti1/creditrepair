"use client";

import { useState } from "react";
import Link from "next/link";
import { FOLLOWUP_SCHEDULES, followupText } from "@/lib/autopilot/followups";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import { MINUTES_BY_KIND, SEVERITY_BY_KIND, SLA_HOURS } from "@/lib/autopilot/queue";
import { ALL_TEMPLATES, FOLLOWUP_TEMPLATES, STATUS_TEMPLATES } from "@/lib/autopilot/templates";
import { FOLLOWUP_KINDS, REVIEW_WINDOW_CHOICES, type AutopilotSettings, type FollowupKind } from "@/lib/autopilot/types";
import type { SettingsPatch } from "@/lib/autopilot/store";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { deniedReason } from "@/lib/staff/permissions";
import { EXCEPTION_KINDS, EXCEPTION_LABELS } from "@/lib/staff/stage";
import { shortDateTime } from "@/lib/staff/format";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { Chip, DeniedNote, SectionTitle } from "@/components/staff/ui";

// Piloto automático: what the system does by itself, and the switches for it.
// Plain words in the member's language, one card per thing. An administrator changes them; everyone
// else on the team sees them, read-only. Every change is recorded (on the
// database, in the team's audit).

function Switch({ on, label, disabled, onChange, testId }: { on: boolean; label: string; disabled: boolean; onChange: (next: boolean) => void; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-green-600" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function Row({ title, children, aside }: { title: string; children?: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        {children && <div className="mt-0.5 text-[14px] leading-snug text-slate-600">{children}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{aside}</div>
    </div>
  );
}

const hourLabel = (h: number, locale: StaffLocale) => {
  const suffix = locale === "es" ? (h < 12 ? "a. m." : "p. m.") : h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
};

const dayList = (days: readonly number[], locale: StaffLocale) =>
  days.map((d) => (d === 0 ? (locale === "es" ? "el mismo día" : "same day") : locale === "es" ? `día ${d}` : `day ${d}`)).join(" · ");

export default function PilotoPage() {
  const { ready, can, locale } = useStaff();
  const t = useTx();
  const { autopilot, ready: loaded, settings, channels, gaps, reload } = useAutopilot();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!ready || !loaded) return null;
  const admin = can("autopilot.manage");
  const disabled = !admin || saving;

  const save = async (patch: SettingsPatch) => {
    setSaving(true);
    const result = await autopilot.saveSettings(patch, staffAuthor());
    setSaving(false);
    setMessage(result.ok ? t("Guardado.", "Saved.") : staffMessage(result.message, locale));
    await reload();
  };
  const set = <K extends keyof AutopilotSettings>(key: K) => (value: AutopilotSettings[K]) => void save({ [key]: value } as SettingsPatch);

  const approved = channels.approvedTemplates === "all" ? ALL_TEMPLATES.length : ALL_TEMPLATES.filter((t) => (channels.approvedTemplates as readonly string[]).includes(t.name)).length;

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Piloto automático", "Autopilot")}</h1>
      <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-slate-500">
        {t(
          "Lo que el sistema hace solo, para que el equipo atienda solo lo que necesita una persona. Ninguna regla de envío cambia: el acuerdo, el periodo de cancelación, lo que el cliente confirmó, las direcciones y los cobros se revisan igual antes de cada carta.",
          "What the system does on its own, so the team only handles what needs a person. No sending rule changes: the agreement, the cancellation period, what the client confirmed, the addresses and billing are all checked the same way before every letter.",
        )}
      </p>
      {!admin && (
        <div className="mt-3">
          <DeniedNote>
            {deniedReason("autopilot.manage", locale)} {t("Aquí ves cómo está configurado.", "Here you can see how it's set up.")}
          </DeniedNote>
        </div>
      )}
      {autopilot.demo && (
        <p className="mt-3 max-w-2xl rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {t(
            "En la demo el piloto automático está encendido para mostrar cómo trabaja, y ningún mensaje sale de verdad. Con la base de datos empieza apagado hasta que una persona administradora lo encienda.",
            "In the demo the autopilot is on to show how it works, and no message really goes out. With the database it starts off until an administrator turns it on.",
          )}
        </p>
      )}
      {settings.updatedAt && (
        <p className="mt-2 text-[13px] text-slate-500">
          {t("Último cambio:", "Last change:")} {shortDateTime(settings.updatedAt, locale)}
          {settings.updatedBy ? t(`, por ${settings.updatedBy}`, `, by ${settings.updatedBy}`) : ""}.
        </p>
      )}
      {message && (
        <p className="mt-2 text-[13px] font-medium text-slate-700" role="status">
          {message}
        </p>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="envio">
          <SectionTitle>
            <span id="envio">{t("Envío automático de rondas", "Automatic round sending")}</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <Row
              title={t("Enviar solas las rondas listas", "Send ready rounds on their own")}
              aside={
                <Switch
                  on={settings.roundsEnabled}
                  label={t("Enviar solas las rondas listas", "Send ready rounds on their own")}
                  disabled={disabled}
                  onChange={set("roundsEnabled")}
                  testId="switch-rounds"
                />
              }
            >
              {t(
                "Una ronda que pasa todas las revisiones espera en «Listas para enviar» y, si nadie la detiene, sale sola por correo postal en la siguiente vuelta del sistema (cada hora). El sistema queda registrado como quien la envió.",
                "A round that passes every check waits in “Ready to send” and, unless someone holds it, goes out by mail on its own on the system's next run (every hour). The system is recorded as the sender.",
              )}
            </Row>
            <Row
              title={t("Tiempo de revisión", "Review window")}
              aside={
                <select
                  aria-label={t("Tiempo de revisión", "Review window")}
                  value={settings.reviewWindowHours}
                  disabled={disabled}
                  onChange={(e) => void save({ reviewWindowHours: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[14px] disabled:opacity-60"
                >
                  {[...new Set([...REVIEW_WINDOW_CHOICES, settings.reviewWindowHours])].sort((a, b) => a - b).map((h) => (
                    <option key={h} value={h}>
                      {t(`${h} horas`, `${h} hours`)}
                    </option>
                  ))}
                </select>
              }
            >
              {t(
                "Cuánto tiempo se ve una ronda lista antes de salir sola. Cualquier persona que envía rondas puede detener a un cliente con un motivo.",
                "How long a ready round is shown before it goes out on its own. Anyone who sends rounds can put a client on hold, with a reason.",
              )}
            </Row>
          </div>
        </section>

        <section aria-labelledby="reglas">
          <SectionTitle>
            <span id="reglas">{t("Cuándo y cuánto se escribe", "When and how much we write")}</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <Row
              title={t("Horas de silencio", "Quiet hours")}
              aside={
                <span className="flex items-center gap-1.5 text-[14px] text-slate-600">
                  <select
                    aria-label={t("Desde", "From")}
                    value={settings.quietStartHour}
                    disabled={disabled}
                    onChange={(e) => void save({ quietStartHour: Number(e.target.value) })}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-[14px] disabled:opacity-60"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {hourLabel(h, locale)}
                      </option>
                    ))}
                  </select>
                  {t("a", "to")}
                  <select
                    aria-label={t("Hasta", "Until")}
                    value={settings.quietEndHour}
                    disabled={disabled}
                    onChange={(e) => void save({ quietEndHour: Number(e.target.value) })}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-[14px] disabled:opacity-60"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {hourLabel(h, locale)}
                      </option>
                    ))}
                  </select>
                </span>
              }
            >
              {t(
                "Ningún mensaje automático en ese horario, en la hora del cliente (Texas si no se sabe). Lo que toque se envía al terminar.",
                "No automatic message during those hours, on the client's clock (Texas if unknown). Anything due goes out when they end.",
              )}
            </Row>
            <Row
              title={t("Máximo por cliente al día", "Daily limit per client")}
              aside={
                <select
                  aria-label={t("Máximo por cliente al día", "Daily limit per client")}
                  value={settings.dailyCap}
                  disabled={disabled}
                  onChange={(e) => void save({ dailyCap: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[14px] disabled:opacity-60"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? t("mensaje", "message") : t("mensajes", "messages")}
                    </option>
                  ))}
                </select>
              }
            >
              {t(
                "Primero los avisos de estado, luego los recordatorios. Lo que no cabe sale al día siguiente.",
                "Status notices first, then reminders. Whatever doesn't fit goes out the next day.",
              )}
            </Row>
            <Row title={t("Si el cliente no quiere mensajes", "If the client doesn't want messages")} aside={<Chip tone="bg-green-50 text-green-700">{t("Siempre", "Always")}</Chip>}>
              {t(
                "Si responde BAJA o STOP por WhatsApp, o usa el enlace de baja de un correo, no recibe ningún mensaje automático más. Queda anotado en su caso y sus avisos pasan a una persona. ALTA o START los vuelve a activar.",
                "If they reply STOP or BAJA on WhatsApp, or use an email's unsubscribe link, they get no more automatic messages. It's noted on their case and their notices go to a person. START or ALTA turns them back on.",
              )}
            </Row>
          </div>
        </section>

        <section aria-labelledby="recordatorios" className="lg:col-span-2">
          <SectionTitle
            aside={
              <span className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                {t("Recordatorios automáticos", "Automatic reminders")}
                <Switch
                  on={settings.followupsEnabled}
                  label={t("Recordatorios automáticos", "Automatic reminders")}
                  disabled={disabled}
                  onChange={set("followupsEnabled")}
                  testId="switch-followups"
                />
              </span>
            }
          >
            <span id="recordatorios">{t("Recordatorios al cliente", "Reminders to the client")}</span>
          </SectionTitle>
          <div className="card overflow-hidden">
            <p className="border-b hairline px-5 py-3 text-[14px] leading-snug text-slate-600">
              {t(
                "En lugar de un botón «Recordarle…», el sistema le escribe al cliente tres veces, unos días aparte, con un enlace a la pantalla que lo resuelve. Si nada cambia, pasa a «Necesita una persona» con lo que ya se le envió. Si el cliente avanza, el conteo vuelve a empezar.",
                "Instead of a “Remind them…” button, the system writes to the client three times, a few days apart, with a link to the screen that fixes it. If nothing changes, it moves to “Needs a person” with what was already sent. If the client makes progress, the count starts over.",
              )}
              {!settings.followupsEnabled && t(" Apagados: esos avisos llegan a una persona como antes.", " Off: those notices go to a person as before.")}
            </p>
            <ul className="divide-y divide-slate-900/[0.06]">
              {FOLLOWUP_KINDS.map((kind: FollowupKind) => {
                const s = FOLLOWUP_SCHEDULES[kind];
                const words = followupText(kind, locale);
                return (
                  <li key={kind} className="flex items-start justify-between gap-4 px-5 py-4" data-testid={`followup-${kind}`}>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-slate-900">{words.label}</p>
                      <p className="mt-0.5 text-[14px] leading-snug text-slate-600">{words.description}</p>
                      <p className="mt-1.5 text-[13px] tabular-nums text-slate-500">
                        {t("Mensajes:", "Messages:")} {dayList(s.stepDays, locale)}
                        {s.personFromStart
                          ? t(" · una persona lo atiende desde el primer día", " · a person handles it from day one")
                          : t(` · a una persona el día ${s.personAfterDays} si sigue igual`, ` · to a person on day ${s.personAfterDays} if nothing changes`)}
                      </p>
                      <details className="mt-1.5 text-[13px]">
                        <summary className="cursor-pointer font-medium text-blue-700">{t("Ver los mensajes", "See the messages")}</summary>
                        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-slate-600">
                          {FOLLOWUP_TEMPLATES[kind].map((template) => (
                            <li key={template.name}>{template.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => `[${template.params[Number(n) - 1]}]`)}</li>
                          ))}
                        </ol>
                      </details>
                    </div>
                    <Switch
                      on={settings.followups[kind]}
                      label={words.label}
                      disabled={disabled || !settings.followupsEnabled}
                      onChange={(next) => void save({ followups: { [kind]: next } })}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section aria-labelledby="avisos">
          <SectionTitle
            aside={<Switch on={settings.statusEnabled} label={t("Avisos de estado", "Status notices")} disabled={disabled} onChange={set("statusEnabled")} testId="switch-status" />}
          >
            <span id="avisos">{t("Avisos de estado", "Status notices")}</span>
          </SectionTitle>
          <div className="card px-5 py-4">
            <p className="text-[14px] leading-snug text-slate-600">
              {t("El cliente se entera solo de lo que ya pasó. Solo hechos: nunca puntajes ni promesas.", "The client hears only about what already happened. Facts only: never scores or promises.")}
            </p>
            <ul className="mt-3 space-y-1.5 text-[14px] text-slate-700">
              <li>{t("Se enviaron las cartas de su ronda", "Their round's letters were mailed")}</li>
              <li>{t("El correo entregó una carta certificada", "The post office delivered a certified letter")}</li>
              <li>{t("Llegó su reporte nuevo y cuántos de los puntos que indicó ya no aparecen", "Their new report came in, and how many of the items they flagged no longer show")}</li>
              <li>{t("Su siguiente ronda está preparada", "Their next round is prepared")}</li>
              <li>{t("Su recibo, cuando pasa un cobro", "Their receipt, when a charge goes through")}</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="canales">
          <SectionTitle>
            <span id="canales">{t("Canales", "Channels")}</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]" data-testid="channels">
            <Row
              title="WhatsApp"
              aside={
                <Chip tone={channels.whatsapp ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>
                  {channels.simulated ? t("Simulado", "Simulated") : channels.whatsapp ? t("Conectado", "Connected") : t("Sin configurar", "Not set up")}
                </Chip>
              }
            >
              {t(
                "El canal principal. Fuera de las 24 horas desde su último mensaje solo se puede escribir con plantillas aprobadas por Meta:",
                "The main channel. Outside the 24 hours since their last message, we can only write with templates Meta approved:",
              )}{" "}
              <span className="tabular-nums">{t(`${approved} de ${ALL_TEMPLATES.length}`, `${approved} of ${ALL_TEMPLATES.length}`)}</span> {t("aprobadas.", "approved.")}
              {gaps.whatsapp.length > 0 && (
                <span className="mt-1 block text-slate-500">
                  {t("Falta:", "Missing:")} {gaps.whatsapp.join("; ")}.
                </span>
              )}
            </Row>
            <Row
              title={t("Correo", "Email")}
              aside={
                <Chip tone={channels.email ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>
                  {channels.simulated ? t("Simulado", "Simulated") : channels.email ? t("Conectado", "Connected") : t("Sin configurar", "Not set up")}
                </Chip>
              }
            >
              {t(
                "Cuando WhatsApp no puede llevar el mensaje y el cliente dio su correo. Cada correo lleva el enlace de baja y la dirección postal de la empresa.",
                "When WhatsApp can't carry the message and the client gave their email. Every email carries the unsubscribe link and the company's mailing address.",
              )}
              {gaps.email.length > 0 && (
                <span className="mt-1 block text-slate-500">
                  {t("Falta:", "Missing:")} {gaps.email.join("; ")}.
                </span>
              )}
            </Row>
            <Row title={t("Mensajes de texto (SMS)", "Text messages (SMS)")} aside={<Chip tone="bg-slate-100 text-slate-600">{t("Nunca", "Never")}</Chip>}>
              {t(
                "Las compañías telefónicas rechazan los mensajes de reparación de crédito. Los SMS se usan solo para el código de inicio de sesión.",
                "Phone carriers reject credit repair messages. SMS is used only for the sign-in code.",
              )}
            </Row>
            <details className="px-5 py-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-blue-700">
                {t(`Las ${ALL_TEMPLATES.length} plantillas que hay que aprobar en Meta`, `The ${ALL_TEMPLATES.length} templates Meta has to approve`)}
              </summary>
              <ul className="mt-2 space-y-1 text-slate-600">
                {[...Object.values(FOLLOWUP_TEMPLATES).flat(), ...Object.values(STATUS_TEMPLATES)].map((template) => (
                  <li key={template.name}>
                    <code className="text-[12px] text-slate-800">{template.name}</code> — {template.purpose}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-slate-500">
                {t("Los pasos están en", "The steps are in")} <code>docs/AUTOPILOT.md</code>.
              </p>
            </details>
          </div>
        </section>

        <section aria-labelledby="minutos" className="lg:col-span-2">
          <SectionTitle>
            <span id="minutos">{t("Lo que sigue necesitando una persona", "What still needs a person")}</span>
          </SectionTitle>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-wide text-slate-500">
                <tr className="border-b hairline">
                  <th className="px-5 py-2.5 font-semibold">{t("Aviso", "Notice")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Minutos estimados", "Estimated minutes")}</th>
                  <th className="px-5 py-2.5 font-semibold">{t("Plazo", "Due within")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {EXCEPTION_KINDS.map((kind) => (
                  <tr key={kind} className="border-b hairline last:border-0">
                    <td className="px-5 py-2.5 text-slate-800">{EXCEPTION_LABELS[locale][kind]}</td>
                    <td className="px-3 py-2.5 text-slate-600">~{MINUTES_BY_KIND[kind]}</td>
                    <td className="px-5 py-2.5 text-slate-600">
                      {SLA_HOURS[SEVERITY_BY_KIND[kind]]} h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t hairline px-5 py-3 text-[13px] leading-snug text-slate-500">
              {t(
                "El plazo cuenta desde que el aviso pasa a una persona. Los minutos son un estimado para planear el día y para el número «Minutos de trabajo humano por cliente activo» en",
                "The deadline counts from when the notice goes to a person. Minutes are an estimate for planning the day and for the “Minutes of human work per active client” number in",
              )}{" "}
              <Link href="/equipo/negocio" className="font-medium text-blue-700 underline-offset-2 hover:underline">
                {t("Negocio", "Business")}
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
