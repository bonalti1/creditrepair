"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import { useWebinarsData } from "@/lib/webinars/data";
import { PLATFORM_NAMES } from "@/lib/webinars/publicCopy";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { webinarWhen } from "@/lib/webinars/time";
import { PLATFORMS } from "@/lib/webinars/types";
import type { CampaignsView, WebinarDetail } from "@/lib/webinars/views";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { BACK_LINK, Chip, DemoNote, GOLD_ROW_BUTTON, pillTab, QUIET_BUTTON, ROW_BUTTON } from "@/components/staff/ui";
import { CopyButton, Figure, PhaseChip } from "@/components/staff/webinars/bits";
import WebinarForm from "@/components/staff/webinars/WebinarForm";

// One webinar (docs/WEBINARS.md): its links and state, the counters, the
// reminders sent (administrators), attendance (Zoom's attendee CSV, matched
// to the registrants by email then phone, previewed before it is saved; or
// by hand) and the registrants. Phones, emails and questions show only to a
// member who works leads (leads.work); the others see "Rosa G.".

export default function WebinarDetailPage() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(WEBINARS_TEXT);
  const { id } = useParams<{ id: string }>();
  const { viewer, ready } = useViewer();
  const data = useWebinarsData(viewer);
  const role = viewer?.role ?? null;
  const manage = can(role, "webinars.manage");
  const [detail, setDetail] = useState<WebinarDetail | null | undefined>(undefined);
  const [campaigns, setCampaigns] = useState<CampaignsView | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ attendees: number; matched: number; unmatched: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "attended" | "absent" | "out">("all");

  const load = useCallback(async () => {
    setDetail(await data.detail(id));
    if (can(role, "campaigns.view")) setCampaigns(await data.campaigns());
  }, [data, id, role]);

  useEffect(() => {
    if (ready && viewer) void load();
  }, [ready, viewer, load]);

  if (!ready || detail === undefined) return <div className="h-40" aria-busy="true" />;
  if (detail === null)
    return (
      <main className="min-w-0">
        <Link href="/equipo/webinars" className={BACK_LINK}>‹ {t("Webinars", "Webinars")}</Link>
        <p className="card mt-3 px-5 py-4 text-[14px] text-slate-600">{t("No encontramos este webinar.", "We couldn't find this webinar.")}</p>
      </main>
    );

  const w = detail.webinar;
  const title = (locale === "es" ? w.title.es : w.title.en) || w.title.en;
  const act = async (promise: Promise<{ ok: boolean; message?: { en: string; es: string } }>, done: string) => {
    const out = await promise;
    setNote(out.ok ? { text: done, tone: "ok" } : { text: out.message?.[locale] ?? t("No se pudo.", "That didn't work."), tone: "error" });
    await load();
  };
  const shown = detail.registrants.filter((r) => (filter === "attended" ? r.attended : filter === "absent" ? !r.attended : filter === "out" ? r.served === "out_of_state" : true));
  const c = detail.counters;

  if (editing)
    return (
      <main className="min-w-0">
        <button type="button" onClick={() => setEditing(false)} className={BACK_LINK}>‹ {title}</button>
        <div className="mt-3">
          <WebinarForm data={data} webinar={w} campaigns={(campaigns?.campaigns ?? []).map((x) => ({ id: x.id, name: x.name }))} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setNote({ text: t("Guardado.", "Saved."), tone: "ok" }); void load(); }} />
        </div>
      </main>
    );

  return (
    <main className="animate-rise min-w-0" data-testid="webinar-detail">
      <Link href="/equipo/webinars" className={BACK_LINK}>‹ {t("Webinars", "Webinars")}</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{title}</h1>
          <p className="mt-1 text-[14.5px] text-slate-600">{webinarWhen(w.startsAt, locale)} · {w.durationMinutes} min · {w.host}</p>
          <p className="text-[13.5px] text-slate-500">
            {text.language[w.language]} · {t("palabra clave", "keyword")} <span className="font-mono font-semibold text-blue-900">{w.keyword}</span>
            {w.campaignTag && <> · {t("etiqueta", "tag")} <span className="font-mono">{w.campaignTag}</span></>}
          </p>
        </div>
        <PhaseChip phase={detail.phase} label={text.phase[detail.phase]} />
      </div>
      {detail.sample && <DemoNote>{t("un webinar de muestra con registrados inventados.", "a sample webinar with made-up registrants.")}</DemoNote>}
      {note && (
        <p className={`mt-3 rounded-[10px] px-3 py-2 text-[13.5px] ${note.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`} role={note.tone === "ok" ? "status" : "alert"}>
          {note.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/equipo/webinars/${w.id}/en-vivo`} className={`${GOLD_ROW_BUTTON} gap-1.5`} data-testid="detail-live">
          <Icon name="play" size={15} />
          {t("Consola en vivo", "Live console")}
        </Link>
        <Link href={`/equipo/webinars/${w.id}/guion`} className={ROW_BUTTON}>{t("Guion y orden del show", "Script & run of show")}</Link>
        {w.status !== "draft" && (
          <a href={`/webinar/${w.slug}`} target="_blank" rel="noopener noreferrer" className={ROW_BUTTON}>
            {t("Ver la página de registro", "See the registration page")}
          </a>
        )}
        {manage && w.status === "draft" && (
          <button type="button" className={ROW_BUTTON} onClick={() => void act(data.setStatus(w.id, "published"), t("Publicado: ya se puede registrar la gente.", "Published: people can register now."))} data-testid="publish">
            {t("Publicar", "Publish")}
          </button>
        )}
        {manage && w.status !== "cancelled" && (
          <button type="button" className={ROW_BUTTON} onClick={() => setEditing(true)} data-testid="edit-webinar">
            {t("Cambiar", "Change")}
          </button>
        )}
        {manage && w.status === "published" && detail.phase === "upcoming" && (
          <button
            type="button"
            className={QUIET_BUTTON}
            onClick={() => {
              if (window.confirm(t("¿Cancelar este webinar? No se puede deshacer y no salen más recordatorios.", "Cancel this webinar? It can't be undone and no more reminders go out."))) void act(data.setStatus(w.id, "cancelled"), t("Cancelado.", "Cancelled."));
            }}
          >
            {t("Cancelar el webinar", "Cancel the webinar")}
          </button>
        )}
      </div>

      <section className="card mt-4 px-5 py-4" aria-labelledby="links-title">
        <h2 id="links-title" className="console-label">{t("Enlaces", "Links")}</h2>
        <ul className="mt-2 space-y-2 text-[14px]">
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">{t("Registro", "Registration")}:</span> {detail.links.page}
            </span>
            <CopyButton text={detail.links.page} label={t("Enlace de registro", "Registration link")} testId="copy-registration" />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">{t("Registro con Alti", "Sign up with Alti")}:</span> {detail.links.signup}
            </span>
            <CopyButton text={detail.links.signup} label={t("Enlace de registro con Alti", "Sign-up link")} />
          </li>
          {PLATFORMS.filter((p) => w.links[p]).map((p) => (
            <li key={p} className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">{PLATFORM_NAMES[p]}:</span> {w.links[p]}
            </li>
          ))}
          <li className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-semibold">{t("Repetición", "Replay")}:</span> {w.replayUrl ?? t("todavía no (ponla al terminar: así sale el mensaje de la repetición)", "not yet (add it when it ends: that sends the replay message)")}
          </li>
        </ul>
      </section>

      <section className="mt-4" aria-labelledby="numbers-title">
        <h2 id="numbers-title" className="console-label px-1">{t("Números", "Numbers")}</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="detail-counters">
          <Figure label={text.counters.registered} value={c.registered} />
          <Figure label={text.counters.attended} value={c.attended} />
          <Figure label={text.counters.keywordMessages} value={detail.contact ? c.keywordMessages : null} />
          <Figure label={text.counters.signed} value={detail.contact ? c.signed : null} tone="gold" />
        </div>
        {!detail.contact && <p className="mt-1 px-1 text-[12.5px] text-slate-500">{t("Los prospectos los ve quien atiende prospectos (administradores y ventas).", "Leads are for members who work leads (administrators and sales).")}</p>}
      </section>

      {detail.reminders && (
        <section className="card mt-4 px-5 py-4" aria-labelledby="reminders-title" data-testid="reminder-stats">
          <h2 id="reminders-title" className="console-label">{t("Recordatorios enviados", "Reminders sent")}</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11.5px] uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-3 py-2 font-semibold">{t("Cuál", "Which")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Enviados", "Sent")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Fallaron", "Failed")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.reminders.map((r) => (
                  <tr key={r.kind} className="border-t border-slate-100 tabular-nums">
                    <td className="px-3 py-2">{text.reminder[r.kind]}</td>
                    <td className="px-3 py-2 text-right">{r.sent}</td>
                    <td className={`px-3 py-2 text-right ${r.failed > 0 ? "font-semibold text-red-700" : ""}`}>{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
            {t("WhatsApp (plantilla aprobada fuera de las 24 horas) o correo; nunca SMS, nunca de 9 p. m. a 8 a. m. de Texas, nunca a quien pidió BAJA. «Falló» suele ser una plantilla todavía sin aprobar en Meta.", "WhatsApp (an approved template outside the 24 hours) or email; never SMS, never 9 p.m. to 8 a.m. Texas time, never to anyone who replied STOP. “Failed” is usually a template Meta has not approved yet.")}
          </p>
        </section>
      )}

      {manage && detail.phase !== "draft" && (
        <section className="card mt-4 px-5 py-4" aria-labelledby="attendance-title" data-testid="attendance-import">
          <h2 id="attendance-title" className="console-label">{t("Asistencia de Zoom", "Zoom attendance")}</h2>
          <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
            {t("En Zoom: Reportes → Uso → este webinar → Reporte de asistentes → CSV. Se compara con los registrados por correo y luego por teléfono; ves cuántos coinciden antes de guardar.", "In Zoom: Reports → Usage → this webinar → Attendee report → CSV. It is matched to the registrants by email, then by phone; you see how many match before saving.")}
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            className="mt-2 block w-full text-[14px] file:mr-3 file:h-11 file:rounded-[10px] file:border file:border-slate-300 file:bg-white file:px-4 file:font-semibold file:text-blue-900"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const body = await file.text();
              setCsv(body);
              const out = await data.attendance(w.id, body, false);
              if (out.ok) setPreview(out.body as { attendees: number; matched: number; unmatched: number });
              else setNote({ text: out.message[locale], tone: "error" });
            }}
            data-testid="attendance-file"
          />
          {preview && csv && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px]" data-testid="attendance-preview">
              <span>{t(`${preview.attendees} en el archivo · ${preview.matched} coinciden con registrados · ${preview.unmatched} sin registro`, `${preview.attendees} in the file · ${preview.matched} match registrants · ${preview.unmatched} not registered`)}</span>
              <button
                type="button"
                className={GOLD_ROW_BUTTON}
                onClick={async () => {
                  const out = await data.attendance(w.id, csv, true);
                  setPreview(null);
                  setCsv(null);
                  setNote(out.ok ? { text: t(`Asistencia guardada: ${String(out.body.matched)} registrados.`, `Attendance saved: ${String(out.body.matched)} registrants.`), tone: "ok" } : { text: out.message[locale], tone: "error" });
                  await load();
                }}
                data-testid="attendance-apply"
              >
                {t("Guardar la asistencia", "Save the attendance")}
              </button>
            </div>
          )}
          <p className="mt-2 text-[12.5px] text-slate-500">{t("Facebook, YouTube, Instagram y TikTok no dan lista de quién vio: ahí cuentan los mensajes con la palabra clave.", "Facebook, YouTube, Instagram and TikTok give no list of viewers: there, the keyword messages are what counts.")}</p>
        </section>
      )}

      <section className="mt-4" aria-labelledby="registrants-title">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 id="registrants-title" className="console-label">{t(`Registrados (${detail.registrants.length})`, `Registrants (${detail.registrants.length})`)}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filtro", "Filter")}>
            {(["all", "attended", "absent", "out"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} className={pillTab(filter === f)} onClick={() => setFilter(f)}>
                {f === "all" ? t("Todos", "All") : f === "attended" ? text.counters.attended : f === "absent" ? t("No asistieron", "Didn't attend") : t("Fuera de Texas", "Out of state")}
              </button>
            ))}
          </div>
        </div>
        <SafeBoundary>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2" data-testid="registrants">
            {shown.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{r.name}</p>
                  {detail.contact && <p className="text-[13px] tabular-nums text-slate-600 [overflow-wrap:anywhere]">{[r.phone, r.email].filter(Boolean).join(" · ")}</p>}
                  <p className="text-[12.5px] text-slate-500">
                    {r.state} · {r.locale === "es" ? "ES" : "EN"} · {text.goal[r.goal]} · {text.timeline[r.timeline]}
                  </p>
                  {r.question && <p className="mt-1 text-[13px] italic text-slate-700 [overflow-wrap:anywhere]">“{r.question}”</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.served === "out_of_state" && <Chip tone="bg-slate-100 text-slate-700">{text.served.out_of_state}</Chip>}
                    {!r.remindersConsent && <Chip tone="bg-slate-100 text-slate-600">{t("Sin recordatorios", "No reminders")}</Chip>}
                    {r.optedOut && <Chip tone="bg-slate-100 text-slate-600">{t("Pidió BAJA", "Opted out")}</Chip>}
                    {r.fromAd && <Chip tone="bg-blue-50 text-blue-900">{t("Llegó por anuncio", "Came from an ad")}</Chip>}
                    {r.attended && <Chip tone="bg-emerald-50 text-emerald-800">{r.attendedMinutes !== null ? t(`Asistió · ${r.attendedMinutes} min`, `Attended · ${r.attendedMinutes} min`) : t("Asistió", "Attended")}</Chip>}
                  </div>
                </div>
                {manage && detail.phase !== "draft" && detail.phase !== "upcoming" && (
                  <button type="button" className={ROW_BUTTON} onClick={() => void act(data.markAttended(w.id, r.id, !r.attended), r.attended ? t("Marcado: no asistió.", "Marked: did not attend.") : t("Marcado: asistió.", "Marked: attended."))}>
                    {r.attended ? t("Quitar asistencia", "Unmark") : t("Marcar asistió", "Mark attended")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </SafeBoundary>
      </section>
    </main>
  );
}
