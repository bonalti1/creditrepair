"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { blockingIssues, checkGuide, guidePath, isLive, STATUS_ORDER } from "@/lib/seo/guides";
import { STARTER_GUIDES } from "@/lib/seo/starters";
import { useSeo } from "@/lib/seo/store";
import { SEO_TEXT } from "@/lib/seo/text";
import type { GuideStatus } from "@/lib/seo/types";
import Icon from "@/components/Icon";
import { DeniedNote, EmptyState, pillTab, PRIMARY_BUTTON, SECONDARY_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { FIELD, LABEL, Notice, SampleNote, SeoGate, SeoHeader, StatusChip, when } from "@/components/staff/seo/ui";

// Guides: the articles published at /guias/<slug>. A topic and a brief
// become a guide (blank, or drafted by Alti on the next screen); the list
// shows where each one is, what still blocks it and whether it is live.

type Filter = "all" | GuideStatus;

function Guides() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const seo = useSeo();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [phraseEn, setPhraseEn] = useState("");
  const [phraseEs, setPhraseEs] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayEdit = can(seo.role, "seo.edit");

  const sorted = useMemo(
    () => [...seo.guides].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt)),
    [seo.guides],
  );
  const shown = filter === "all" ? sorted.filter((g) => g.status !== "archived") : sorted.filter((g) => g.status === filter);
  const counts = (s: GuideStatus) => seo.guides.filter((g) => g.status === s).length;
  const missingStarters = STARTER_GUIDES.filter((s) => !seo.guides.some((g) => g.id === s.id || g.slug === s.slug)).length;

  const create = async (draftNext: boolean) => {
    setBusy(true);
    setError(null);
    const res = await seo.act({ action: "create", topic, brief, phrase: { en: phraseEn, es: phraseEs } });
    setBusy(false);
    if (!res.ok || !res.guide) return setError(res.ok ? null : res.message[locale]);
    router.push(`/equipo/seo/guias/${res.guide.id}${draftNext ? "?alti=1" : ""}`);
  };

  if (!seo.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <SeoHeader
        title={t("Guías", "Guides")}
        lead={t(
          "Artículos para el sitio en inglés y en español, con fuente para cada dato legal. Alti puede escribir el borrador; una persona lo revisa y solo un administrador lo publica.",
          "Articles for the website in English and Spanish, with a source for every legal fact. Alti can write the draft; a person checks it and only an administrator publishes it.",
        )}
        aside={
          mayEdit ? (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${PRIMARY_BUTTON} gap-1.5`} data-testid="new-guide">
              <Icon name="plus" size={18} />
              {t("Nueva guía", "New guide")}
            </button>
          ) : null
        }
      />
      <SampleNote live={seo.live}>{t("Las cuatro guías de inicio son borradores de muestra sin publicar. Nada de la demostración sale en el sitio.", "The four starter guides are unpublished sample drafts. Nothing in the demo appears on the site.")}</SampleNote>
      {!mayEdit && <div className="mt-3"><DeniedNote>{t("Puedes leer las guías; escribirlas es del equipo de contenido.", "You can read the guides; writing them is the content team's.")}</DeniedNote></div>}

      {open && mayEdit && (
        <form
          className="card mt-5 space-y-3 px-4 py-4 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
          aria-label={t("Nueva guía", "New guide")}
        >
          <div>
            <label className={LABEL} htmlFor="g-topic">
              {t("Tema", "Topic")}
            </label>
            <input id="g-topic" className={`${FIELD} mt-1 h-12`} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={160} required minLength={3} placeholder={t("p. ej. Cómo leer tu reporte de crédito", "e.g. How to read your credit report")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="g-phrase-en">
                {t("Frase de búsqueda en inglés", "Search phrase in English")}
              </label>
              <input id="g-phrase-en" className={`${FIELD} mt-1 h-12`} value={phraseEn} onChange={(e) => setPhraseEn(e.target.value)} maxLength={100} placeholder="how to read a credit report" />
            </div>
            <div>
              <label className={LABEL} htmlFor="g-phrase-es">
                {t("Frase de búsqueda en español", "Search phrase in Spanish")}
              </label>
              <input id="g-phrase-es" className={`${FIELD} mt-1 h-12`} value={phraseEs} onChange={(e) => setPhraseEs(e.target.value)} maxLength={100} placeholder="cómo leer un reporte de crédito" />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="g-brief">
              {t("Encargo (para quién, qué cubrir, qué evitar)", "Brief (who it is for, what to cover, what to avoid)")}
            </label>
            <textarea id="g-brief" className={`${FIELD} mt-1 min-h-24 py-2`} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1200} />
          </div>
          {error && <Notice text={error} tone="error" />}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || topic.trim().length < 3} onClick={() => void create(true)} className={`${PRIMARY_BUTTON} gap-1.5`} data-testid="create-with-alti">
              <Icon name="sparkle" size={18} />
              {t("Crear y pedir borrador a Alti", "Create and ask Alti for a draft")}
            </button>
            <button type="submit" disabled={busy || topic.trim().length < 3} className={SECONDARY_BUTTON}>
              {t("Crear en blanco", "Create blank")}
            </button>
          </div>
        </form>
      )}

      <div className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="toolbar" aria-label={t("Filtrar por estado", "Filter by status")}>
        <div className="flex min-w-max gap-1.5">
          {(["all", "review", "changes", "draft", "published", "archived"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={pillTab(filter === f)}>
              {f === "all" ? t("Todas", "All") : SEO_TEXT[locale].status[f]}
              {f !== "all" && <span className="tabular-nums opacity-75">{counts(f)}</span>}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card mt-4">
          <EmptyState pose="envelope" title={t("No hay guías aquí", "No guides here")}>
            {mayEdit ? t("Crea una con «Nueva guía», o convierte una idea en «Palabras e ideas».", "Create one with “New guide”, or turn an idea into one under “Keywords & ideas”.") : null}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2" data-testid="guide-list">
          {shown.map((g) => {
            const blocking = blockingIssues(checkGuide(g)).length;
            return (
              <li key={g.id}>
                <Link href={`/equipo/seo/guias/${g.id}`} className="card pressable flex h-full flex-col px-4 py-4 hover:ring-2 hover:ring-amber-300 sm:px-5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip status={g.status} />
                    {isLive(g) && g.status !== "published" && <StatusChip status="published" />}
                    {g.sample && <span className="text-[12px] font-semibold uppercase tracking-wide text-amber-700">{t("Muestra", "Sample")}</span>}
                    {g.aiDraft && <span className="text-[12px] font-medium text-slate-500">{t("Borrador de Alti (IA)", "Alti's draft (AI)")}</span>}
                  </div>
                  <p className="mt-2 font-display text-[17px] font-semibold leading-snug text-blue-900">{g.body[locale].title || g.body.en.title || g.topic}</p>
                  <p className="mt-1 text-[13.5px] text-slate-500 [overflow-wrap:anywhere]">{guidePath(g.slug)}</p>
                  <p className="mt-auto pt-3 text-[13px] text-slate-600">
                    {blocking > 0 ? (
                      <span className="font-semibold text-red-700">{t(`${blocking} cosas por corregir`, `${blocking} things to correct`)}</span>
                    ) : (
                      <span className="font-semibold text-green-700">{t("Pasa las reglas", "Passes the rules")}</span>
                    )}
                    {" · "}
                    {t(`Actualizada ${when(g.updatedAt, locale)}`, `Updated ${when(g.updatedAt, locale)}`)}
                  </p>
                  {g.status === "changes" && g.changesNote && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">«{g.changesNote}»</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {mayEdit && missingStarters > 0 && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <p className="max-w-xl text-[14px] text-slate-600">{t(`Hay ${missingStarters} guías de inicio escritas con fuentes (disputas, la ley de Texas, cuánto duran los datos, la ley CROA). Se agregan como borradores sin publicar.`, `There are ${missingStarters} starter guides written with sources (disputes, Texas law, how long items stay, the CROA). They are added as unpublished drafts.`)}</p>
          <button type="button" className={SECONDARY_BUTTON_COMPACT} onClick={() => void seo.addStarters()} data-testid="add-starters">
            {t("Agregar las guías de inicio", "Add the starter guides")}
          </button>
        </div>
      )}
    </main>
  );
}

export default function GuidesPage() {
  return (
    <SeoGate>
      <Guides />
    </SeoGate>
  );
}
