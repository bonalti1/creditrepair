"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AUDIENCE_LABEL, CHANNEL_LABEL, LANGUAGE_LABEL, THEME_LABEL, TYPE_LABEL } from "@/lib/content/labels";
import { useContent } from "@/lib/content/store";
import { CONTENT_TEMPLATES, templateById } from "@/lib/content/templates";
import { AUDIENCES, CHANNELS, CONTENT_TYPES, LANGUAGES, THEMES, type Audience, type Channel, type ContentLanguage, type ContentType, type Theme } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { PRIMARY_BUTTON, QUIET_BUTTON } from "@/components/staff/ui";
import { ContentGate, ContentHeader, FIELD, LABEL, Notice } from "@/components/staff/content/ui";

// A new piece: what it is, where it goes, in which language, for whom, and
// where its words start (blank, a pre-checked template, or Alti's draft on
// the next screen). It starts as an Idea; nothing is published from here.

export default function NewPiecePage() {
  const t = useTx();
  return (
    <ContentGate needs="content.edit" title={t("Nueva pieza", "New piece")}>
      <Suspense fallback={<div className="h-40" aria-busy="true" />}>
        <NewPiece />
      </Suspense>
    </ContentGate>
  );
}

function NewPiece() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const params = useSearchParams();
  const content = useContent();
  const initial = templateById(params.get("plantilla"));
  const [title, setTitle] = useState(initial ? initial.title[locale] : "");
  const [type, setType] = useState<ContentType>(initial?.type ?? "short_video");
  const [channels, setChannels] = useState<Channel[]>(initial?.channels ?? ["instagram", "tiktok"]);
  const [language, setLanguage] = useState<ContentLanguage>("both");
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? "consumers");
  const [theme, setTheme] = useState<Theme>(initial?.theme ?? "myths");
  const [goal, setGoal] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [start, setStart] = useState<string>(initial ? initial.id : "blank");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = useMemo(() => templateById(start), [start]);

  const pickTemplate = (id: string) => {
    setStart(id);
    const chosen = templateById(id);
    if (!chosen) return;
    setType(chosen.type);
    setChannels(chosen.channels);
    setAudience(chosen.audience);
    setTheme(chosen.theme);
    if (!title.trim()) setTitle(chosen.title[locale]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) return setError(t("Escribe un título.", "Write a title."));
    setSaving(true);
    const result = await content.act({
      action: "create",
      title: title.trim(),
      type,
      channels,
      language,
      audience,
      theme,
      goal,
      dueDate: dueDate || null,
      templateId: template?.id ?? null,
      copy: template ? template.copy : undefined,
      characters: template?.characters,
    });
    setSaving(false);
    if (!result.ok) return setError(result.message[locale]);
    router.push(`/equipo/contenido/pieza/${result.piece!.id}${start === "alti" ? "?alti=1" : ""}`);
  };

  const toggle = (c: Channel) => setChannels((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));

  return (
    <main className="animate-rise">
      <ContentHeader title={t("Nueva pieza", "New piece")} lead={t("Empieza como idea. Las revisiones corren con cada cambio.", "It starts as an idea. The checks run on every change.")} />
      <form onSubmit={submit} className="card mt-5 max-w-3xl space-y-5 px-5 py-5" noValidate>
        <label className={LABEL}>
          {t("Título (solo para el equipo)", "Title (for the team only)")}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={`${FIELD} mt-1 h-11`} />
        </label>

        <fieldset>
          <legend className={LABEL}>{t("¿De dónde salen las palabras?", "Where do the words start?")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              { id: "blank", label: t("En blanco", "Blank"), help: t("Lo escribes tú.", "You write it.") },
              { id: "alti", label: t("Con Alti (IA)", "With Alti (AI)"), help: t("Un borrador en inglés y español, revisado por las reglas.", "A draft in English and Spanish, run through the rules.") },
            ].map((o) => (
              <label key={o.id} className={`flex cursor-pointer gap-3 rounded-2xl px-3.5 py-3 ring-1 ${start === o.id ? "bg-blue-50 ring-blue-300" : "ring-slate-200"}`}>
                <input type="radio" name="start" value={o.id} checked={start === o.id} onChange={() => setStart(o.id)} className="mt-1 h-4 w-4 accent-blue-700" />
                <span>
                  <span className="block text-[15px] font-semibold text-slate-900">{o.label}</span>
                  <span className="block text-[13px] text-slate-500">{o.help}</span>
                </span>
              </label>
            ))}
          </div>
          <label className={`${LABEL} mt-3`}>
            {t("O una plantilla ya revisada", "Or a pre-checked template")}
            <select value={template ? template.id : ""} onChange={(e) => (e.target.value ? pickTemplate(e.target.value) : setStart("blank"))} className={`${FIELD} mt-1 h-11`}>
              <option value="">{t("Ninguna", "None")}</option>
              {CONTENT_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.title[locale]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL}>
            {t("Tipo", "Type")}
            <select value={type} onChange={(e) => setType(e.target.value as ContentType)} className={`${FIELD} mt-1 h-11`}>
              {CONTENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {TYPE_LABEL[locale][x]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            {t("Idioma", "Language")}
            <select value={language} onChange={(e) => setLanguage(e.target.value as ContentLanguage)} className={`${FIELD} mt-1 h-11`}>
              {LANGUAGES.map((x) => (
                <option key={x} value={x}>
                  {LANGUAGE_LABEL[locale][x]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            {t("Público", "Audience")}
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={`${FIELD} mt-1 h-11`}>
              {AUDIENCES.map((x) => (
                <option key={x} value={x}>
                  {AUDIENCE_LABEL[locale][x]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            {t("Tema", "Theme")}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} className={`${FIELD} mt-1 h-11`}>
              {THEMES.map((x) => (
                <option key={x} value={x}>
                  {THEME_LABEL[locale][x]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            {t("Fecha de entrega", "Due date")}
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${FIELD} mt-1 h-11`} />
          </label>
          <label className={LABEL}>
            {t("Objetivo, en una línea", "Goal, in a line")}
            <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} className={`${FIELD} mt-1 h-11`} />
          </label>
        </div>

        <fieldset>
          <legend className={LABEL}>{t("Canales", "Channels")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <label key={c} className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-3.5 text-[14px] ring-1 ${channels.includes(c) ? "bg-blue-50 text-blue-900 ring-blue-300" : "text-slate-700 ring-slate-200"}`}>
                <input type="checkbox" checked={channels.includes(c)} onChange={() => toggle(c)} className="h-4 w-4 accent-blue-700" />
                {CHANNEL_LABEL[locale][c]}
              </label>
            ))}
          </div>
        </fieldset>

        <Notice message={error} tone="error" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
            {saving ? t("Guardando…", "Saving…") : t("Crear la pieza", "Create the piece")}
          </button>
          <button type="button" onClick={() => router.push("/equipo/contenido")} className={QUIET_BUTTON}>
            {t("Cancelar", "Cancel")}
          </button>
        </div>
      </form>
    </main>
  );
}
