"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchQueue, LIVE_CHANGED_EVENT, resetDemoLive, reviewAction, uploadVideo, type ReviewQueue } from "@/lib/live/data";
import { reviewNeedsYou, type ReviewItem } from "@/lib/live/review";
import { FUNNEL_STAGE_LABELS, funnelLine } from "@/lib/live/stages";
import { shortDay, shortDateTime } from "@/lib/staff/format";
import { LANGUAGE_NAME } from "@/lib/staff/i18n/locale";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import Recorder from "@/components/staff/live/Recorder";
import ReviewOverview from "@/components/staff/live/ReviewOverview";
import VideoPanel from "@/components/staff/live/VideoPanel";
import { BACK_LINK, DemoNote, EmptyState, NoAccess, pillTab, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON } from "@/components/staff/ui";

// Report reviews (/equipo/revisiones, docs/LIVE-FUNNEL.md): the reports that
// leads from a webinar or an ad uploaded on /live, each with the overview for
// the team, the recorder for their short personal video, and the private
// link to send it. reviews.video: administrators and specialists (sales sees
// the funnel's stage in the Lead Manager, never the report). Nothing here
// decides anything for the person: they choose whether to sign up.

type Filter = "needs" | "sent" | "all";

export default function ReviewsPage() {
  const { ready, can, viewer } = useStaff();
  const { locale } = useStaffLocale();
  const t = useTx();
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("needs");
  const [selected, setSelected] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const mayReview = ready && can("reviews.video");

  const load = useCallback(async () => {
    try {
      const q = await fetchQueue();
      setQueue(q);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (mayReview) void load();
  }, [mayReview, load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("revision");
    if (id) setSelected(id);
  }, []);
  const changed = useCallback(async () => {
    await load();
    window.dispatchEvent(new Event(LIVE_CHANGED_EVENT));
  }, [load]);

  const items = useMemo(() => queue?.items ?? [], [queue]);
  const shown = useMemo(() => {
    if (filter === "needs") return items.filter((i) => reviewNeedsYou(i) || i.status === "reading" || i.status === "receiving" || i.status === "failed");
    if (filter === "sent") return items.filter((i) => i.videos.some((v) => v.sentAt && !v.deleted));
    return items;
  }, [items, filter]);
  const review = items.find((i) => i.id === selected) ?? null;

  const open = (id: string | null) => {
    setSelected(id);
    setNotice(null);
    window.history.replaceState(null, "", `/equipo/revisiones${id ? `?revision=${encodeURIComponent(id)}` : ""}`);
  };

  if (!ready) return null;
  if (!can("reviews.video")) return <NoAccess title={t("Revisiones de reportes", "Report reviews")} reason={deniedReason("reviews.video", locale)} />;

  const counts: Record<Filter, number> = {
    needs: items.filter(reviewNeedsYou).length,
    sent: items.filter((i) => i.videos.some((v) => v.sentAt && !v.deleted)).length,
    all: items.length,
  };
  const label: Record<Filter, string> = { needs: t("Te necesitan", "Needs you"), sent: t("Video enviado", "Video sent"), all: t("Todas", "All") };
  const teammate = viewer?.name.split(" ")[0] ?? viewer?.handle ?? t("el equipo", "the team");

  const act = async (action: "delete_video" | "reread" | "import" | "delete_review", ids: { reviewId?: string; videoId?: string }, done: string) => {
    const result = await reviewAction(action, ids);
    setNotice(result.ok ? { tone: "ok", text: done } : { tone: "error", text: result.message ?? IMPORT_WHY[result.code ?? ""] ?? t("No funcionó. Nada cambió; intenta de nuevo.", "That didn't work. Nothing changed; try again.") });
    await changed();
  };
  const IMPORT_WHY: Record<string, string> = {
    simulated: t("Es una lectura simulada (sin clave de IA): no se guarda en el expediente. Importa el reporte a mano desde su página.", "It's a simulated reading (no AI key): it isn't saved to the case. Import the report by hand from their page."),
    not_signed: t("Todavía no firmó su acuerdo.", "They haven't signed their agreement yet."),
    import_blocked: t("Su expediente ya tiene un reporte más nuevo.", "Their case already has a newer report."),
  };

  return (
    <main className="animate-rise">
      <div className={`${review ? "hidden md:block" : ""}`}>
        <h1 className="page-title">{t("Revisiones de reportes", "Report reviews")}</h1>
        <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
          {t(
            "Los reportes que los prospectos del webinar o de un anuncio subieron en /live. Lee el resumen, graba un video corto y privado, y mándaselo. La persona decide.",
            "The reports that leads from a webinar or an ad uploaded on /live. Read the overview, record a short private video and send it. They decide.",
          )}
        </p>
        {queue?.demo && (
          <DemoNote onReset={() => { resetDemoLive(); void changed(); }}>
            {t("Prospectos, reporte y video de muestra: no son de nadie. Lo que grabes se queda en este navegador y no se envía nada.", "Sample leads, report and video: nobody's real data. What you record stays in this browser and nothing is sent.")}
          </DemoNote>
        )}
        {queue && (
          <p className="mt-3 text-[13px] text-slate-500">
            {t("Palabras clave en WhatsApp:", "WhatsApp keywords:")} <span className="font-semibold text-slate-700">{queue.keywords.map((k) => (k.campaign ? `${k.word} (${k.campaign})` : k.word)).join(", ")}</span>
            {" · "}
            {queue.sms ? t("Mensajes de texto: encendidos", "Text messages: on") : t("Mensajes de texto: apagados", "Text messages: off")}
          </p>
        )}
        <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label={t("Filtrar", "Filter")}>
          {(["needs", "sent", "all"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={pillTab(filter === f)} data-testid={`reviews-filter-${f}`}>
              {label[f]}
              <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {failed && (
        <p className="card mt-4 px-5 py-4 text-[14px] text-slate-600" role="alert">
          {t("No se pudieron leer las revisiones ahora. Intenta de nuevo en un momento.", "The reviews couldn't be read right now. Try again in a moment.")}
        </p>
      )}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className={`${review ? "hidden md:block" : ""} min-w-0`} aria-label={t("Lista de revisiones", "Review list")}>
          <ul className="card overflow-hidden" data-testid="review-list">
            {shown.length === 0 ? (
              <li>
                <EmptyState pose={items.length === 0 ? "phone" : "thumbsUp"} title={items.length === 0 ? t("Todavía no hay reportes", "No reports yet") : t("Nada te espera aquí", "Nothing waits for you here")}>
                  {items.length === 0 ? t("Aparecen en cuanto alguien sube su reporte en /live.", "They show up as soon as someone uploads their report on /live.") : null}
                </EmptyState>
              </li>
            ) : (
              shown.map((item) => <ReviewRow key={item.id} item={item} selected={item.id === selected} onOpen={() => open(item.id)} />)
            )}
          </ul>
        </section>

        <section className={`${review ? "" : "hidden md:block"} min-w-0`}>
          {review ? (
            <SafeBoundary key={review.id}>
              <div className="space-y-4" data-testid="review-detail">
                <div className="card px-4 py-4 sm:px-5">
                  <button type="button" onClick={() => open(null)} className={`${BACK_LINK} md:hidden`}>
                    <Icon name="chevron" size={16} className="rotate-180" />
                    {t("Revisiones", "Reviews")}
                  </button>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-[22px] font-semibold leading-tight text-slate-900">{review.firstName ?? t("Sin nombre todavía", "No name yet")}</h2>
                      <p className="mt-1 text-[13.5px] text-slate-600">
                        {review.state ?? "—"} · {LANGUAGE_NAME[locale][review.locale]}
                        {review.funnel ? ` · ${funnelLine(review.funnel, locale)}` : ""}
                      </p>
                    </div>
                    {review.funnel && (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-[13px] font-semibold text-blue-800" data-testid="review-stage">
                        {FUNNEL_STAGE_LABELS[locale][review.funnel.stage]}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
                    {review.signed
                      ? t("Firmó: importa el reporte a su expediente.", "Signed: import the report into their case.")
                      : t(`Si no se registra, el reporte, el resumen y el video se borran solos el ${shortDay(review.deleteAfter, "es")}.`, `If they don't sign up, the report, the overview and the video delete themselves on ${shortDay(review.deleteAfter, "en")}.`)}
                    {review.simulated && t(" Lectura simulada (sin clave de IA).", " Simulated reading (no AI key).")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {review.status === "ready" && (
                      <button type="button" className={PRIMARY_BUTTON} onClick={() => setRecording(true)} data-testid="record-video">
                        <Icon name="video" size={18} className="mr-2" />
                        {t("Grabar video", "Record video")}
                      </button>
                    )}
                    {review.status === "ready" && review.signed && !review.importedAt && can("reports.import") && (
                      <button type="button" className={ROW_BUTTON} onClick={() => act("import", { reviewId: review.id }, t("Importado como su primer reporte.", "Imported as their first report."))} data-testid="review-import">
                        {t("Importar como primer reporte", "Import as the first report")}
                      </button>
                    )}
                    {review.status === "failed" && (
                      <button type="button" className={ROW_BUTTON} onClick={() => act("reread", { reviewId: review.id }, t("Se volvió a leer.", "Read again."))}>
                        {t("Leer otra vez", "Read again")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={QUIET_BUTTON}
                      onClick={() => {
                        if (window.confirm(t("¿Borrar ahora el reporte, el resumen y el video de esta persona? No se puede deshacer.", "Delete this person's report, overview and video now? This can't be undone."))) {
                          void act("delete_review", { reviewId: review.id }, t("Borrado.", "Deleted."));
                          open(null);
                        }
                      }}
                      data-testid="review-delete"
                    >
                      {t("Borrar ahora (si lo pide)", "Delete now (if they ask)")}
                    </button>
                  </div>
                  {notice && (
                    <p className={`mt-2 text-[13px] font-medium ${notice.tone === "ok" ? "text-green-700" : "text-red-700"}`} role={notice.tone === "error" ? "alert" : "status"}>
                      {notice.text}
                    </p>
                  )}
                  {review.videos.filter((v) => !v.deleted).length > 0 && (
                    <div className="mt-3 space-y-2">
                      {review.videos
                        .filter((v) => !v.deleted)
                        .map((video) => (
                          <VideoPanel
                            key={video.id}
                            review={review}
                            video={video}
                            teammate={teammate}
                            onChanged={() => void changed()}
                            onDelete={() => {
                              if (window.confirm(t("¿Borrar este video? Su enlace deja de funcionar.", "Delete this video? Its link stops working."))) void act("delete_video", { reviewId: review.id, videoId: video.id }, t("Video borrado.", "Video deleted."));
                            }}
                          />
                        ))}
                    </div>
                  )}
                </div>

                {(review.status === "reading" || review.status === "receiving") && (
                  <div className="card flex items-center gap-3 px-5 py-5 text-[14px] text-slate-700" role="status">
                    <Icon name="clock" size={20} className="text-amber-700" />
                    {t("Alti, el asistente con IA, está leyendo el reporte. Vuelve en unos minutos.", "Alti, the AI assistant, is reading the report. Come back in a few minutes.")}
                  </div>
                )}
                {review.status === "failed" && (
                  <div className="card px-5 py-4 text-[14px] text-slate-700">
                    <p className="font-semibold text-slate-900">{t("El reporte no se pudo leer", "The report couldn't be read")}</p>
                    <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-600">
                      {review.problems.slice(0, 6).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[13px]">{t("Pídele por WhatsApp que lo mande otra vez desde su enlace, como PDF.", "Ask them on WhatsApp to send it again from their link, as a PDF.")}</p>
                  </div>
                )}
                {review.overview && <ReviewOverview overview={review.overview} plans={queue?.plans ?? []} />}
                <p className="px-1 text-[12px] text-slate-500">
                  {t("Recibido", "Received")} {shortDateTime(review.createdAt, locale)} · {review.fileCount} {t(review.fileCount === 1 ? "archivo" : "archivos", review.fileCount === 1 ? "file" : "files")}
                  {/* The conversation is the Lead Manager's (leads.work): a specialist works the review only. */}
                  {can("leads.work") && (
                    <>
                      {" · "}
                      <Link href={`/equipo/leads?lead=${encodeURIComponent(review.leadId)}`} className="underline">
                        {t("Ver la conversación", "See the conversation")}
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </SafeBoundary>
          ) : (
            <div className="card flex min-h-64 items-center justify-center">
              <EmptyState pose="thinking" title={t("Elige una revisión de la lista.", "Pick a review from the list.")}>
                {t("Cada una trae su resumen, el guion y la grabadora.", "Each one has its overview, the script and the recorder.")}
              </EmptyState>
            </div>
          )}
        </section>
      </div>

      {recording && review && (
        <Recorder
          review={review}
          plans={queue?.plans ?? []}
          onClose={() => {
            setRecording(false);
            void changed();
          }}
          onUpload={async (blob, seconds, onProgress) => {
            const result = await uploadVideo(review.id, blob, seconds, onProgress, teammate);
            return result.ok ? { ok: true } : { ok: false, code: result.code };
          }}
        />
      )}
    </main>
  );
}

function ReviewRow({ item, selected, onOpen }: { item: ReviewItem; selected: boolean; onOpen: () => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const needs = reviewNeedsYou(item);
  const status =
    item.status === "reading" || item.status === "receiving"
      ? t("Leyendo el reporte", "Reading the report")
      : item.status === "failed"
        ? t("No se pudo leer", "Couldn't be read")
        : item.signed && !item.importedAt
          ? t("Firmó: importar", "Signed: import")
          : item.videos.some((v) => v.sentAt && !v.deleted)
            ? t("Video enviado", "Video sent")
            : item.videos.some((v) => !v.deleted)
              ? t("Video listo para mandar", "Video ready to send")
              : t("Lista para su video", "Ready for their video");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`pressable flex w-full items-start gap-3 border-t hairline px-4 py-3 text-left first:border-t-0 ${selected ? "bg-blue-50 shadow-[inset_3px_0_0_var(--color-amber-400)]" : "hover:bg-slate-50"}`}
        data-testid="review-row"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-900">{item.firstName ?? t("Sin nombre todavía", "No name yet")}</span>
          <span className="block truncate text-[12.5px] font-medium text-blue-700">{item.funnel ? funnelLine(item.funnel, locale) : "—"}</span>
          <span className="mt-1 block text-[12.5px] text-slate-500">{shortDateTime(item.createdAt, locale)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${needs ? "bg-red-50 text-red-700" : item.status === "failed" ? "bg-amber-100 text-blue-900" : "bg-slate-100 text-slate-600"}`}>{status}</span>
      </button>
    </li>
  );
}
