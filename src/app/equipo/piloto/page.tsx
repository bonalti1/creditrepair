"use client";

import { useState } from "react";
import Link from "next/link";
import { FOLLOWUP_SCHEDULES } from "@/lib/autopilot/followups";
import { MINUTES_BY_KIND, SEVERITY_BY_KIND, SLA_HOURS } from "@/lib/autopilot/queue";
import { ALL_TEMPLATES, FOLLOWUP_TEMPLATES, STATUS_TEMPLATES } from "@/lib/autopilot/templates";
import { FOLLOWUP_KINDS, REVIEW_WINDOW_CHOICES, type AutopilotSettings, type FollowupKind } from "@/lib/autopilot/types";
import type { SettingsPatch } from "@/lib/autopilot/store";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { deniedReason } from "@/lib/staff/permissions";
import { EXCEPTION_KINDS, EXCEPTION_LABEL } from "@/lib/staff/stage";
import { shortDateTime } from "@/lib/staff/format";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { Chip, DeniedNote, SectionTitle } from "@/components/staff/ui";

// Piloto automático: what the system does by itself, and the switches for it.
// Plain Spanish, one card per thing. An administrator changes them; everyone
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

const hourLabel = (h: number) => {
  const suffix = h < 12 ? "a. m." : "p. m.";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
};

const dayList = (days: readonly number[]) => days.map((d) => (d === 0 ? "el mismo día" : `día ${d}`)).join(" · ");

