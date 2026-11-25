"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_WAITING_MINUTES, TOPIC_TEXT, type AlertTopic } from "@/lib/control/alerts";
import { getAlertsData, pushSupported, type AlertsView } from "@/lib/control/alertsData";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";

// Phone alerts (docs/CONTROL.md): each member chooses, per topic, what pings
// their phone. Everything starts OFF. Only the topics about the member's own
// work are offered (sales: leads; a specialist: complaints and partner notes
// about their clients; the owner: everything, and what the team escalates).
// The phone gets a web push that carries no words; the words come from the
// app, with the member's own session.

const WAIT_CHOICES = [5, 10, 15, 30, 60, 120];

export default function AlertsPage() {
  const { viewer, ready } = useViewer();
  const { locale } = useStaffLocale();
  const t = useTx();
  const data = useMemo(() => getAlertsData(viewer), [viewer]);
  const [view, setView] = useState<AlertsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await data.load());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [data]);
  useEffect(() => {
    setSupported(pushSupported());
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return null;
  const words = TOPIC_TEXT[locale];

  const toggle = async (topic: AlertTopic, enabled: boolean, minutes?: number) => {
    await data.setTopic(topic, enabled, minutes);
    await load();
  };

  const enable = async () => {
    if (!view?.push.publicKey) return;
    const outcome = await data.enablePush(view.push.publicKey);
    setStatus(
      outcome === "on"
        ? t("Listo: este teléfono recibe tus alertas.", "Done: this phone gets your alerts.")
        : outcome === "denied"
          ? t("El navegador no dio permiso. Actívalo en los ajustes de notificaciones del teléfono.", "The browser didn't give permission. Turn it on in the phone's notification settings.")
          : outcome === "unsupported"
            ? t("Este navegador no recibe alertas. En iPhone: agrega la consola a la pantalla de inicio y ábrela desde ahí.", "This browser can't receive alerts. On an iPhone: add the console to the Home Screen and open it from there.")
            : t("No se pudo activar. Intenta de nuevo.", "It couldn't be turned on. Try again."),
    );
    await load();
  };

  return (
    <main className="animate-rise max-w-3xl">
      <h1 className="page-title">{t("Alertas al teléfono", "Phone alerts")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        {t("Tú eliges qué te avisa. Todo empieza apagado. Las alertas llevan lo mínimo: un nombre y una inicial, nunca datos de crédito.", "You choose what pings you. Everything starts off. Alerts carry the least: a first name and an initial, never credit details.")}
      </p>

      {failed && <p className="card mt-5 px-5 py-4 text-[14px] text-slate-600">{t("No se pudieron leer tus alertas ahora.", "Your alerts couldn't be read right now.")}</p>}

      {view && (
        <SafeBoundary>
          <section className="card mt-5 px-5 py-5" aria-labelledby="this-phone" data-testid="push-card">
            <h2 id="this-phone" className="flex items-center gap-2 text-[17px] font-semibold text-slate-900">
              <Icon name="bell" size={18} />
              {t("Este teléfono", "This phone")}
            </h2>
            {data.demo ? (
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                {t("En la demo no hay servidor que envíe alertas. Puedes elegir los temas; con la base de datos y las claves VAPID, el teléfono las recibe.", "The demo has no server to send alerts. You can pick the topics; with the database and the VAPID keys, the phone gets them.")}
              </p>
            ) : !view.push.configured ? (
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                {t("El servidor todavía no tiene las claves para avisar al teléfono (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Mientras tanto, tus alertas aparecen abajo.", "The server doesn't have the keys to ping phones yet (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Until then, your alerts show below.")}
              </p>
            ) : (
              <>
                <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                  {view.push.devices > 0
                    ? t(`Tus alertas llegan a ${view.push.devices} ${view.push.devices === 1 ? "navegador" : "navegadores"}.`, `Your alerts reach ${view.push.devices} ${view.push.devices === 1 ? "browser" : "browsers"}.`)
                    : t("Ningún teléfono recibe tus alertas todavía.", "No phone gets your alerts yet.")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY_BUTTON_COMPACT} onClick={enable} disabled={!supported}>
                    {t("Recibir alertas en este teléfono", "Get alerts on this phone")}
                  </button>
                  {view.push.devices > 0 && (
                    <>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_COMPACT}
                        onClick={async () => {
                          const r = await data.test();
                          setStatus(r.ok ? t("Te mandamos una prueba.", "We sent you a test.") : t("No se pudo mandar la prueba.", "The test couldn't be sent."));
                        }}
                      >
                        {t("Mandarme una prueba", "Send me a test")}
                      </button>
                      <button
                        type="button"
                        className={QUIET_BUTTON}
                        onClick={async () => {
                          await data.disablePush();
                          await load();
                        }}
                      >
                        {t("Dejar de recibir aquí", "Stop on this phone")}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {status && <p className="mt-2 text-[13.5px] text-slate-700" role="status">{status}</p>}
          </section>

          <section className="card mt-4 px-5 py-2" aria-label={t("Temas", "Topics")} data-testid="alert-topics">
            <ul className="divide-y divide-slate-100">
              {view.topics.map((topic) => {
                const pref = view.prefs[topic];
                return (
                  <li key={topic} className="py-3.5" data-testid={`topic-${topic}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-slate-900">{words[topic].label}</p>
                        <p className="mt-0.5 text-[13.5px] leading-snug text-slate-600">{words[topic].help}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={pref.enabled}
                        aria-label={words[topic].label}
                        onClick={() => void toggle(topic, !pref.enabled, pref.waitingMinutes)}
                        className={`relative mt-1 h-8 w-14 shrink-0 rounded-full transition-colors ${pref.enabled ? "bg-blue-700" : "bg-slate-300"}`}
                      >
                        <span className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${pref.enabled ? "translate-x-7" : "translate-x-1"}`} />
                      </button>
                    </div>
                    {topic === "lead_waiting" && (
                      <label className="mt-2 flex items-center gap-2 text-[13.5px] text-slate-700">
                        {t("Avísame después de", "Ping me after")}
                        <select
                          value={pref.waitingMinutes || DEFAULT_WAITING_MINUTES}
                          onChange={(e) => void toggle(topic, pref.enabled, Number(e.target.value))}
                          className="h-11 rounded-xl border border-slate-300 bg-white px-2 text-[15px] md:h-9"
                        >
                          {WAIT_CHOICES.map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                        {t("sin respuesta", "without an answer")}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-5" aria-labelledby="recent-alerts">
            <h2 id="recent-alerts" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
              {t("Tus últimas alertas", "Your latest alerts")}
            </h2>
            <div className="card px-5 py-4">
              {view.recent.length === 0 ? (
                <p className="text-[14px] text-slate-500">{t("Ninguna todavía.", "None yet.")}</p>
              ) : (
                <ul className="space-y-2.5">
                  {view.recent.map((a) => (
                    <li key={a.id} className="text-[14px] leading-snug">
                      <a href={a.url} className="font-semibold text-slate-900 underline-offset-2 hover:underline">
                        {a.title}
                      </a>
                      {a.body && <span className="block text-slate-600">{a.body}</span>}
                      <span className="block text-[12px] text-slate-500">
                        {shortDateTime(a.created_at, locale)} · {a.pushed_at ? t("llegó al teléfono", "reached the phone") : t("solo aquí", "here only")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </SafeBoundary>
      )}
    </main>
  );
}
