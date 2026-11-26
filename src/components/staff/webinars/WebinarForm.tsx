"use client";

import { useState } from "react";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { webinarCopyProblems } from "@/lib/webinars/check";
import type { WebinarInputForm, WebinarsData } from "@/lib/webinars/data";
import { PLATFORM_NAMES } from "@/lib/webinars/publicCopy";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { isoToTexas } from "@/lib/webinars/time";
import { PLATFORMS, WEBINAR_LANGUAGES, type Webinar, type WebinarPlatform } from "@/lib/webinars/types";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import { FIELD, Labeled } from "./bits";

// Create or change a webinar: titles in both languages (checked as they are
// typed, like every word a prospect reads), the host, the day and time on
// Texas's clock, the platforms' links, the language, topic, campaign tag and
// keyword (CREDIT by default), and the replay link once there is one.

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function initial(w: Webinar | null): WebinarInputForm {
  if (!w) return { id: null, slug: "", titleEn: "", titleEs: "", host: "", day: "", time: "19:00", durationMinutes: 45, language: "es", topic: "", campaignTag: null, keyword: "CREDIT", links: {}, replayUrl: null, campaignId: null };
  const { day, time } = isoToTexas(w.startsAt);
  return { id: w.id, slug: w.slug, titleEn: w.title.en, titleEs: w.title.es, host: w.host, day, time, durationMinutes: w.durationMinutes, language: w.language, topic: w.topic, campaignTag: w.campaignTag, keyword: w.keyword, links: { ...w.links }, replayUrl: w.replayUrl, campaignId: w.campaignId };
}

