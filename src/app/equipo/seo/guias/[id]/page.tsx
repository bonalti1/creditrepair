"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { aiByline } from "@/lib/brand";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { sourceLibrary, type DraftResult } from "@/lib/seo/draft";
import { blockingIssues, checkGuide, guideChecklist, guideHash, guidePath, isLive, publishBlockers, TICK_ORDER } from "@/lib/seo/guides";
import { useSeo } from "@/lib/seo/store";
import { SEO_TEXT } from "@/lib/seo/text";
import type { Guide, GuideBody, GuideSource, Lang } from "@/lib/seo/types";
import { CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import { DeniedNote, pillTab, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle, BACK_LINK } from "@/components/staff/ui";
import { FIELD, LABEL, Notice, PassChip, SampleNote, SeoGate, StatusChip, when } from "@/components/staff/seo/ui";

// One guide: the brief, Alti's draft, both languages' words, the sources,
// the checks (the claim rules and the SEO checklist) as it is typed, the
// person's ticks, and the workflow: send for approval, ask for changes,
// publish (an administrator), take off the site. docs/SEO.md.

type Work = Pick<Guide, "topic" | "brief" | "phrase" | "slug" | "body" | "sources">;

const toWork = (g: Guide): Work => ({ topic: g.topic, brief: g.brief, phrase: { ...g.phrase }, slug: g.slug, body: structuredClone(g.body), sources: structuredClone(g.sources) });

function counter(n: number, min: number, max: number) {
  const ok = n >= min && n <= max;
  return <span className={`text-[12px] tabular-nums ${ok ? "text-slate-500" : "font-semibold text-red-700"}`}>{n}/{max}</span>;
}

function Editor({ guide, seo }: { guide: Guide; seo: ReturnType<typeof useSeo> }) {
  const t = useTx();
  const { locale } = useStaffLocale();

  const [work, setWork] = useState<Work>(() => toWork(guide));
  const [lang, setLang] = useState<Lang>("en");
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<DraftResult | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const mayEdit = can(seo.role, "seo.edit") && guide.status !== "archived";
  const mayPublish = can(seo.role, "seo.publish");
  const text = SEO_TEXT[locale];

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("alti") === "1") setAiOpen(true);
  }, []);
  // A new saved version (after an action) replaces the working copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setWork(toWork(guide)), [guide.id, guide.updatedAt, guide.status]);

  const candidate = useMemo(() => ({ ...guide, ...work }), [guide, work]);
  const issues = useMemo(() => checkGuide(candidate), [candidate]);
  const blocking = blockingIssues(issues);
  const warnings = issues.filter((i) => i.severity === "warn");
  const taken = seo.guides.filter((g) => g.id !== guide.id).map((g) => g.slug);
  const checklist = useMemo(() => guideChecklist(candidate, taken, issues), [candidate, taken, issues]);
  const dirty = guideHash(work) !== guideHash(guide) || work.topic !== guide.topic || work.brief !== guide.brief || work.phrase.en !== guide.phrase.en || work.phrase.es !== guide.phrase.es;
  const blockers = publishBlockers(guide, taken);
  const body = work.body[lang];

  const setBody = (patch: Partial<GuideBody>) => setWork((w) => ({ ...w, body: { ...w.body, [lang]: { ...w.body[lang], ...patch } } }));
  const setSection = (i: number, patch: Partial<GuideBody["sections"][number]>) => setBody({ sections: body.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const say = (ok: boolean, okText: string, message?: { en: string; es: string }) => setNotice(ok ? { text: okText, tone: "info" } : { text: message?.[locale] ?? t("No se pudo.", "It did not work."), tone: "error" });

  const save = async () => {
    setBusy(true);
    const res = await seo.act({ action: "update", id: guide.id, patch: { topic: work.topic, brief: work.brief, phrase: work.phrase, slug: work.slug, body: work.body, sources: work.sources }, aiDraft: usedAi });
    setBusy(false);
    setUsedAi(false);
    say(res.ok, t("Guardado.", "Saved."), res.ok ? undefined : res.message);
  };

  const run = async (action: "submit" | "publish" | "unpublish" | "archive" | "restore") => {
    setBusy(true);
    const res = await seo.act({ action, id: guide.id });
    setBusy(false);
    const done: Record<typeof action, string> = {
      submit: t("Enviada a aprobación.", "Sent for approval."),
      publish: t("Publicada en el sitio, en los dos idiomas.", "Published on the site, in both languages."),
      unpublish: t("Quitada del sitio.", "Taken off the site."),
      archive: t("Archivada.", "Archived."),
      restore: t("Restaurada como borrador.", "Restored as a draft."),
    };
    say(res.ok, done[action], res.ok ? undefined : res.message);
  };

  const tick = async (key: (typeof TICK_ORDER)[number], value: boolean) => {
    const res = await seo.act({ action: "update", id: guide.id, patch: { checklist: { ...guide.checklist, [key]: value } } });
    if (!res.ok) say(false, "", res.message);
  };

  const askAlti = async () => {
    setAiBusy(true);
    setAiResult(null);
    const res = await seo.draft({ topic: work.topic, brief: work.brief, phrase: work.phrase });
    setAiBusy(false);
    if ("error" in res) return say(false, "", res.error);
    setAiResult(res);
  };

  const useDraft = () => {
    if (!aiResult) return;
    setWork((w) => ({ ...w, body: aiResult.body, sources: aiResult.sources, slug: guide.published ? w.slug : aiResult.slug || w.slug }));
    setUsedAi(true);
    setAiOpen(false);
    setNotice({ text: t("El borrador de Alti está en la guía. Léelo, corrígelo y guárdalo.", "Alti's draft is in the guide. Read it, correct it and save it."), tone: "info" });
  };

  const addSource = (s: GuideSource) => setWork((w) => (w.sources.some((x) => x.id === s.id) ? w : { ...w, sources: [...w.sources, s] }));
  const library = sourceLibrary().filter((s) => !work.sources.some((x) => x.id === s.id));

  return (
    <main className="animate-rise">
      <nav aria-label={t("Volver", "Back")}>
        <Link href="/equipo/seo/guias" className={BACK_LINK}>
          <Icon name="chevron" size={16} className="rotate-180" />
          {t("Todas las guías", "All guides")}
        </Link>
      </nav>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip status={guide.status} />
            {isLive(guide) && guide.status !== "published" && <StatusChip status="published" />}
            {guide.aiDraft && <span className="text-[12px] font-medium text-slate-500">{t("Empezó como borrador de Alti (IA)", "Started as Alti's draft (AI)")}</span>}
          </div>
          <h1 className="page-title mt-2 [overflow-wrap:anywhere]">{work.body[locale].title || work.body.en.title || work.topic}</h1>
          <p className="mt-1 text-[14px] text-slate-500">{text.statusHint[guide.status]}</p>
          {guide.published && (
            <p className="mt-1 text-[14px] text-slate-600 [overflow-wrap:anywhere]">
              {t("En el sitio:", "On the site:")}{" "}
              {seo.live ? (
                <a className="font-semibold text-blue-700 underline" href={guidePath(guide.published.slug)} target="_blank" rel="noopener">
                  {guidePath(guide.published.slug)}
                </a>
              ) : (
                <span className="font-semibold">{guidePath(guide.published.slug)}</span>
              )}{" "}
              · {when(guide.published.publishedAt, locale)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/equipo/seo/guias/${guide.id}/vista-previa`} className={`${SECONDARY_BUTTON_COMPACT} gap-1.5`} data-testid="preview-link">
            <Icon name="globe" size={16} />
            {t("Vista previa", "Preview")}
          </Link>
          {mayEdit && (
            <button type="button" onClick={() => void save()} disabled={!dirty || busy} className={`${PRIMARY_BUTTON} px-5`} data-testid="save-guide">
              {dirty ? t("Guardar", "Save") : t("Guardado", "Saved")}
            </button>
          )}
        </div>
      </header>
      <SampleNote live={seo.live} />
      {guide.status === "changes" && guide.changesNote && (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-800">
          <strong>{t("Cambios pedidos:", "Changes asked:")}</strong> «{guide.changesNote}»
        </p>
      )}
      <div className="mt-3">
        <Notice text={notice?.text ?? null} tone={notice?.tone} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {/* The brief */}
          <section className="card px-4 py-4 sm:px-5" aria-labelledby="brief">
            <SectionTitle>
              <span id="brief">{t("El encargo", "The brief")}</span>
            </SectionTitle>
            <div className="space-y-3">
              <div>
                <label className={LABEL} htmlFor="topic">{t("Tema", "Topic")}</label>
                <input id="topic" className={`${FIELD} mt-1 h-11`} value={work.topic} disabled={!mayEdit} maxLength={160} onChange={(e) => setWork({ ...work, topic: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="phrase-en">{t("Frase de búsqueda (inglés)", "Search phrase (English)")}</label>
                  <input id="phrase-en" className={`${FIELD} mt-1 h-11`} value={work.phrase.en} disabled={!mayEdit} maxLength={100} onChange={(e) => setWork({ ...work, phrase: { ...work.phrase, en: e.target.value } })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="phrase-es">{t("Frase de búsqueda (español)", "Search phrase (Spanish)")}</label>
                  <input id="phrase-es" className={`${FIELD} mt-1 h-11`} value={work.phrase.es} disabled={!mayEdit} maxLength={100} onChange={(e) => setWork({ ...work, phrase: { ...work.phrase, es: e.target.value } })} />
                </div>
              </div>
              <div>
                <label className={LABEL} htmlFor="brief-text">{t("Encargo", "Brief")}</label>
                <textarea id="brief-text" className={`${FIELD} mt-1 min-h-20 py-2`} value={work.brief} disabled={!mayEdit} maxLength={1200} onChange={(e) => setWork({ ...work, brief: e.target.value })} />
              </div>
              <div>
                <label className={LABEL} htmlFor="slug">{t("Dirección (slug), la misma en los dos idiomas", "Address (slug), the same in both languages")}</label>
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-[14px] text-slate-500">/guias/</span>
                  <input id="slug" className={`${FIELD} h-11`} value={work.slug} disabled={!mayEdit || Boolean(guide.published)} maxLength={80} onChange={(e) => setWork({ ...work, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
                </div>
                {guide.published && <p className="mt-1 text-[12px] text-slate-500">{t("No cambia mientras la guía está publicada.", "It does not change while the guide is live.")}</p>}
              </div>
            </div>
            {mayEdit && (
              <div className="mt-4 rounded-2xl bg-blue-50/60 p-3.5 ring-1 ring-inset ring-blue-100">
                <div className="flex items-center gap-3">
                  <CharacterFigure character="assistant" pose="phone" height={56} decorative />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-blue-700">{aiByline(locale)}</p>
                    <p className="text-[14px] leading-snug text-slate-700">{t("Escribo el esquema y la guía en inglés y español a partir del encargo, con una fuente oficial para cada dato legal. Es un borrador: tú lo revisas.", "I write the outline and the guide in English and Spanish from the brief, with an official source for every legal fact. It is a draft: you check it.")}</p>
                  </div>
                </div>
                {!aiOpen ? (
                  <button type="button" onClick={() => setAiOpen(true)} className={`${SECONDARY_BUTTON_COMPACT} mt-3 gap-1.5`} data-testid="open-alti">
                    <Icon name="sparkle" size={16} />
                    {t("Pedir borrador a Alti", "Ask Alti for a draft")}
                  </button>
                ) : (
                  <div className="mt-3 space-y-3">
                    <button type="button" onClick={() => void askAlti()} disabled={aiBusy || work.topic.trim().length < 3} className={`${PRIMARY_BUTTON} gap-1.5`} data-testid="ask-alti">
                      <Icon name="sparkle" size={18} />
                      {aiBusy ? t("Alti está escribiendo…", "Alti is writing…") : t("Escribir el borrador", "Write the draft")}
                    </button>
                    {aiResult && (
                      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200" data-testid="alti-result">
                        <p className="text-[14px] font-semibold text-blue-900">
                          {aiResult.source === "model" ? t("Borrador completo de Alti", "Alti's full draft") : t("Solo el esquema (sin clave de Claude en el servidor)", "Outline only (no Claude key on the server)")}
                        </p>
                        {aiResult.source === "outline" && (
                          <p className="mt-1 text-[13px] text-slate-600">{t("Alti preparó los encabezados, las fuentes que encajan y el párrafo final con los enlaces. Los párrafos marcados [Escribe: …] los escribe una persona.", "Alti prepared the headings, the sources that fit and the closing paragraph with the links. The paragraphs marked [Write: …] are written by a person.")}</p>
                        )}
                        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13.5px] text-slate-700">
                          {aiResult.outline.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ol>
                        <p className="mt-2 text-[13px] text-slate-600">
                          {t(`${blockingIssues(aiResult.issues).length} cosas por corregir · ${aiResult.sources.length} fuentes`, `${blockingIssues(aiResult.issues).length} things to correct · ${aiResult.sources.length} sources`)}
                        </p>
                        <button type="button" onClick={useDraft} className={`${SECONDARY_BUTTON_COMPACT} mt-2`} data-testid="use-draft">
                          {t("Poner el borrador en la guía", "Put the draft in the guide")}
                        </button>
                        <p className="mt-1 text-[12px] text-slate-500">{t("Reemplaza las palabras y las fuentes de los dos idiomas. No se guarda hasta que toques «Guardar».", "It replaces both languages' words and the sources. Nothing is saved until you tap “Save”.")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* The words, one language at a time */}
          <section className="card px-4 py-4 sm:px-5" aria-labelledby="words">
            <SectionTitle
              aside={
                <div className="flex gap-1.5" role="tablist" aria-label={t("Idioma", "Language")}>
                  {(["en", "es"] as const).map((l) => (
                    <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={pillTab(lang === l)}>
                      {l === "en" ? t("Inglés", "English") : t("Español", "Spanish")}
                    </button>
                  ))}
                </div>
              }
            >
              <span id="words">{t("Las palabras", "The words")}</span>
            </SectionTitle>
            <p className="mb-3 text-[13px] text-slate-500">{t("Marcas: [palabras](/como-funciona) para un enlace y [^id] para citar una fuente de la lista.", "Marks: [words](/como-funciona) for a link and [^id] to cite a source from the list.")}</p>
            <fieldset disabled={!mayEdit} className="space-y-3">
              <div>
                <div className="flex items-baseline justify-between">
                  <label className={LABEL} htmlFor="title">{t("Título (y h1)", "Title (and h1)")}</label>
                  {counter(body.title.length, 30, 60)}
                </div>
                <input id="title" lang={lang} className={`${FIELD} mt-1 h-11`} value={body.title} maxLength={120} onChange={(e) => setBody({ title: e.target.value })} />
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <label className={LABEL} htmlFor="description">{t("Meta descripción", "Meta description")}</label>
                  {counter(body.description.length, 70, 160)}
                </div>
                <textarea id="description" lang={lang} className={`${FIELD} mt-1 min-h-16 py-2`} value={body.description} maxLength={300} onChange={(e) => setBody({ description: e.target.value })} />
              </div>
              <div>
                <label className={LABEL} htmlFor="intro">{t("Introducción", "Introduction")}</label>
                <textarea id="intro" lang={lang} className={`${FIELD} mt-1 min-h-24 py-2`} value={body.intro} maxLength={1500} onChange={(e) => setBody({ intro: e.target.value })} />
              </div>
              {body.sections.map((s, i) => (
                <div key={i} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className={LABEL} htmlFor={`h-${i}`}>{t(`Sección ${i + 1} · encabezado (h2)`, `Section ${i + 1} · heading (h2)`)}</label>
                      <input id={`h-${i}`} lang={lang} className={`${FIELD} mt-1 h-11`} value={s.heading} maxLength={120} onChange={(e) => setSection(i, { heading: e.target.value })} />
                    </div>
                    <button type="button" className={QUIET_BUTTON} onClick={() => setBody({ sections: body.sections.filter((_, j) => j !== i) })} aria-label={t(`Quitar la sección ${i + 1}`, `Remove section ${i + 1}`)}>
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  {s.paragraphs.map((p, j) => (
                    <div key={j} className="mt-2 flex items-start gap-2">
                      <textarea lang={lang} aria-label={t(`Párrafo ${j + 1} de la sección ${i + 1}`, `Paragraph ${j + 1} of section ${i + 1}`)} className={`${FIELD} min-h-24 py-2`} value={p} maxLength={2500} onChange={(e) => setSection(i, { paragraphs: s.paragraphs.map((x, k) => (k === j ? e.target.value : x)) })} />
                      <button type="button" className={QUIET_BUTTON} onClick={() => setSection(i, { paragraphs: s.paragraphs.filter((_, k) => k !== j) })} aria-label={t(`Quitar el párrafo ${j + 1}`, `Remove paragraph ${j + 1}`)}>
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className={`${QUIET_BUTTON} mt-1`} onClick={() => setSection(i, { paragraphs: [...s.paragraphs, ""] })}>
                    <Icon name="plus" size={16} />
                    {t("Párrafo", "Paragraph")}
                  </button>
                </div>
              ))}
              <button type="button" className={SECONDARY_BUTTON_COMPACT} onClick={() => setBody({ sections: [...body.sections, { heading: "", paragraphs: [""] }] })}>
                <Icon name="plus" size={16} />
                {t("Agregar sección", "Add section")}
              </button>

              <div className="pt-2">
                <p className="console-label">{t("Preguntas al final", "Questions at the end")}</p>
                {body.faq.map((f, i) => (
                  <div key={i} className="mt-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <label className={LABEL} htmlFor={`q-${i}`}>{t(`Pregunta ${i + 1}`, `Question ${i + 1}`)}</label>
                        <input id={`q-${i}`} lang={lang} className={`${FIELD} mt-1 h-11`} value={f.q} maxLength={700} onChange={(e) => setBody({ faq: body.faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} />
                      </div>
                      <button type="button" className={QUIET_BUTTON} onClick={() => setBody({ faq: body.faq.filter((_, k) => k !== i) })} aria-label={t(`Quitar la pregunta ${i + 1}`, `Remove question ${i + 1}`)}>
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                    <label className={`${LABEL} mt-2`} htmlFor={`a-${i}`}>{t("Respuesta", "Answer")}</label>
                    <textarea id={`a-${i}`} lang={lang} className={`${FIELD} mt-1 min-h-16 py-2`} value={f.a} maxLength={700} onChange={(e) => setBody({ faq: body.faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)) })} />
                  </div>
                ))}
                <button type="button" className={`${SECONDARY_BUTTON_COMPACT} mt-2`} onClick={() => setBody({ faq: [...body.faq, { q: "", a: "" }] })}>
                  <Icon name="plus" size={16} />
                  {t("Agregar pregunta", "Add question")}
                </button>
              </div>
            </fieldset>
          </section>

          {/* Sources */}
          <section className="card px-4 py-4 sm:px-5" aria-labelledby="sources">
            <SectionTitle>
              <span id="sources">{t("Fuentes", "Sources")}</span>
            </SectionTitle>
            <p className="mb-3 text-[13px] text-slate-500">{t("Cada dato legal cita una fuente oficial: la ley, la CFPB, la FTC o Texas. Abre cada enlace antes de publicar.", "Every legal fact cites an official source: the statute, the CFPB, the FTC or Texas. Open each link before publishing.")}</p>
            <ul className="space-y-2">
              {work.sources.map((s, i) => (
                <li key={i} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                  <fieldset disabled={!mayEdit} className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <div>
                      <label className={LABEL} htmlFor={`sid-${i}`}>{t("Id (para [^id])", "Id (for [^id])")}</label>
                      <input id={`sid-${i}`} className={`${FIELD} mt-1 h-11`} value={s.id} maxLength={40} onChange={(e) => setWork({ ...work, sources: work.sources.map((x, k) => (k === i ? { ...x, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") } : x)) })} />
                    </div>
                    <div className="min-w-0">
                      <label className={LABEL} htmlFor={`slabel-${i}`}>{t("Nombre", "Name")}</label>
                      <input id={`slabel-${i}`} className={`${FIELD} mt-1 h-11`} value={s.label} maxLength={200} onChange={(e) => setWork({ ...work, sources: work.sources.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`scite-${i}`}>{t("Cita legal", "Legal citation")}</label>
                      <input id={`scite-${i}`} className={`${FIELD} mt-1 h-11`} value={s.cite} maxLength={120} placeholder="15 U.S.C. § 1681i" onChange={(e) => setWork({ ...work, sources: work.sources.map((x, k) => (k === i ? { ...x, cite: e.target.value } : x)) })} />
                    </div>
                    <div className="min-w-0">
                      <label className={LABEL} htmlFor={`surl-${i}`}>{t("Dirección (https)", "Address (https)")}</label>
                      <div className="mt-1 flex gap-2">
                        <input id={`surl-${i}`} className={`${FIELD} h-11`} value={s.url} maxLength={400} onChange={(e) => setWork({ ...work, sources: work.sources.map((x, k) => (k === i ? { ...x, url: e.target.value.trim() } : x)) })} />
                        {/^https:\/\//.test(s.url) && (
                          <a href={s.url} target="_blank" rel="noopener" className={QUIET_BUTTON} aria-label={t("Abrir la fuente", "Open the source")}>
                            <Icon name="link" size={16} />
                          </a>
                        )}
                        <button type="button" className={QUIET_BUTTON} onClick={() => setWork({ ...work, sources: work.sources.filter((_, k) => k !== i) })} aria-label={t("Quitar la fuente", "Remove the source")}>
                          <Icon name="close" size={16} />
                        </button>
                      </div>
                    </div>
                  </fieldset>
                </li>
              ))}
            </ul>
            {mayEdit && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={SECONDARY_BUTTON_COMPACT} onClick={() => setWork({ ...work, sources: [...work.sources, { id: `source-${work.sources.length + 1}`, label: "", cite: "", url: "https://" }] })}>
                  <Icon name="plus" size={16} />
                  {t("Agregar fuente", "Add source")}
                </button>
                {library.length > 0 && (
                  <select
                    aria-label={t("Agregar de la biblioteca de fuentes", "Add from the source library")}
                    className={`${FIELD} h-12 max-w-full sm:w-auto`}
                    value=""
                    onChange={(e) => {
                      const s = library.find((x) => x.id === e.target.value);
                      if (s) addSource(s);
                    }}
                  >
                    <option value="">{t("De la biblioteca…", "From the library…")}</option>
                    {library.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.cite || s.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </section>
        </div>

        {/* The checks and the workflow */}
        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section className="card px-4 py-4" aria-labelledby="rules">
            <SectionTitle aside={<PassChip pass={blocking.length === 0} label={blocking.length === 0 ? t("Sin bloqueos", "Nothing blocking") : t(`${blocking.length} bloquean`, `${blocking.length} blocking`)} />}>
              <span id="rules">{t("Reglas", "Rules")}</span>
            </SectionTitle>
            {issues.length === 0 ? (
              <p className="text-[14px] text-slate-600">{t("Pasa las reglas de lo que se puede decir y las de la guía, en los dos idiomas.", "It passes the claim rules and the guide's rules, in both languages.")}</p>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" data-testid="guide-issues">
                {[...blocking, ...warnings].slice(0, 40).map((i) => (
                  <li key={i.id} className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${i.severity === "block" ? "bg-red-50 text-red-900" : "bg-amber-50 text-blue-900"}`}>
                    <p className="font-semibold [overflow-wrap:anywhere]">
                      {i.severity === "block" ? t("Bloquea", "Blocks") : t("Revisa", "Check")} · {i.where}
                      {i.match ? ` · «${i.match}»` : ""}
                    </p>
                    <p className="mt-0.5">{i.explain[locale]}</p>
                    <p className="mt-0.5 text-slate-700">{i.fix[locale]}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card px-4 py-4" aria-labelledby="seo-checklist">
            <SectionTitle>
              <span id="seo-checklist">{t("Lista SEO", "SEO checklist")}</span>
            </SectionTitle>
            <ul className="space-y-2" data-testid="seo-checklist">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 text-[13.5px]">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.pass ? "bg-green-100 text-green-700" : c.required ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`} aria-hidden>
                    <Icon name={c.pass ? "check" : "info"} size={13} strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold text-blue-900">{text.checklist[c.key].label}</span>
                    {!c.required && <span className="text-slate-500"> · {t("consejo", "advice")}</span>}
                    <span className="sr-only">: {c.pass ? text.state.pass : text.state.fix}</span>
                    <span className="block text-slate-600">{c.pass ? text.checklist[c.key].ok : text.checklist[c.key].hint}</span>
                    {!c.pass && c.found.length > 0 && <span className="block text-[12px] text-red-700 [overflow-wrap:anywhere]">{c.found.join(" · ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card px-4 py-4" aria-labelledby="ticks">
            <SectionTitle>
              <span id="ticks">{t("Lo que revisa una persona", "What a person checks")}</span>
            </SectionTitle>
            {dirty && <p className="mb-2 text-[13px] text-amber-700">{t("Guarda primero: las marcas son sobre lo guardado.", "Save first: the ticks are about what is saved.")}</p>}
            <ul className="space-y-2">
              {TICK_ORDER.map((key) => (
                <li key={key}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-[14px] text-slate-700">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-900" checked={Boolean(guide.checklist[key])} disabled={!mayEdit || dirty} onChange={(e) => void tick(key, e.target.checked)} />
                    <span>{text.ticks[key]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card px-4 py-4" aria-labelledby="flow">
            <SectionTitle>
              <span id="flow">{t("Aprobación y publicación", "Approval and publishing")}</span>
            </SectionTitle>
            <div className="space-y-2.5">
              {mayEdit && ["draft", "changes"].includes(guide.status) && (
                <button type="button" disabled={busy || dirty} onClick={() => void run("submit")} className={`${PRIMARY_BUTTON} w-full`} data-testid="submit-guide">
                  {t("Mandar a aprobación", "Send for approval")}
                </button>
              )}
              {guide.status === "review" && mayPublish && (
                <>
                  <button type="button" disabled={busy || dirty || blockers.length > 0} onClick={() => void run("publish")} className={`${PRIMARY_BUTTON} w-full`} data-testid="publish-guide">
                    {t("Aprobar y publicar", "Approve and publish")}
                  </button>
                  {blockers.length > 0 && (
                    <ul className="space-y-1 text-[13px] text-slate-600" data-testid="publish-blockers">
                      {blockers.map((b) => (
                        <li key={b.code} className="flex gap-1.5">
                          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          <span>
                            {b.code === "issues"
                              ? t(`${b.detail} reglas bloquean`, `${b.detail} rules block it`)
                              : b.code.startsWith("checklist.")
                                ? `${text.checklist[b.code.slice(10) as keyof typeof text.checklist].label}`
                                : b.code.startsWith("tick.")
                                  ? text.ticks[b.code.slice(5) as keyof typeof text.ticks]
                                  : text.statusHint[guide.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <label className={LABEL} htmlFor="changes-note">{t("O pide cambios", "Or ask for changes")}</label>
                    <textarea id="changes-note" className={`${FIELD} mt-1 min-h-16 py-2`} value={changesNote} maxLength={600} onChange={(e) => setChangesNote(e.target.value)} placeholder={t("Qué cambiar y por qué", "What to change and why")} />
                    <button
                      type="button"
                      disabled={busy || changesNote.trim().length < 3}
                      className={`${SECONDARY_BUTTON} mt-2 w-full`}
                      onClick={async () => {
                        setBusy(true);
                        const res = await seo.act({ action: "request_changes", id: guide.id, note: changesNote });
                        setBusy(false);
                        if (res.ok) setChangesNote("");
                        say(res.ok, t("Cambios pedidos.", "Changes asked."), res.ok ? undefined : res.message);
                      }}
                    >
                      {t("Pedir cambios", "Ask for changes")}
                    </button>
                  </div>
                </>
              )}
              {guide.status === "review" && !mayPublish && <DeniedNote>{t("Esperando a un administrador: solo un administrador publica.", "Waiting for an administrator: only an administrator publishes.")}</DeniedNote>}
              {guide.published && mayPublish && (
                <button type="button" disabled={busy} onClick={() => void run("unpublish")} className={`${SECONDARY_BUTTON} w-full`} data-testid="unpublish-guide">
                  {t("Quitar del sitio", "Take off the site")}
                </button>
              )}
              {guide.status === "archived" ? (
                can(seo.role, "seo.edit") && (
                  <button type="button" disabled={busy} onClick={() => void run("restore")} className={`${SECONDARY_BUTTON} w-full`}>
                    {t("Restaurar", "Restore")}
                  </button>
                )
              ) : (
                mayEdit && !guide.published && (
                  <button type="button" disabled={busy} onClick={() => void run("archive")} className={`${QUIET_BUTTON} w-full`}>
                    {t("Archivar", "Archive")}
                  </button>
                )
              )}
              {dirty && <p className="text-[13px] text-amber-700">{t("Hay cambios sin guardar.", "There are unsaved changes.")}</p>}
            </div>
          </section>

          {seo.events.length > 0 && (
            <section className="card px-4 py-4" aria-labelledby="history">
              <SectionTitle>
                <span id="history">{t("Historial", "History")}</span>
              </SectionTitle>
              <ol className="space-y-1.5 text-[13px] text-slate-600">
                {[...seo.events].reverse().slice(0, 20).map((e) => (
                  <li key={e.id}>
                    <span className="font-semibold text-blue-900">{e.kind}</span> · {e.by} · {when(e.at, locale)}
                    {e.note ? <span className="block text-slate-500">«{e.note}»</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function GuideScreen() {
  const t = useTx();
  const { id } = useParams<{ id: string }>();
  const seo = useSeo(id);
  if (!seo.ready) return <div className="h-40" aria-busy="true" />;
  const guide = seo.guides.find((g) => g.id === id);
  if (!guide)
    return (
      <main className="animate-rise">
        <h1 className="page-title">{t("Guía no encontrada", "Guide not found")}</h1>
        <p className="mt-2 text-[15px] text-slate-600">
          <Link href="/equipo/seo/guias" className="font-semibold text-blue-700 underline">
            {t("Volver a las guías", "Back to the guides")}
          </Link>
        </p>
      </main>
    );
  return <Editor guide={guide} seo={seo} />;
}

export default function GuideEditorPage() {
  return (
    <SeoGate>
      <GuideScreen />
    </SeoGate>
  );
}
