import Link from "next/link";
import { notFound } from "next/navigation";
import { CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import SiteShell from "@/components/site/SiteShell";
import { formatGuideDate } from "@/components/site/GuideArticle";
import { Container, PageHero } from "@/components/site/ui";
import { requestLocale } from "@/lib/i18n/server";
import { guidePath } from "@/lib/seo/guides";
import { GUIDE_PAGE_COPY } from "@/lib/seo/publicCopy";
import { guidesIndexMetadata } from "@/lib/seo/schema";
import { listPublishedGuides } from "@/lib/seo/server";

// /guias: the published guides (docs/SEO.md). Before the first guide is
// published the page does not exist (not found, and not in the sitemap), so
// search engines never see an empty page.

export async function generateMetadata() {
  return guidesIndexMetadata((await requestLocale()).locale);
}

export default async function GuidesIndex() {
  const guides = await listPublishedGuides();
  if (guides.length === 0) notFound();
  const { locale } = await requestLocale();
  const c = GUIDE_PAGE_COPY[locale];
  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={c.indexEyebrow} title={c.indexTitle} lead={c.indexLead} figure={<CharacterFigure character="assistant" pose="envelope" height={230} decorative />} />
        <section aria-label={c.indexTitle} className="py-12 sm:py-16">
          <Container>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link href={guidePath(g.slug)} className="pressable flex h-full flex-col rounded-3xl bg-white p-6 ring-1 ring-slate-200 hover:ring-amber-400">
                    <span className="font-display text-[20px] font-bold leading-snug text-blue-900">{g.body[locale].title}</span>
                    <span className="mt-2 flex-1 text-[15px] leading-relaxed text-slate-600">{g.body[locale].description}</span>
                    <span className="mt-4 flex items-center justify-between gap-2 text-[14px]">
                      <span className="text-slate-500">{formatGuideDate(g.publishedAt, locale)}</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                        {c.read}
                        <Icon name="chevron" size={16} strokeWidth={2.25} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
