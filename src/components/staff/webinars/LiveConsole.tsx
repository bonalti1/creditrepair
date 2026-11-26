"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import { useLiveChats } from "@/lib/signup/liveChatData";
import { useWebinarsData } from "@/lib/webinars/data";
import { runOfShow, type ScriptVars } from "@/lib/webinars/scripts";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { minutesIn, webinarWhen } from "@/lib/webinars/time";
import type { LiveView } from "@/lib/webinars/views";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { BACK_LINK, Chip, DemoNote, NoAccess } from "@/components/staff/ui";
import { Figure, PhaseChip } from "./bits";
import { ModeratorMessages, RunOfShow } from "./ScriptView";

// The live console (docs/WEBINARS.md, «During»). Polls every 5 seconds (no
// realtime in the app); the timer ticks every second. Leads show as a first
// name and an initial, with the start of their message. Nothing here sends
// anything: the moderator copies the messages into the stream's chat.

const POLL_MS = 5_000;
const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null;

function clock(minutes: number): string {
  const total = Math.max(0, Math.floor(Math.abs(minutes) * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

export default function LiveConsole({ prices }: { prices: { complete: string; diy: string } }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(WEBINARS_TEXT);
  const { id } = useParams<{ id: string }>();
  const { viewer, ready } = useViewer();
  const data = useWebinarsData(viewer);
  const [view, setView] = useState<LiveView | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());
  const [lang, setLang] = useState<"en" | "es">("es");
  const [chatsWaiting, setChatsWaiting] = useState<number | null>(null);
  const worksLeads = can(viewer?.role, "leads.work");
  const chats = useLiveChats(viewer, locale);

  const load = useCallback(async () => {
    if (document.hidden) return;
    const v = await data.liveView(id);
    setView((prior) => {
      if (prior === undefined && v) setLang(v.webinar.language === "en" ? "en" : v.webinar.language === "es" ? "es" : locale);
      return v;
    });
    if (worksLeads) setChatsWaiting(await chats.waiting());
  }, [data, id, locale, worksLeads, chats]);

  useEffect(() => {
    if (!ready || !viewer) return;
    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [ready, viewer, load]);

  if (!ready) return null;
  if (!can(viewer?.role, "webinars.view")) return <NoAccess title={t("Consola en vivo", "Live console")} reason={deniedReason("webinars.view", locale)} />;
  if (view === undefined) return <div className="h-40" aria-busy="true" />;
  if (view === null) return <p className="card px-5 py-4 text-[14px] text-slate-600">{t("No encontramos este webinar.", "We couldn't find this webinar.")}</p>;

  const w = view.webinar;
  const vars: ScriptVars = { keyword: w.keyword, signupLink: view.links.signup, pageLink: view.links.page, whatsapp: WHATSAPP, prices };
  const mins = minutesIn(w, now);
  const show = runOfShow(vars);
  const current = [...show].reverse().find((s) => mins >= s.at) ?? null;
  const nextCta = show.find((s) => s.cta && s.at > mins) ?? null;
  const c = view.counters;
  const title = (locale === "es" ? w.title.es : w.title.en) || w.title.en;

  return (
    <main className="animate-rise min-w-0" data-testid="live-console">
      <Link href={`/equipo/webinars/${w.id}`} className={BACK_LINK}>
        ‹ {title}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{t("Consola en vivo", "Live console")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-600 [overflow-wrap:anywhere]">
            {title} · {webinarWhen(w.startsAt, locale)}
          </p>
        </div>
        <PhaseChip phase={view.phase} label={text.phase[view.phase]} />
      </div>
      {view.sample && <DemoNote>{t("un webinar de muestra en vivo: los mensajes y prospectos son inventados y van llegando con los minutos.", "a sample live webinar: the messages and leads are made up and keep arriving as the minutes pass.")}</DemoNote>}

      {/* The navy band: the timer, where the show is, and the next call to action. */}
      <section className="mt-4 overflow-hidden rounded-[14px] bg-blue-900 text-white shadow-[0_6px_20px_rgba(18,33,58,0.12)]" aria-label={t("Reloj del show", "Show timer")} data-testid="live-timer">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-px bg-white/10 sm:grid-cols-3">
          <div className="bg-blue-900 px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{mins < 0 ? t("Empieza en", "Starts in") : t("En vivo desde hace", "Live for")}</p>
            <p className="font-display text-[34px] font-semibold leading-tight tabular-nums text-amber-400" data-on-navy aria-live="off">
              {clock(mins)}
            </p>
          </div>
          <div className="bg-blue-900 px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{t("Ahora", "Now")}</p>
            <p className="mt-1 text-[16px] font-semibold leading-snug">{current ? current.title[lang] : t("Antes de empezar: pega la bienvenida cuando llegue la gente.", "Before the start: paste the welcome as people arrive.")}</p>
          </div>
          <div className="bg-blue-900 px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-200">{t("Siguiente invitación", "Next call to action")}</p>
            <p className="mt-1 text-[16px] font-semibold leading-snug">
              {nextCta ? (
                <>
                  {nextCta.title[lang]} <span className="tabular-nums text-amber-300" data-on-navy>· {t(`en ${clock(nextCta.at - mins)}`, `in ${clock(nextCta.at - mins)}`)}</span>
                </>
              ) : (
                t("Ya pasaron las tres. Cierra y pon la repetición.", "All three are done. Close, then add the replay.")
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4" aria-labelledby="counters-title">
        <h2 id="counters-title" className="sr-only">{t("Contadores", "Counters")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="live-counters">
          <Figure label={text.counters.registered} value={c.registered} />
          <Figure label={text.counters.attended} value={c.attended} />
          <Figure label={text.counters.keywordMessages} value={c.keywordMessages} />
          <Figure label={text.counters.reportsUploaded} value={c.reportsUploaded} />
          <Figure label={text.counters.videosSent} value={c.videosSent} sub={c.videosSent === null ? text.noDataVideos : undefined} />
          <Figure label={text.counters.videosWatched} value={c.videosWatched} sub={c.videosWatched === null ? text.noDataVideos : undefined} />
          <Figure label={text.counters.signupsStarted} value={c.signupsStarted} />
          <Figure label={text.counters.signed} value={c.signed} tone="gold" />
        </div>
        <p className="mt-1 px-1 text-[12px] text-slate-500">{t("Se actualiza solo cada 5 segundos.", "Updates by itself every 5 seconds.")}</p>
      </section>

      {chatsWaiting !== null && chatsWaiting > 0 && (
        <Link href="/equipo/chats" className="mt-3 flex min-h-11 items-center gap-2 rounded-[12px] border border-red-200 bg-red-50 px-4 py-2 text-[14px] font-semibold text-red-800" data-testid="live-chats-waiting">
          <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[12px] text-white tabular-nums">{chatsWaiting}</span>
          {t("Alguien en el chat de registro pide una persona", "Someone in the signup chat asks for a person")}
          <Icon name="chevron" size={16} className="ml-auto" />
        </Link>
      )}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]">
        <section aria-labelledby="messages-title" className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="messages-title" className="console-label">{t("Mensajes para pegar en el chat", "Messages to paste in the chat")}</h2>
            <div className="flex gap-1" role="group" aria-label={t("Idioma de los mensajes", "Messages' language")}>
              {(["es", "en"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`pressable inline-flex h-11 items-center rounded-full border px-3 text-[13px] font-semibold md:h-9 ${lang === l ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div lang={lang}>
            <ModeratorMessages vars={vars} lang={lang} />
          </div>
        </section>
        <section aria-labelledby="show-title" className="min-w-0" lang={lang}>
          <h2 id="show-title" className="console-label mb-2">{t("Orden del show", "Run of show")}</h2>
          <RunOfShow vars={vars} lang={lang} compact currentAt={view.phase === "live" ? (current?.at ?? null) : null} />
          <Link href={`/equipo/webinars/${w.id}/guion`} className="mt-2 inline-flex min-h-11 items-center text-[13.5px] font-medium text-blue-700 hover:underline">
            {t("Abrir el guion completo", "Open the full script")}
          </Link>
        </section>
        <section aria-labelledby="leads-title" className="min-w-0">
          <h2 id="leads-title" className="console-label mb-2">{t("Mensajes y prospectos que llegan", "Messages and leads coming in")}</h2>
          <SafeBoundary>
            {view.leads.length === 0 ? (
              <p className="card px-4 py-3 text-[14px] text-slate-600">{t(`Todavía nada. Cuando alguien escriba ${w.keyword}, aparece aquí.`, `Nothing yet. When someone types ${w.keyword}, they show here.`)}</p>
            ) : (
              <ul className="space-y-1.5" aria-live="polite" data-testid="live-leads">
                {view.leads.map((l) => (
                  <li key={l.id} className="card flex items-start justify-between gap-2 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-slate-900">{l.name}</p>
                      {l.excerpt && <p className="text-[13px] text-slate-600 [overflow-wrap:anywhere]">“{l.excerpt}”</p>}
                      <p className="text-[12px] text-slate-500">{shortDateTime(l.at, locale)}</p>
                    </div>
                    <Chip tone={l.stage === "signed" ? "bg-emerald-50 text-emerald-800" : l.stage === "signup" ? "bg-blue-50 text-blue-900" : "bg-amber-100 text-blue-900"}>
                      {l.stage === "signed" ? text.counters.signed : l.stage === "signup" ? t("Registrándose", "Signing up") : l.keyword ?? t("Mensaje", "Message")}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </SafeBoundary>
          {worksLeads && (
            <Link href="/equipo/leads" className="mt-2 inline-flex min-h-11 items-center text-[13.5px] font-medium text-blue-700 hover:underline">
              {t("Contestar en Prospectos", "Answer them in Leads")}
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}