export default function WebinarForm({ data, webinar, campaigns, onSaved, onCancel }: { data: WebinarsData; webinar: Webinar | null; campaigns: Array<{ id: string; name: string }>; onSaved: (w: Webinar) => void; onCancel: () => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(WEBINARS_TEXT);
  const [form, setForm] = useState<WebinarInputForm>(() => initial(webinar));
  const [slugTouched, setSlugTouched] = useState(Boolean(webinar));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = webinar !== null && webinar.status !== "draft";
  const set = (patch: Partial<WebinarInputForm>) => setForm((f) => ({ ...f, ...patch }));
  const problems = [...new Set([form.titleEn, form.titleEs, form.topic].flatMap((v) => webinarCopyProblems(v)))];
  const problemText = { promise: t("promete un resultado", "promises a result"), free: t("dice «gratis»", "says “free”"), pressure: t("mete presión", "pushes people"), score: t("habla de puntaje", "talks about scores") } as const;
  const ready = form.titleEn.trim().length >= 3 && form.titleEs.trim().length >= 3 && form.host.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(form.day) && /^[a-z0-9-]{3,60}$/.test(form.slug) && problems.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    const out = await data.saveWebinar(form);
    setSaving(false);
    if (!out.ok) {
      setError(out.message[locale]);
      return;
    }
    onSaved(out.body.webinar as Webinar);
  };

  return (
    <form onSubmit={submit} className="card space-y-4 px-5 py-5" data-testid="webinar-form" aria-labelledby="webinar-form-title">
      <h2 id="webinar-form-title" className="font-display text-[17px] font-semibold text-blue-900">
        {webinar ? t("Cambiar el webinar", "Change the webinar") : t("Nuevo webinar", "New webinar")}
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        <Labeled label={t("Título en inglés", "Title in English")}>
          <input
            className={FIELD}
            value={form.titleEn}
            maxLength={120}
            onChange={(e) => set({ titleEn: e.target.value, ...(slugTouched ? {} : { slug: slugify(form.titleEs || e.target.value) }) })}
            placeholder="Your credit report, explained"
            data-testid="title-en"
          />
        </Labeled>
        <Labeled label={t("Título en español", "Title in Spanish")}>
          <input className={FIELD} value={form.titleEs} maxLength={120} onChange={(e) => set({ titleEs: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value || form.titleEn) }) })} placeholder="Tu reporte de crédito, explicado" data-testid="title-es" />
        </Labeled>
        <Labeled label={t("Quién lo presenta", "Host")}>
          <input className={FIELD} value={form.host} maxLength={80} onChange={(e) => set({ host: e.target.value })} data-testid="host" />
        </Labeled>
        <Labeled label={t("Enlace de registro", "Registration link")} hint={locked ? t("Un webinar publicado conserva su enlace.", "A published webinar keeps its link.") : `/webinar/${form.slug || "…"}`}>
          <input
            className={FIELD}
            value={form.slug}
            disabled={locked}
            maxLength={60}
            onChange={(e) => {
              setSlugTouched(true);
              set({ slug: slugify(e.target.value) });
            }}
            data-testid="slug"
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t("Día (hora de Texas)", "Day (Texas time)")}>
            <input type="date" className={FIELD} value={form.day} onChange={(e) => set({ day: e.target.value })} data-testid="day" />
          </Labeled>
          <Labeled label={t("Hora (Texas)", "Time (Texas)")}>
            <input type="time" className={FIELD} value={form.time} onChange={(e) => set({ time: e.target.value })} data-testid="time" />
          </Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t("Minutos", "Minutes")}>
            <input type="number" min={15} max={180} className={FIELD} value={form.durationMinutes} onChange={(e) => set({ durationMinutes: Math.max(15, Math.min(180, Number(e.target.value) || 45)) })} />
          </Labeled>
          <Labeled label={t("Idioma", "Language")}>
            <select className={FIELD} value={form.language} onChange={(e) => set({ language: e.target.value as WebinarInputForm["language"] })}>
              {WEBINAR_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {text.language[l]}
                </option>
              ))}
            </select>
          </Labeled>
        </div>
        <Labeled label={t("Tema (público)", "Topic (public)")} className="md:col-span-2">
          <input className={FIELD} value={form.topic} maxLength={300} onChange={(e) => set({ topic: e.target.value })} />
        </Labeled>
        <Labeled label={t("Palabra clave", "Keyword")} hint={t("Lo que la gente escribe en el chat o por WhatsApp.", "What people type in the chat or on WhatsApp.")}>
          <input className={FIELD} value={form.keyword} maxLength={20} onChange={(e) => set({ keyword: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} data-testid="keyword" />
        </Labeled>
        <Labeled label={t("Etiqueta de campaña", "Campaign tag")} hint={t("Marca a los prospectos que trae («webinar-test-1»).", "Marks the leads it brings (“webinar-test-1”).")}>
          <input className={FIELD} value={form.campaignTag ?? ""} maxLength={40} onChange={(e) => set({ campaignTag: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") || null })} />
        </Labeled>
        {campaigns.length > 0 && (
          <Labeled label={t("Campaña", "Campaign")}>
            <select className={FIELD} value={form.campaignId ?? ""} onChange={(e) => set({ campaignId: e.target.value || null })}>
              <option value="">{t("Ninguna", "None")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Labeled>
        )}
      </div>
      <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        <legend className="mb-1 text-[13px] font-semibold text-slate-700">{t("Dónde se transmite (enlaces https)", "Where it streams (https links)")}</legend>
        {PLATFORMS.map((p: WebinarPlatform) => (
          <Labeled key={p} label={PLATFORM_NAMES[p]}>
            <input className={FIELD} inputMode="url" value={form.links[p] ?? ""} onChange={(e) => set({ links: { ...form.links, [p]: e.target.value.trim() || null } })} placeholder="https://" data-testid={`link-${p}`} />
          </Labeled>
        ))}
        <Labeled label={t("Repetición (después)", "Replay (afterwards)")} hint={t("Con este enlace sale el mensaje de la repetición.", "With this link, the replay message goes out.")}>
          <input className={FIELD} inputMode="url" value={form.replayUrl ?? ""} onChange={(e) => set({ replayUrl: e.target.value.trim() || null })} placeholder="https://" data-testid="replay-url" />
        </Labeled>
      </fieldset>
      {problems.length > 0 && (
        <p className="rounded-[10px] bg-red-50 px-3 py-2 text-[13.5px] text-red-800" role="alert" data-testid="copy-problems">
          {t("El texto público", "The public words")} {problems.map((p) => problemText[p]).join(", ")}. {t("Cámbialo antes de guardar: «Clase en vivo · 45 minutos · Regístrate», nunca «gratis».", "Change it before saving: “Live class · 45 minutes · Register”, never “free”.")}
        </p>
      )}
      {error && (
        <p className="rounded-[10px] bg-red-50 px-3 py-2 text-[13.5px] text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!ready || saving} className={PRIMARY_BUTTON} data-testid="save-webinar">
          {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </form>
  );
}
