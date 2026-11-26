"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { guideHash } from "@/lib/seo/guides";
import { useSeo } from "@/lib/seo/store";
import type { Lang, PublishedGuide } from "@/lib/seo/types";
import GuideArticle from "@/components/site/GuideArticle";
import Icon from "@/components/Icon";
import { pillTab, QUIET_BUTTON, BACK_LINK } from "@/components/staff/ui";
import { SeoGate } from "@/components/staff/seo/ui";

// The guide as the public page will show it (the same component as
// /guias/<slug>), from the saved working copy, before anything is published.
// Marked as a preview; the console is never indexed.

function Preview() {
  const t = useTx();
  const { id } = useParams<{ id: string }>();
  const seo = useSeo(id);
  const [lang, setLang] = useState<Lang>("en");
  if (!seo.ready) return <div className="h-40" aria-busy="true" />;
  const guide = seo.guides.find((g) => g.id === id);
  if (!guide) return <p className="text-[15px] text-slate-600">{t("Guía no encontrada.", "Guide not found.")}</p>;
  const now = new Date().toISOString();
  const shown: PublishedGuide = { slug: guide.slug, body: guide.body, sources: guide.sources, hash: guideHash(guide), publishedAt: guide.published?.publishedAt ?? now, firstPublishedAt: guide.published?.firstPublishedAt ?? now, approvedBy: "" };
  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/equipo/seo/guias/${guide.id}`} className={BACK_LINK}>
          <Icon name="chevron" size={16} className="rotate-180" />
          {t("Volver al editor", "Back to the editor")}
        </Link>
        <div className="flex gap-1.5" role="tablist" aria-label={t("Idioma de la vista previa", "Preview language")}>
          {(["en", "es"] as const).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={pillTab(lang === l)}>
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-[14px] bg-[#f6f7f9] ring-1 ring-slate-200" data-testid="guide-preview">
        <GuideArticle
          guide={shown}
          locale={lang}
          banner={
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-400 px-3 py-1 text-[13px] font-semibold text-blue-900">
              <Icon name="info" size={15} />
              {guide.published && guide.published.hash === shown.hash ? t("Así se ve publicada", "As it looks on the site") : t("Vista previa · no publicada", "Preview · not published")}
            </p>
          }
        />
      </div>
    </main>
  );
}

export default function GuidePreviewPage() {
  return (
    <SeoGate>
      <Preview />
    </SeoGate>
  );
}
