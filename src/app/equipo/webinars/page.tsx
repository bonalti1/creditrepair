"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import { resetDemoWebinars, useWebinarsData } from "@/lib/webinars/data";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { webinarWhen } from "@/lib/webinars/time";
import type { Webinar } from "@/lib/webinars/types";
import type { CampaignsView, WebinarSummary } from "@/lib/webinars/views";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { DemoNote, EmptyState, NoAccess, pillTab, PRIMARY_BUTTON_COMPACT, ROW_BUTTON } from "@/components/staff/ui";
import { PhaseChip } from "@/components/staff/webinars/bits";
import Scorecards from "@/components/staff/webinars/Scorecard";
import WebinarForm from "@/components/staff/webinars/WebinarForm";

// Webinars (docs/WEBINARS.md): section 2 «Marketing», after Ads. The live
// classes (registration page, reminders, attendance, the live console, the
// script) and, for the owner, the campaign scorecard (?vista=campanas):
// spend, the funnel, CAC two ways and each client's value. webinars.view
// for every role; creating and changing webinars, webinars.manage; the
// campaigns are money, campaigns.view (administrators).

type View = "webinars" | "campaigns";

function Webinars() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(WEBINARS_TEXT);
  const { viewer, ready } = useViewer();
  const data = useWebinarsData(viewer);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const role = viewer?.role ?? null;
  const manage = can(role, "webinars.manage");
  const money = can(role, "campaigns.view");
  const view: View = params.get("vista") === "campanas" && money ? "campaigns" : "webinars";
  const [list, setList] = useState<{ webinars: WebinarSummary[]; sample: boolean } | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsView | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, c] = await Promise.all([data.list(), money ? data.campaigns() : Promise.resolve(null)]);
    setList(l);
    setCampaigns(c);
    setError(l === null);
  }, [data, money]);

  useEffect(() => {
    if (ready && viewer) void load();
  }, [ready, viewer, load]);

  if (!ready) return null;
  if (!can(role, "webinars.view")) return <NoAccess title={t("Webinars", "Webinars")} reason={deniedReason("webinars.view", locale)} />;

  const go = (v: View) => router.replace(v === "campaigns" ? `${path}?vista=campanas` : path, { scroll: false });
  const titleOf = (w: Webinar) => (locale === "es" ? w.title.es : w.title.en) || w.title.en || w.title.es;
  const campaignOptions = (campaigns?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name }));

  return (
    <main className="animate-rise min-w-0" data-testid="webinars-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{t("Webinars", "Webinars")}</h1>
          <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
            {t(
              "Las clases en vivo: el registro, los recordatorios (WhatsApp o correo, nunca SMS), la asistencia, la consola del moderador y el guion. Y para el dueño, cuánto cuesta de verdad cada cliente y cuánto vale.",
              "The live classes: registration, reminders (WhatsApp or email, never SMS), attendance, the moderator's console and the script. And for the owner, what each client really costs and what each one is worth.",
            )}
          </p>
        </div>
        {manage && view === "webinars" && !creating && (
          <button type="button" className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-4`} onClick={() => setCreating(true)} data-testid="new-webinar">
            <Icon name="plus" size={16} />
            {t("Nuevo webinar", "New webinar")}
          </button>
        )}
      </div>
      {list?.sample && (
        <DemoNote
          onReset={() => {
            resetDemoWebinars();
            void load();
          }}
        >
          {t(
            "webinars, registrados, campaña y prospectos de muestra. Nada se guarda en una base de datos y ningún recordatorio sale.",
            "sample webinars, registrants, campaign and leads. Nothing is saved to a database and no reminder goes out.",
          )}
        </DemoNote>
      )}

      {money && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("Vista", "View")}>
          <button type="button" role="tab" aria-selected={view === "webinars"} className={pillTab(view === "webinars")} onClick={() => go("webinars")} data-testid="view-webinars">
            {t("Webinars", "Webinars")}
          </button>
          <button type="button" role="tab" aria-selected={view === "campaigns"} className={pillTab(view === "campaigns")} onClick={() => go("campaigns")} data-testid="view-campaigns">
            {t("Campañas y costo por cliente", "Campaigns & cost per client")}
          </button>
        </div>
      )}
      {!money && (
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-slate-500">
          <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          {deniedReason("campaigns.view", locale)}
        </p>
      )}
      {note && (
        <p className="mt-3 rounded-[10px] bg-blue-50 px-3 py-2 text-[13.5px] text-blue-900" role="status">
          {note}
        </p>
      )}

      <div className="mt-5">
        {view === "campaigns" ? (
          campaigns ? (
            <SafeBoundary>
              <Scorecards view={campaigns} data={data} onChanged={() => void load()} />
            </SafeBoundary>
          ) : (
            <div className="h-40" aria-busy="true" />
          )
        ) : (
          <>
            {creating && (
              <div className="mb-4">
                <WebinarForm
                  data={data}
                  webinar={null}
                  campaigns={campaignOptions}
                  onCancel={() => setCreating(false)}
                  onSaved={(w) => {
                    setCreating(false);
                    setNote(t("Guardado como borrador. Ábrelo para publicarlo y compartir el enlace.", "Saved as a draft. Open it to publish it and share the link."));
                    void load();
                    router.push(`/equipo/webinars/${w.id}`);
                  }}
                />
              </div>
            )}
            {error ? (
              <p className="card px-5 py-4 text-[14px] text-red-700" role="alert">
                {t("No se pudieron leer los webinars ahora. Inténtalo en un minuto.", "The webinars could not be read right now. Try again in a minute.")}
              </p>
            ) : !list ? (
              <div className="h-40" aria-busy="true" />
            ) : list.webinars.length === 0 ? (
              <div className="card">
                <EmptyState pose="phone" title={t("Todavía no hay webinars", "No webinars yet")}>
                  {manage ? t("Crea el primero con «Nuevo webinar».", "Create the first one with “New webinar”.") : t("Un administrador crea los webinars.", "An administrator creates the webinars.")}
                </EmptyState>
              </div>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2" data-testid="webinar-list">
                {list.webinars.map((s) => (
                  <li key={s.webinar.id} className="card flex flex-col gap-3 px-5 py-4" data-testid="webinar-row">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/equipo/webinars/${s.webinar.id}`} className="font-display text-[17px] font-semibold text-blue-900 underline-offset-2 hover:underline [overflow-wrap:anywhere]">
                          {titleOf(s.webinar)}
                        </Link>
                        <p className="mt-0.5 text-[13.5px] text-slate-600">{webinarWhen(s.webinar.startsAt, locale)}</p>
                        <p className="text-[13px] text-slate-500">
                          {s.webinar.host} · {text.language[s.webinar.language]} · {t("palabra clave", "keyword")} <span className="font-mono font-semibold text-blue-900">{s.webinar.keyword}</span>
                        </p>
                      </div>
                      <PhaseChip phase={s.phase} label={text.phase[s.phase]} />
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      {[
                        [text.counters.registered, s.registered],
                        [text.counters.attended, s.phase === "upcoming" || s.phase === "draft" ? "—" : s.attended],
                        [t("Con recordatorios", "With reminders"), s.reminders],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-[10px] bg-slate-50 px-2 py-2">
                          <dt className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.05em] text-slate-500">{label}</dt>
                          <dd className="font-display text-[22px] font-semibold tabular-nums text-blue-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.outOfState > 0 && <p className="text-[12.5px] text-slate-500">{t(`${s.outOfState} fuera de Texas (solo aprender)`, `${s.outOfState} out of state (learning only)`)}</p>}
                    <div className="flex flex-wrap gap-2">
                      {(s.phase === "live" || s.phase === "upcoming") && (
                        <Link href={`/equipo/webinars/${s.webinar.id}/en-vivo`} className={`${ROW_BUTTON} gap-1.5`} data-testid="open-live">
                          <Icon name="play" size={15} />
                          {s.phase === "live" ? t("Consola en vivo", "Live console") : t("Consola", "Console")}
                        </Link>
                      )}
                      <Link href={`/equipo/webinars/${s.webinar.id}`} className={ROW_BUTTON}>
                        {t("Abrir", "Open")}
                      </Link>
                      <Link href={`/equipo/webinars/${s.webinar.id}/guion`} className={ROW_BUTTON}>
                        {t("Guion", "Script")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
              {t(
                "Las horas son de Texas. Los recordatorios salen solos a quien marcó la casilla: 1 semana, 1 día y 1 hora antes, al empezar, la repetición, y dos seguimientos (día 2 y día 5). Nunca de 9 p. m. a 8 a. m., nunca a quien pidió BAJA, nunca por SMS.",
                "Times are Texas time. Reminders go by themselves to people who ticked the box: 1 week, 1 day and 1 hour before, at the start, the replay, and two follow-ups (day 2 and day 5). Never 9 p.m. to 8 a.m., never to anyone who replied STOP, never by SMS.",
              )}{" "}
              {can(role, "leads.work") && (
                <Link href="/equipo/chats" className="font-medium text-blue-700 hover:underline">
                  {t("Chats en vivo del registro", "Live signup chats")}
                </Link>
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function WebinarsPage() {
  return (
    <Suspense fallback={null}>
      <Webinars />
    </Suspense>
  );
}
