"use client";

import { useEffect, useState } from "react";
import { playUrl, sendOptions, sendVideo, type SendChannel, type SendOptions } from "@/lib/live/data";
import { clock, type ReviewItem, type ReviewVideo } from "@/lib/live/review";
import { videoEmailSubject, videoMessage } from "@/lib/live/templates";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { GOLD_ROW_BUTTON, QUIET_BUTTON, ROW_BUTTON } from "@/components/staff/ui";

// A recorded video on a review: watch it, send its private link (WhatsApp
// with one tap; SMS only when the owner turned it on and the person allowed
// it; email from the member's own mail app; or copy), and what happened to it:
// sent, opened, watched, «Get started». Every send makes a new link; the
// earlier one stops working.

export default function VideoPanel({ review, video, teammate, onChanged, onDelete }: { review: ReviewItem; video: ReviewVideo; teammate: string; onChanged: () => void; onDelete: () => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [src, setSrc] = useState<string | null>(null);
  const [options, setOptions] = useState<SendOptions | null>(null);
  const [busy, setBusy] = useState<SendChannel | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void sendOptions(video.id).then((answer) => live && setOptions(answer?.options ?? null));
    return () => {
      live = false;
    };
  }, [video.id]);

  const WHY: Record<string, string> = {
    opted_out: t("Pidió que no le escribamos (BAJA/STOP).", "They asked us to stop writing (STOP)."),
    window_closed: t("Pasaron más de 24 horas desde su último mensaje y la plantilla del video no está aprobada en Meta todavía. Mándalo por correo o copia el enlace.", "It's been over 24 hours since their last message and the video template isn't approved in Meta yet. Send it by email or copy the link."),
    sms_off: t("Los mensajes de texto están apagados.", "Text messages are off."),
    sms_no_consent: t("No aceptó recibir mensajes de texto.", "They didn't agree to text messages."),
    quiet_hours: t("Es hora de silencio en su zona (9 p. m. a 8 a. m.). Inténtalo más tarde.", "It's quiet hours where they live (9 p.m. to 8 a.m.). Try later."),
    no_email: t("No dejó un correo.", "They didn't leave an email."),
    offline: t("No pudimos conectar. Intenta de nuevo.", "We couldn't connect. Try again."),
  };

  const send = async (channel: SendChannel) => {
    setBusy(channel);
    setNote(null);
    const result = await sendVideo(review.id, video.id, channel, (link) => videoMessage(review.locale, { firstName: review.firstName, teammate, link }));
    setBusy(null);
    if (!result.ok) {
      setNote({ tone: "error", text: WHY[result.code] ?? t("No se pudo mandar. Nada cambió.", "It couldn't be sent. Nothing changed.") });
      return;
    }
    if (channel === "email") {
      window.location.href = `mailto:${encodeURIComponent(result.email ?? "")}?subject=${encodeURIComponent(videoEmailSubject(review.locale))}&body=${encodeURIComponent(result.message)}`;
      setNote({ tone: "ok", text: t("Se abrió tu correo con el mensaje listo. Envíalo desde ahí.", "Your email app opened with the message ready. Send it from there.") });
    } else if (channel === "copy") {
      try {
        await navigator.clipboard.writeText(result.message);
        setCopied(result.message);
        setNote({ tone: "ok", text: t("Mensaje con el enlace copiado.", "Message with the link copied.") });
      } catch {
        setCopied(result.message);
      }
    } else {
      setNote({ tone: "ok", text: result.sent ? t("Enviado.", "Sent.") : t("Guardado (demo o sin conexión a WhatsApp: no salió nada).", "Recorded (demo or WhatsApp not connected: nothing went out).") });
    }
    onChanged();
  };

  const facts: Array<[string, string | null]> = [
    [t("Enviado", "Sent"), video.sentAt],
    [t("Lo abrió", "Opened"), video.openedAt],
    [t("Lo vio", "Watched"), video.watchedAt],
    [t("Tocó «Empezar»", "Tapped “Get started”"), video.startedAt],
  ];
  const wa = options?.whatsapp;
  return (
    <div className="rounded-[12px] border hairline px-3.5 py-3" data-testid="video-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-slate-900">
          {t("Video", "Video")} · <span className="tabular-nums">{clock(video.durationSeconds)}</span>
          <span className="font-normal text-slate-500">
            {" "}
            · {video.recordedBy ?? t("el equipo", "the team")} · {shortDateTime(video.createdAt, locale)}
          </span>
        </p>
        <div className="flex gap-1">
          <button type="button" className={QUIET_BUTTON} onClick={async () => setSrc(src ? null : await playUrl(video))} aria-expanded={Boolean(src)}>
            <Icon name="play" size={16} />
            {src ? t("Ocultar", "Hide") : t("Ver", "Watch")}
          </button>
          <button type="button" className={QUIET_BUTTON} onClick={onDelete} data-testid="video-delete">
            {t("Borrar", "Delete")}
          </button>
        </div>
      </div>
      {src && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={src} controls playsInline className="mt-2 aspect-video w-full max-w-xl rounded-[10px] bg-blue-900" />
      )}
      <ul className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
        {facts.map(([label, at]) => (
          <li key={label} className={`rounded-full px-2.5 py-1 font-semibold ${at ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
            {at ? "✓ " : ""}
            {label}
            {at ? ` · ${shortDateTime(at, locale)}` : ""}
          </li>
        ))}
      </ul>
      {video.sentAt && <p className="mt-1 text-[12px] text-slate-500">{t(`El enlace vence: ${shortDateTime(video.expiresAt, locale)}. Mandarlo otra vez crea un enlace nuevo.`, `The link expires ${shortDateTime(video.expiresAt, locale)}. Sending again makes a new link.`)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={GOLD_ROW_BUTTON} disabled={busy !== null || !wa || wa === "opted_out" || wa === "window_closed"} onClick={() => send("whatsapp")} data-testid="send-whatsapp">
          {busy === "whatsapp" ? t("Enviando…", "Sending…") : video.sentAt ? t("Mandar otra vez por WhatsApp", "Send again on WhatsApp") : t("Mandar por WhatsApp", "Send on WhatsApp")}
        </button>
        <button type="button" className={ROW_BUTTON} disabled={busy !== null || !options?.email} onClick={() => send("email")} data-testid="send-email">
          {t("Por correo", "By email")}
        </button>
        {options?.sms !== "off" && options && (
          <button type="button" className={ROW_BUTTON} disabled={busy !== null || options.sms !== "ready"} onClick={() => send("sms")} data-testid="send-sms">
            {t("Por mensaje de texto", "By text message")}
          </button>
        )}
        <button type="button" className={ROW_BUTTON} disabled={busy !== null} onClick={() => send("copy")} data-testid="send-copy">
          {t("Copiar el mensaje", "Copy the message")}
        </button>
      </div>
      {options && wa && WHY[wa] && <p className="mt-2 text-[12.5px] leading-snug text-slate-600">{WHY[wa]}</p>}
      {options && options.sms !== "off" && options.sms !== "ready" && WHY[options.sms] && <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{WHY[options.sms]}</p>}
      {wa === "template" && <p className="mt-2 text-[12.5px] leading-snug text-slate-600">{t("Pasaron más de 24 horas: sale como la plantilla aprobada.", "Over 24 hours: it goes as the approved template.")}</p>}
      {note && (
        <p className={`mt-2 text-[13px] font-medium ${note.tone === "ok" ? "text-green-700" : "text-red-700"}`} role={note.tone === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {copied && (
        <textarea readOnly value={copied} rows={4} className="mt-2 w-full rounded-[10px] border border-slate-300 bg-slate-50 p-2 text-[13px]" aria-label={t("Mensaje para copiar", "Message to copy")} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
