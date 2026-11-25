import { notFound } from "next/navigation";
import SiteShell from "@/components/site/SiteShell";
import GuideArticle from "@/components/site/GuideArticle";
import { requestLocale } from "@/lib/i18n/server";
import { guideArticleJsonLd, guideBreadcrumbJsonLd, guideFaqJsonLd, guideMetadata } from "@/lib/seo/schema";
import { publishedGuide } from "@/lib/seo/server";
import { jsonLd } from "@/lib/site/seo";

// /guias/<slug>: one published guide (docs/SEO.md). Only the version an
// administrator published, read through the database's public function
// (seo_published_guide); a draft, a guide waiting for approval or an
// archived one is not found. One URL for both languages, like every page of
// the site: ?lang=en and ?lang=es, with hreflang. Article, FAQPage and
// breadcrumb data are built from the same published version the page shows.

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const guide = await publishedGuide(slug);
  if (!guide) return { title: "Not found", robots: { index: false } };
  return guideMetadata(guide, (await requestLocale()).locale);
}

export default async function GuidePage({ params }: Params) {
  const { slug } = await params;
  const guide = await publishedGuide(slug);
  if (!guide) notFound();
  const { locale } = await requestLocale();
  const faq = guideFaqJsonLd(guide, locale);
  return (
    <SiteShell>
      <main>
        <GuideArticle guide={guide} locale={locale} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(guideArticleJsonLd(guide, locale)) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(guideBreadcrumbJsonLd(guide, locale)) }} />
        {faq && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faq) }} />}
      </main>
    </SiteShell>
  );
}
