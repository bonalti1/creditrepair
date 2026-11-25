"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { useMail } from "@/lib/mail/useMail";
import { DIGEST_TEMPLATE, morningSummary } from "@/lib/staff/digest";
import { ROLE_LABELS, ROLE_SUMMARIES } from "@/lib/staff/permissions";
import { DIGEST_CHANNEL_LABELS, DIGEST_CHANNELS, formatDigestTime, STAFF_TIME_ZONE_NAMES, STAFF_TIME_ZONES } from "@/lib/staff/preferences";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { LanguageSwitch } from "@/components/staff/StaffShell";
import { usePreferences } from "@/lib/staff/usePreferences";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { SectionTitle } from "@/components/staff/ui";

// The member's own page: who they are on the team, the console's language,
// their morning summary and their first-day checklist.
//
// The language is theirs alone (staff_preferences.locale; in the demo, this
// browser): English unless they choose Spanish. The morning summary goes in it.
//
// The morning summary (src/lib/staff/digest.ts) is off until they turn it on.
// They pick the channel (WhatsApp or email), the time (8:30 a.m. by default)
// and their clock; the preview below is the message as it would go now, from
// the same function the daily run uses (/api/cron/staff-digest).

const control =
  "h-11 w-full min-w-0 rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300";

export default function Perfil() {
  const { ready, clients, now, viewer, members, locale } = useStaff();
  const t = useTx();
  const { prefs, ready: prefsReady, update, demo } = usePreferences(viewer);
  const { env, ready: autopilotReady } = useAutopilot();
  const { furnishers, ready: bookReady } = useMail();
  const [origin, setOrigin] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const summary = useMemo(
    () => (viewer ? morningSummary(viewer, clients, now, { furnishers, autopilot: env }, origin, locale) : null),
    [viewer, clients, now, furnishers, env, origin, locale],
  );

  if (!ready || !prefsReady || !autopilotReady || !bookReady || !viewer || !summary) return null;
  const me = members.find((m) => m.handle === viewer.handle);
  const change = async (patch: Parameters<typeof update>[0]) => {
    setSaved(false);
    if (await update(patch)) setSaved(true);
  };

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Tu perfil", "Your profile")}</h1>
      <div className="card mt-5 flex items-center gap-4 px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-900 text-[16px] font-semibold text-white">
          {viewer.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-slate-900">{viewer.name}</p>
          <p className="text-[14px] text-slate-600">
            {ROLE_LABELS[locale][viewer.role]} · {ROLE_SUMMARIES[locale][viewer.role]}
          </p>
          {me && (
            <p className="text-[13px] text-slate-500">
              {[me.phone, me.email].filter(Boolean).join(" · ") || t("Sin teléfono ni correo en el equipo", "No phone or email on the team record")}
            </p>
          )}
        </div>
      </div>

      <section className="mt-7 scroll-mt-28" id="idioma" aria-labelledby="idioma-title" data-testid="language-section">
        <SectionTitle>
          <span id="idioma-title">{t("Idioma de la consola", "Console language")}</span>
        </SectionTitle>
        <div className="card flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[14px] leading-snug text-slate-600">
            {t(
              "Solo para ti: la consola y tu resumen de la mañana van en este idioma. Lo que se le escribe a un cliente va siempre en el idioma del cliente.",
              "Just for you: the console and your morning summary use this language. Whatever goes to a client is always in the client's language.",
            )}
          </p>
          <LanguageSwitch className="w-full shrink-0 sm:w-64" />
        </div>
      </section>

      <section className="mt-7 scroll-mt-28" id="resumen" aria-labelledby="resumen-title">
        <SectionTitle>
          <span id="resumen-title">{t("Resumen de la mañana", "Morning summary")}</span>
        </SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="card px-5 py-5">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-[16px] font-semibold text-slate-900">{t("Mandarme mi trabajo del día", "Send me my work for the day")}</span>
                <span className="block text-[13.5px] leading-snug text-slate-600">
                  {t(
                    "Cuántas cosas hay, las 3 primeras, qué hizo el sistema en la noche y un enlace a «Siguiente». Una vez al día.",
                    "How many things there are, the first 3, what the system did overnight and a link to “Next”. Once a day.",
                  )}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={prefs.digestEnabled}
                onChange={(e) => change({ digestEnabled: e.target.checked })}
                className="peer sr-only"
                data-testid="digest-toggle"
              />
              <span
                aria-hidden="true"
                className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-blue-700 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300"
              />
            </label>

            <fieldset className="mt-5">
              <legend className="text-[14px] font-medium text-slate-900">{t("Por dónde", "How")}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DIGEST_CHANNELS.map((channel) => (
                  <label
                    key={channel}
                    className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-[14px] font-semibold ${
                      prefs.digestChannel === channel ? "bg-blue-900 text-white" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    <input type="radio" name="channel" value={channel} checked={prefs.digestChannel === channel} onChange={() => change({ digestChannel: channel })} className="sr-only" />
                    <Icon name={channel === "email" ? "mail" : "chat"} size={16} />
                    {DIGEST_CHANNEL_LABELS[locale][channel]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-[14px] font-medium text-slate-900">
                {t("A qué hora", "What time")}
                <input type="time" value={prefs.digestTime} onChange={(e) => e.target.value && change({ digestTime: e.target.value })} className={`${control} mt-1.5`} />
              </label>
              <label className="block text-[14px] font-medium text-slate-900">
                {t("Tu horario", "Your time zone")}
                <select value={prefs.timeZone} onChange={(e) => change({ timeZone: e.target.value })} className={`${control} mt-1.5`}>
                  {STAFF_TIME_ZONES.map(([zone]) => (
                    <option key={zone} value={zone}>
                      {STAFF_TIME_ZONE_NAMES[locale][zone]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
              {t(
                `Nunca de noche: respeta el mismo horario de silencio que los mensajes a clientes (${env.settings.quietStartHour}:00 a ${env.settings.quietEndHour}:00). Por WhatsApp sale con la plantilla aprobada «${DIGEST_TEMPLATE}»; si no se puede, por correo. Nunca por mensaje de texto.`,
                `Never at night: it keeps the same quiet hours as messages to clients (${env.settings.quietStartHour}:00 to ${env.settings.quietEndHour}:00). On WhatsApp it goes with the approved “${DIGEST_TEMPLATE}” template; if that can't go, by email. Never by text message.`,
              )}
              {demo && t(" En la demo no se envía nada.", " Nothing is sent in the demo.")}
            </p>
            {saved && (
              <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-medium text-green-700" role="status">
                <Icon name="check" size={15} />
                {t("Guardado", "Saved")}
              </p>
            )}
          </div>

          <div className="card px-5 py-5" data-testid="digest-preview">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
              {prefs.digestEnabled
                ? t(`Así se vería mañana a las ${formatDigestTime(prefs.digestTime, "es")}`, `How it would look tomorrow at ${formatDigestTime(prefs.digestTime, "en")}`)
                : t("Así se vería (está apagado)", "How it would look (it's off)")}
            </p>
            <div className="mt-3 rounded-2xl rounded-tl-md bg-green-50 px-4 py-3">
              <p className="whitespace-pre-line break-words text-[14.5px] leading-snug text-slate-900">{summary.text}</p>
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
              {t("Con tus clientes de ahora. Los clientes van con su nombre y la inicial del apellido.", "With your clients as of now. Clients appear by first name and last initial.")}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7" aria-labelledby="primer-dia-perfil">
        <SectionTitle>
          <span id="primer-dia-perfil">{t("Tu primer día", "Your first day")}</span>
        </SectionTitle>
        <div className="card flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14.5px] leading-snug text-slate-700">
            {prefs.checklistDismissedAt
              ? t("Cerraste la lista del primer día.", "You closed the first-day list.")
              : t("La lista del primer día está en tu inicio.", "The first-day list is on your home screen.")}{" "}
            {t("La bienvenida, las reglas y el recorrido siguen aquí:", "The welcome page, the rules and the tour are still here:")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/equipo/bienvenida" className="pressable inline-flex h-11 items-center rounded-full bg-slate-100 px-4 text-[14px] font-semibold text-slate-900">
              {t("Bienvenida", "Welcome")}
            </Link>
            {prefs.checklistDismissedAt && (
              <button type="button" onClick={() => change({ checklistDismissed: false })} className="pressable inline-flex h-11 items-center rounded-full px-3 text-[14px] font-medium text-blue-700 hover:bg-slate-100">
                {t("Volver a mostrar la lista", "Show the list again")}
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
