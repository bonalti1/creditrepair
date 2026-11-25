"use client";

import { useState } from "react";
import { CONTENT_TIME_ZONE, dayIn, zonedInstant, zonedLabel } from "@/lib/content/calendar";
import { CHANNEL_LABEL } from "@/lib/content/labels";
import { GATE_TEXT, pieceGates, publishGates, type PublishSettings } from "@/lib/content/publish/gates";
import { PROVIDER_OF, type ConnectionView } from "@/lib/content/publish/types";
import type { ActResult, ScheduleView } from "@/lib/content/store";
import { approvalHolds } from "@/lib/content/hash";
import { isPublishChannel, languagesOf, trackedLink, type Channel, type ContentPiece, type PublishChannel } from "@/lib/content/types";
import { can, deniedReason } from "@/lib/staff/permissions";
import type { StaffRole } from "@/lib/staff/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { DeniedNote, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, Notice } from "./ui";

// Posting: a person posts it and records the link and date, or, once the owner
// has connected the account and turned publishing on, the app posts it at the
// time set (Central time), under every gate (src/lib/content/publish). Either
// way only an approved piece, as approved, goes out. The tracked links carry
// the piece's code so leads can be traced to it.

const SCHEDULE_STATUS: Record<ScheduleView["status"], [string, string]> = {
  scheduled: ["Programada", "Scheduled"],
  retry: ["Se reintentará", "Will retry"],
  publishing: ["Publicando", "Publishing"],
  posted: ["Publicada", "Posted"],
  failed: ["Falló", "Failed"],
  cancelled: ["Cancelada", "Cancelled"],
};

