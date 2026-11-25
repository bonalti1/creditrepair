import Link from "next/link";
import { CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import { aiByline } from "@/lib/brand";
import type { Locale } from "@/lib/i18n/dictionaries";
import { primaryCta } from "@/lib/site/cta";
import { tokenize } from "@/lib/seo/markup";
import { GUIDE_PAGE_COPY } from "@/lib/seo/publicCopy";
import type { PublishedGuide } from "@/lib/seo/types";
import { Container, Eyebrow } from "./ui";

// One guide on the public website (/guias/<slug>), in the site's look: the
// navy hero with one of Alti's poses (labelled as the AI assistant), the
// reading column, sources for every legal fact, the questions and a calm way
// to start (no pressure). Pure: no hooks and nothing server-only, so the
// console's preview (/equipo/seo/guias/<id>/vista-previa) shows the very same
// page before anything is published. Every word comes from the published
// version; the marks in it become links and citations (src/lib/seo/markup.ts),
// never markup.

function Rich({ text, sourceIndex, label = "Source" }: { text: string; sourceIndex: Map<string, number>; label?: string }) {
  return (
    <>
      {tokenize(text).map((t, i) => {
        if (t.kind === "text") return <span key={i}>{t.text}</span>;
        if (t.kind === "cite") {
          const n = sourceIndex.get(t.id);
          return n ? (
            <sup key={i} className="ml-0.5">
              <a href={`#source-${t.id}`} className="font-semibold text-blue-700 no-underline hover:underline" aria-label={`${label} ${n}`}>
                [{n}]
              </a>
            </sup>
          ) : null;
        }
        return t.href.startsWith("/") ? (
          <Link key={i} href={t.href} className="font-semibold text-blue-700 underline underline-offset-4">
            {t.text}
          </Link>
        ) : (
          <a key={i} href={t.href} className="font-semibold text-blue-700 underline underline-offset-4" target="_blank" rel="noopener">
            {t.text}
          </a>
        );
      })}
    </>
  );
}

const sectionId = (i: number) => `section-${i + 1}`;

export function formatGuideDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale === "es" ? "es-US" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" }) : "";
}