export default function PilotoPage() {
  const { ready, can } = useStaff();
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
    setMessage(result.ok ? "Guardado." : result.message);
    await reload();
  };
  const set = <K extends keyof AutopilotSettings>(key: K) => (value: AutopilotSettings[K]) => void save({ [key]: value } as SettingsPatch);

  const approved = channels.approvedTemplates === "all" ? ALL_TEMPLATES.length : ALL_TEMPLATES.filter((t) => (channels.approvedTemplates as readonly string[]).includes(t.name)).length;

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Piloto automático</h1>
      <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-slate-500">
        Lo que el sistema hace solo, para que el equipo atienda solo lo que necesita una persona. Ninguna regla de envío cambia: el acuerdo, el
        periodo de cancelación, lo que el cliente confirmó, las direcciones y los cobros se revisan igual antes de cada carta.
      </p>
      {!admin && (
        <div className="mt-3">
          <DeniedNote>{deniedReason("autopilot.manage")} Aquí ves cómo está configurado.</DeniedNote>
        </div>
      )}
      {autopilot.demo && (
        <p className="mt-3 max-w-2xl rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
          En la demo el piloto automático está encendido para mostrar cómo trabaja, y ningún mensaje sale de verdad. Con la base de datos empieza
          apagado hasta que una persona administradora lo encienda.
        </p>
      )}
      {settings.updatedAt && (
        <p className="mt-2 text-[13px] text-slate-500">
          Último cambio: {shortDateTime(settings.updatedAt)}
          {settings.updatedBy ? `, por ${settings.updatedBy}` : ""}.
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
            <span id="envio">Envío automático de rondas</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <Row
              title="Enviar solas las rondas listas"
              aside={<Switch on={settings.roundsEnabled} label="Enviar solas las rondas listas" disabled={disabled} onChange={set("roundsEnabled")} testId="switch-rounds" />}
            >
              Una ronda que pasa todas las revisiones espera en «Listas para enviar» y, si nadie la detiene, sale sola por correo postal en la
              siguiente vuelta del sistema (cada hora). El sistema queda registrado como quien la envió.
            </Row>
            <Row
              title="Tiempo de revisión"
              aside={
                <select
                  aria-label="Tiempo de revisión"
                  value={settings.reviewWindowHours}
                  disabled={disabled}
                  onChange={(e) => void save({ reviewWindowHours: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[14px] disabled:opacity-60"
                >
                  {[...new Set([...REVIEW_WINDOW_CHOICES, settings.reviewWindowHours])].sort((a, b) => a - b).map((h) => (
                    <option key={h} value={h}>
                      {h} horas
                    </option>
                  ))}
                </select>
              }
            >
              Cuánto tiempo se ve una ronda lista antes de salir sola. Cualquier persona que envía rondas puede detener a un cliente con un motivo.
            </Row>
          </div>
        </section>

        <section aria-labelledby="reglas">
          <SectionTitle>
            <span id="reglas">Cuándo y cuánto se escribe</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <Row
              title="Horas de silencio"
              aside={
                <span className="flex items-center gap-1.5 text-[14px] text-slate-600">
                  <select
                    aria-label="Desde"
                    value={settings.quietStartHour}
                    disabled={disabled}
                    onChange={(e) => void save({ quietStartHour: Number(e.target.value) })}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-[14px] disabled:opacity-60"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                  a
                  <select
                    aria-label="Hasta"
                    value={settings.quietEndHour}
                    disabled={disabled}
                    onChange={(e) => void save({ quietEndHour: Number(e.target.value) })}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-[14px] disabled:opacity-60"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </span>
              }
            >
              Ningún mensaje automático en ese horario, en la hora del cliente (Texas si no se sabe). Lo que toque se envía al terminar.
            </Row>
            <Row
              title="Máximo por cliente al día"
              aside={
                <select
                  aria-label="Máximo por cliente al día"
                  value={settings.dailyCap}
                  disabled={disabled}
                  onChange={(e) => void save({ dailyCap: Number(e.target.value) })}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[14px] disabled:opacity-60"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "mensaje" : "mensajes"}
                    </option>
                  ))}
                </select>
              }
            >
              Primero los avisos de estado, luego los recordatorios. Lo que no cabe sale al día siguiente.
            </Row>
            <Row title="Si el cliente no quiere mensajes" aside={<Chip tone="bg-green-50 text-green-700">Siempre</Chip>}>
              Si responde BAJA o STOP por WhatsApp, o usa el enlace de baja de un correo, no recibe ningún mensaje automático más. Queda anotado en
              su caso y sus avisos pasan a una persona. ALTA o START los vuelve a activar.
            </Row>
          </div>
        </section>

        <section aria-labelledby="recordatorios" className="lg:col-span-2">
          <SectionTitle
            aside={
              <span className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                Recordatorios automáticos
                <Switch on={settings.followupsEnabled} label="Recordatorios automáticos" disabled={disabled} onChange={set("followupsEnabled")} testId="switch-followups" />
              </span>
            }
          >
            <span id="recordatorios">Recordatorios al cliente</span>
          </SectionTitle>
          <div className="card overflow-hidden">
            <p className="border-b hairline px-5 py-3 text-[14px] leading-snug text-slate-600">
              En lugar de un botón «Recordarle…», el sistema le escribe al cliente tres veces, unos días aparte, con un enlace a la pantalla que lo
              resuelve. Si nada cambia, pasa a «Necesita una persona» con lo que ya se le envió. Si el cliente avanza, el conteo vuelve a empezar.
              {!settings.followupsEnabled && " Apagados: esos avisos llegan a una persona como antes."}
            </p>
            <ul className="divide-y divide-slate-900/[0.06]">
              {FOLLOWUP_KINDS.map((kind: FollowupKind) => {
                const s = FOLLOWUP_SCHEDULES[kind];
                return (
                  <li key={kind} className="flex items-start justify-between gap-4 px-5 py-4" data-testid={`followup-${kind}`}>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-slate-900">{s.label}</p>
                      <p className="mt-0.5 text-[14px] leading-snug text-slate-600">{s.description}</p>
                      <p className="mt-1.5 text-[13px] tabular-nums text-slate-500">
                        Mensajes: {dayList(s.stepDays)}
                        {s.personFromStart ? " · una persona lo atiende desde el primer día" : ` · a una persona el día ${s.personAfterDays} si sigue igual`}
                      </p>
                      <details className="mt-1.5 text-[13px]">
                        <summary className="cursor-pointer font-medium text-blue-700">Ver los mensajes</summary>
                        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-slate-600">
                          {FOLLOWUP_TEMPLATES[kind].map((t) => (
                            <li key={t.name}>{t.body.es.replace(/\{\{(\d+)\}\}/g, (_, n: string) => `[${t.params[Number(n) - 1]}]`)}</li>
                          ))}
                        </ol>
                      </details>
                    </div>
                    <Switch
                      on={settings.followups[kind]}
                      label={s.label}
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
            aside={<Switch on={settings.statusEnabled} label="Avisos de estado" disabled={disabled} onChange={set("statusEnabled")} testId="switch-status" />}
          >
            <span id="avisos">Avisos de estado</span>
          </SectionTitle>
          <div className="card px-5 py-4">
            <p className="text-[14px] leading-snug text-slate-600">
              El cliente se entera solo de lo que ya pasó. Solo hechos: nunca puntajes ni promesas.
            </p>
            <ul className="mt-3 space-y-1.5 text-[14px] text-slate-700">
              <li>Se enviaron las cartas de su ronda</li>
              <li>El correo entregó una carta certificada</li>
              <li>Llegó su reporte nuevo y cuántos de los puntos que indicó ya no aparecen</li>
              <li>Su siguiente ronda está preparada</li>
              <li>Su recibo, cuando pasa un cobro</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="canales">
          <SectionTitle>
            <span id="canales">Canales</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]" data-testid="channels">
            <Row title="WhatsApp" aside={<Chip tone={channels.whatsapp ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>{channels.simulated ? "Simulado" : channels.whatsapp ? "Conectado" : "Sin configurar"}</Chip>}>
              El canal principal. Fuera de las 24 horas desde su último mensaje solo se puede escribir con plantillas aprobadas por Meta:{" "}
              <span className="tabular-nums">
                {approved} de {ALL_TEMPLATES.length}
              </span>{" "}
              aprobadas.
              {gaps.whatsapp.length > 0 && <span className="mt-1 block text-slate-500">Falta: {gaps.whatsapp.join("; ")}.</span>}
            </Row>
            <Row title="Correo" aside={<Chip tone={channels.email ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>{channels.simulated ? "Simulado" : channels.email ? "Conectado" : "Sin configurar"}</Chip>}>
              Cuando WhatsApp no puede llevar el mensaje y el cliente dio su correo. Cada correo lleva el enlace de baja y la dirección postal de la
              empresa.
              {gaps.email.length > 0 && <span className="mt-1 block text-slate-500">Falta: {gaps.email.join("; ")}.</span>}
            </Row>
            <Row title="Mensajes de texto (SMS)" aside={<Chip tone="bg-slate-100 text-slate-600">Nunca</Chip>}>
              Las compañías telefónicas rechazan los mensajes de reparación de crédito. Los SMS se usan solo para el código de inicio de sesión.
            </Row>
            <details className="px-5 py-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-blue-700">Las {ALL_TEMPLATES.length} plantillas que hay que aprobar en Meta</summary>
              <ul className="mt-2 space-y-1 text-slate-600">
                {[...Object.values(FOLLOWUP_TEMPLATES).flat(), ...Object.values(STATUS_TEMPLATES)].map((t) => (
                  <li key={t.name}>
                    <code className="text-[12px] text-slate-800">{t.name}</code> — {t.purpose}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-slate-500">
                Los pasos están en <code>docs/AUTOPILOT.md</code>.
              </p>
            </details>
          </div>
        </section>

        <section aria-labelledby="minutos" className="lg:col-span-2">
          <SectionTitle>
            <span id="minutos">Lo que sigue necesitando una persona</span>
          </SectionTitle>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-wide text-slate-500">
                <tr className="border-b hairline">
                  <th className="px-5 py-2.5 font-semibold">Aviso</th>
                  <th className="px-3 py-2.5 font-semibold">Minutos estimados</th>
                  <th className="px-5 py-2.5 font-semibold">Plazo</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {EXCEPTION_KINDS.map((kind) => (
                  <tr key={kind} className="border-b hairline last:border-0">
                    <td className="px-5 py-2.5 text-slate-800">{EXCEPTION_LABEL[kind]}</td>
                    <td className="px-3 py-2.5 text-slate-600">~{MINUTES_BY_KIND[kind]}</td>
                    <td className="px-5 py-2.5 text-slate-600">
                      {SLA_HOURS[SEVERITY_BY_KIND[kind]]} h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t hairline px-5 py-3 text-[13px] leading-snug text-slate-500">
              El plazo cuenta desde que el aviso pasa a una persona. Los minutos son un estimado para planear el día y para el número «Minutos de
              trabajo humano por cliente activo» en{" "}
              <Link href="/equipo/negocio" className="font-medium text-blue-700 underline-offset-2 hover:underline">
                Negocio
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