export function PiecePosting({
  piece,
  schedules,
  settings,
  connections,
  role,
  act,
  schedule,
  cancelSchedule,
}: {
  piece: ContentPiece;
  schedules: ScheduleView[];
  settings: PublishSettings;
  connections: ConnectionView[] | null;
  role: StaffRole | null;
  act: (a: { action: "record_post"; id: string; channel: Channel; url: string; postedAt?: string }) => Promise<ActResult>;
  schedule: (input: { id: string; channel: PublishChannel; at: string; lang: "en" | "es" }) => Promise<ActResult>;
  cancelSchedule: (id: string) => Promise<ActResult>;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const editable = can(role, "content.edit");
  const approved = approvalHolds(piece) && ["approved", "scheduled", "posted", "measured", "failed"].includes(piece.status);
  const langs = languagesOf(piece.language);
  const [channel, setChannel] = useState<Channel>(piece.channels[0] ?? "instagram");
  const [url, setUrl] = useState("");
  const [postedOn, setPostedOn] = useState(dayIn(new Date().toISOString()));
  const publishable = piece.channels.filter(isPublishChannel);
  const [pubChannel, setPubChannel] = useState<PublishChannel | "">(publishable[0] ?? "");
  const [day, setDay] = useState(dayIn(new Date(Date.now() + 86_400_000).toISOString()));
  const [time, setTime] = useState("18:30");
  const [lang, setLang] = useState<"en" | "es">(langs[0]!);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const done = (r: ActResult, ok: string) => setMessage(r.ok ? { text: ok, tone: "info" } : { text: r.message[locale], tone: "error" });

  const mine = schedules.filter((s) => s.pieceId === piece.id).sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));
  const connectionFor = (c: PublishChannel) => connections?.find((x) => x.provider === PROVIDER_OF[c]) ?? null;
  // The reasons the app would hold this post today (shown before scheduling, so nobody is surprised).
  const holds = pubChannel ? publishGates({ piece, channel: pubChannel, settings, connection: connectionFor(pubChannel) ?? { provider: PROVIDER_OF[pubChannel], configured: false, connected: false, status: "not_configured", account: null, scopes: [], missingScopes: [], expiresAt: null, connectedAt: null, connectedBy: null, lastError: null }, now: new Date() }) : [];
  const pieceProblems = pubChannel ? pieceGates(piece, pubChannel) : [];
  const holding = holds.filter((g) => !pieceProblems.includes(g));

  return (
    <section aria-labelledby="posting-title" data-testid="posting">
      <SectionTitle>
        <span id="posting-title">{t("Publicación", "Posting")}</span>
      </SectionTitle>
      <div className="card space-y-4 px-4 py-4">
        {piece.failure ? <Notice message={t(`No se pudo publicar: ${piece.failure}`, `Publishing failed: ${piece.failure}`)} tone="error" /> : null}

        {piece.posts.length > 0 ? (
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Publicada en", "Posted on")}</h3>
            <ul className="mt-1 space-y-1">
              {piece.posts.map((p) => (
                <li key={`${p.channel}-${p.url}-${p.postedAt}`} className="text-[14px] text-slate-700">
                  <span className="font-medium">{CHANNEL_LABEL[locale][p.channel]}</span> · {zonedLabel(p.postedAt, locale)} · {p.via === "app" ? t("por la app", "by the app") : p.by}{" "}
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline-offset-2 hover:underline">
                      {t("ver", "open")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!approved ? (
          <p className="text-[14px] text-slate-600">{t("Se publica cuando esté aprobada. La app no publica nada sin aprobación.", "It can be posted once approved. The app posts nothing without an approval.")}</p>
        ) : !editable ? (
          <DeniedNote>{deniedReason("content.edit", locale)}</DeniedNote>
        ) : (
          <>
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act({ action: "record_post", id: piece.id, channel, url, postedAt: zonedInstant(postedOn, "12:00") ?? undefined });
                done(r, t("Publicación registrada.", "Post recorded."));
                if (r.ok) setUrl("");
              }}
            >
              <h3 className="text-[14px] font-semibold text-slate-900">{t("La publicó una persona", "A person posted it")}</h3>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
                <label>
                  <span className="sr-only">{t("Canal", "Channel")}</span>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={`${FIELD} h-11`}>
                    {piece.channels.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[locale][c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">{t("Enlace de la publicación", "Link to the post")}</span>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("https://… enlace de la publicación", "https://… link to the post")} inputMode="url" className={`${FIELD} h-11`} />
                </label>
                <label>
                  <span className="sr-only">{t("Fecha", "Date")}</span>
                  <input type="date" value={postedOn} onChange={(e) => setPostedOn(e.target.value)} className={`${FIELD} h-11`} />
                </label>
              </div>
              <button type="submit" disabled={!url.trim()} className={SECONDARY_BUTTON_COMPACT}>
                {t("Registrar publicación", "Record the post")}
              </button>
            </form>

            {publishable.length > 0 ? (
              <form
                className="space-y-2 border-t hairline pt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const at = zonedInstant(day, time);
                  if (!pubChannel || !at) return;
                  done(await schedule({ id: piece.id, channel: pubChannel, at, lang }), t("Programada.", "Scheduled."));
                }}
              >
                <h3 className="text-[14px] font-semibold text-slate-900">{t("Que la publique la app", "Let the app post it")}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label>
                    <span className="sr-only">{t("Canal", "Channel")}</span>
                    <select value={pubChannel} onChange={(e) => setPubChannel(e.target.value as PublishChannel)} className={`${FIELD} h-11`}>
                      {publishable.map((c) => (
                        <option key={c} value={c}>
                          {CHANNEL_LABEL[locale][c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">{t("Día", "Day")}</span>
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={`${FIELD} h-11`} />
                  </label>
                  <label>
                    <span className="sr-only">{t("Hora (central)", "Time (Central)")}</span>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${FIELD} h-11`} />
                  </label>
                  {langs.length > 1 ? (
                    <label>
                      <span className="sr-only">{t("Idioma del texto", "Language of the caption")}</span>
                      <select value={lang} onChange={(e) => setLang(e.target.value === "es" ? "es" : "en")} className={`${FIELD} h-11`}>
                        <option value="en">{t("Texto en inglés", "English caption")}</option>
                        <option value="es">{t("Texto en español", "Spanish caption")}</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                <p className="text-[12.5px] text-slate-500">{t(`Hora central (${CONTENT_TIME_ZONE}).`, `Central time (${CONTENT_TIME_ZONE}).`)}</p>
                {pieceProblems.length > 0 ? (
                  <ul className="space-y-1">
                    {pieceProblems.map((g) => (
                      <li key={g} className="text-[13.5px] text-red-700">
                        {GATE_TEXT[g][locale]}
                      </li>
                    ))}
                  </ul>
                ) : holding.length > 0 ? (
                  <div className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900">
                    <p className="font-semibold">{t("Se puede programar, pero hoy la app la retendría:", "It can be scheduled, but today the app would hold it:")}</p>
                    <ul className="mt-0.5 list-disc pl-5">
                      {holding.map((g) => (
                        <li key={g}>{GATE_TEXT[g][locale]}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <button type="submit" disabled={!pubChannel || pieceProblems.length > 0} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="schedule">
                  {t("Programar", "Schedule")}
                </button>
              </form>
            ) : null}
          </>
        )}

        {mine.length > 0 ? (
          <div className="border-t hairline pt-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Programación", "Schedule")}</h3>
            <ul className="mt-1 divide-y divide-slate-100">
              {mine.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="schedule-row">
                  <div className="min-w-0 text-[14px] text-slate-700">
                    <span className="font-medium text-slate-900">{CHANNEL_LABEL[locale][s.channel]}</span> · {zonedLabel(s.scheduledAt, locale)} · {s.lang.toUpperCase()} ·{" "}
                    <span className={s.status === "failed" ? "font-semibold text-red-700" : s.status === "posted" ? "font-semibold text-blue-700" : ""}>{t(...SCHEDULE_STATUS[s.status])}</span>
                    {s.lastError && s.status !== "posted" ? <p className="text-[12.5px] text-slate-500">{s.lastError}</p> : null}
                    {s.note ? <p className="text-[12.5px] text-slate-500">{s.note}</p> : null}
                  </div>
                  {editable && ["scheduled", "retry"].includes(s.status) ? (
                    <button type="button" onClick={() => void cancelSchedule(s.id).then((r) => done(r, t("Cancelada.", "Cancelled.")))} className={QUIET_BUTTON}>
                      {t("Cancelar", "Cancel")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {piece.links.length > 0 ? (
          <div className="border-t hairline pt-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Enlaces con seguimiento", "Tracked links")}</h3>
            <p className="text-[12.5px] text-slate-500">{t(`Llevan el código ${piece.campaignCode}: así se ve qué prospectos llegaron por esta pieza.`, `They carry the code ${piece.campaignCode}, so leads can be traced to this piece.`)}</p>
            <ul className="mt-1 space-y-1">
              {piece.channels.map((c) => (
                <li key={c} className="break-all text-[12.5px] text-slate-700">
                  <span className="font-medium">{CHANNEL_LABEL[locale][c]}:</span> {trackedLink(piece.links[0]!, piece, c)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {message ? <Notice message={message.text} tone={message.tone} /> : null}
      </div>
    </section>
  );
}