export default function GuideArticle({ guide, locale, banner }: { guide: PublishedGuide; locale: Locale; banner?: React.ReactNode }) {
  const c = GUIDE_PAGE_COPY[locale];
  const body = guide.body[locale];
  const sourceIndex = new Map(guide.sources.map((s, i) => [s.id, i + 1]));
  const cta = primaryCta(locale);
  return (
    <article lang={locale}>
      <section className="relative overflow-hidden bg-blue-900 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full bg-blue-800/70 blur-3xl" />
        <Container className="relative pb-12 pt-8 sm:pb-16 sm:pt-12">
          {banner}
          <nav aria-label={c.breadcrumbGuides} className="text-[14px] text-blue-200">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className="underline-offset-4 hover:underline">
                  {c.breadcrumbHome}
                </Link>
              </li>
              <li aria-hidden>›</li>
              <li>
                <Link href="/guias" className="underline-offset-4 hover:underline">
                  {c.breadcrumbGuides}
                </Link>
              </li>
            </ol>
          </nav>
          <div className="mt-5 flex items-end gap-8">
            <div className="min-w-0 flex-1">
              <Eyebrow onNavy>{c.eyebrow}</Eyebrow>
              <h1 className="mt-3 max-w-3xl font-display text-[32px] font-bold leading-[1.12] sm:text-[46px]">{body.title}</h1>
              <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-blue-100 sm:text-[18px]">{body.description}</p>
              <p className="mt-5 text-[14px] text-blue-200">
                {c.updated}: <time dateTime={guide.publishedAt}>{formatGuideDate(guide.publishedAt, locale)}</time>
              </p>
            </div>
            <figure className="hidden shrink-0 text-center lg:block">
              <CharacterFigure character="assistant" pose="thinking" height={210} decorative />
              <figcaption className="mt-1 text-[12px] font-semibold text-blue-200">{aiByline(locale)}</figcaption>
            </figure>
          </div>
        </Container>
      </section>

      <Container narrow className="py-10 sm:py-14">
        <p className="text-[18px] leading-relaxed text-slate-700">
          <Rich text={body.intro} sourceIndex={sourceIndex} label={c.sources} />
        </p>

        {body.sections.length > 2 && (
          <nav aria-labelledby="toc" className="mt-8 rounded-3xl bg-white p-5 ring-1 ring-slate-200 sm:p-6">
            <h2 id="toc" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-700">
              {c.inThisGuide}
            </h2>
            <ol className="mt-3 space-y-2 text-[16px]">
              {body.sections.map((s, i) => (
                <li key={i}>
                  <a href={`#${sectionId(i)}`} className="font-medium text-blue-800 underline-offset-4 hover:underline">
                    {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {body.sections.map((s, i) => (
          <section key={i} aria-labelledby={sectionId(i)} className="mt-10">
            <h2 id={sectionId(i)} className="scroll-mt-24 font-display text-[24px] font-bold leading-tight text-blue-900 sm:text-[30px]">
              {s.heading}
            </h2>
            {s.paragraphs.filter(Boolean).map((p, j) => (
              <p key={j} className="mt-4 text-[17px] leading-relaxed text-slate-700">
                <Rich text={p} sourceIndex={sourceIndex} label={c.sources} />
              </p>
            ))}
          </section>
        ))}

        {body.faq.length > 0 && (
          <section aria-labelledby="guide-faq" className="mt-12">
            <h2 id="guide-faq" className="font-display text-[24px] font-bold text-blue-900 sm:text-[30px]">
              {c.questions}
            </h2>
            <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
              {body.faq.map((f, i) => (
                <details key={i} className="group">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-5 text-[17px] font-semibold text-blue-900 hover:bg-slate-50 sm:px-7 [&::-webkit-details-marker]:hidden">
                    <span>{f.q}</span>
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 transition-transform group-open:rotate-45">
                      <Icon name="plus" size={16} strokeWidth={2.25} />
                    </span>
                  </summary>
                  <p className="px-5 pb-6 text-[16px] leading-relaxed text-slate-600 sm:px-7">
                    <Rich text={f.a} sourceIndex={sourceIndex} label={c.sources} />
                  </p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="guide-cta" className="mt-12 rounded-3xl bg-blue-900 p-7 text-white sm:p-10">
          <h2 id="guide-cta" className="font-display text-[24px] font-bold leading-tight">
            {c.ctaTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-blue-100">{c.ctaLead}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {cta.external ? (
              <a href={cta.href} rel="noopener" target="_blank" className="pressable inline-flex h-14 items-center justify-center gap-2 rounded-full bg-amber-400 px-8 text-[17px] font-semibold text-blue-900 hover:bg-amber-500">
                {cta.label}
              </a>
            ) : (
              <Link href={cta.href} className="pressable inline-flex h-14 items-center justify-center gap-2 rounded-full bg-amber-400 px-8 text-[17px] font-semibold text-blue-900 hover:bg-amber-500">
                {cta.label}
                <Icon name="chevron" size={18} strokeWidth={2.25} />
              </Link>
            )}
            <Link href="/como-funciona" className="pressable inline-flex h-14 items-center justify-center rounded-full bg-white/10 px-8 text-[17px] font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15">
              {c.howLink}
            </Link>
            <Link href="/precios" className="pressable inline-flex h-14 items-center justify-center rounded-full px-4 text-[16px] font-semibold text-white underline underline-offset-4">
              {c.pricingLink}
            </Link>
          </div>
        </section>

        {guide.sources.length > 0 && (
          <section aria-labelledby="guide-sources" className="mt-12">
            <h2 id="guide-sources" className="font-display text-[22px] font-bold text-blue-900">
              {c.sources}
            </h2>
            <p className="mt-2 text-[15px] text-slate-600">{c.sourcesLead}</p>
            <ol className="mt-4 space-y-3">
              {guide.sources.map((s, i) => (
                <li key={s.id} id={`source-${s.id}`} className="flex scroll-mt-24 gap-3 text-[15px] leading-snug text-slate-700">
                  <span className="mt-px w-7 shrink-0 font-semibold tabular-nums text-blue-900">[{i + 1}]</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <a href={s.url} target="_blank" rel="noopener" className="font-semibold text-blue-700 underline underline-offset-4" title={c.sourceNote}>
                      {s.label}
                    </a>
                    {s.cite ? <span className="text-slate-500"> · {s.cite}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="mt-10 rounded-2xl bg-slate-100 px-5 py-4 text-[14px] leading-relaxed text-slate-600">{c.disclaimer}</p>
        <p className="mt-6">
          <Link href="/guias" className="inline-flex min-h-11 items-center gap-1.5 text-[16px] font-semibold text-blue-700 underline-offset-4 hover:underline">
            {c.allGuides}
            <Icon name="chevron" size={18} strokeWidth={2.25} />
          </Link>
        </p>
      </Container>
    </article>
  );
}
