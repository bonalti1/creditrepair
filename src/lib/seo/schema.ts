import type { Metadata } from "next";
import { BRAND } from "../brand";
import type { Locale } from "../i18n/dictionaries";
import { hreflangAlternates, localizedUrl, siteUrl } from "../site/routes";
import { OG_IMAGE } from "../site/seo";
import { GUIDES_INDEX_PATH, guidePath } from "./guides";
import { plainText } from "./markup";
import { GUIDE_PAGE_COPY } from "./publicCopy";
import type { PublishedGuide } from "./types";

// The public guide pages' metadata and structured data, in the site's one
// language system (src/lib/site/routes.ts): one path per guide, ?lang=en and
// ?lang=es, the bare path as x-default. Article and FAQPage data are built
// from the published version itself, so the page and its data never differ.

export { GUIDES_INDEX_PATH };

export function guideMetadata(guide: PublishedGuide, locale: Locale, base: string = siteUrl()): Metadata {
  const path = guidePath(guide.slug);
  const body = guide.body[locale];
  const title = `${body.title} | ${BRAND.name}`;
  return {
    title: { absolute: title },
    description: body.description,
    alternates: { canonical: localizedUrl(path, locale, base), languages: hreflangAlternates(path, base) },
    openGraph: {
      type: "article",
      siteName: BRAND.name,
      title,
      description: body.description,
      url: localizedUrl(path, locale, base),
      locale: locale === "es" ? "es_US" : "en_US",
      alternateLocale: locale === "es" ? ["en_US"] : ["es_US"],
      publishedTime: guide.firstPublishedAt,
      modifiedTime: guide.publishedAt,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description: body.description, images: [OG_IMAGE.url] },
  };
}

export function guidesIndexMetadata(locale: Locale, base: string = siteUrl()): Metadata {
  const c = GUIDE_PAGE_COPY[locale];
  return {
    title: { absolute: c.indexMetaTitle },
    description: c.indexMetaDescription,
    alternates: { canonical: localizedUrl(GUIDES_INDEX_PATH, locale, base), languages: hreflangAlternates(GUIDES_INDEX_PATH, base) },
    openGraph: { type: "website", siteName: BRAND.name, title: c.indexMetaTitle, description: c.indexMetaDescription, url: localizedUrl(GUIDES_INDEX_PATH, locale, base), locale: locale === "es" ? "es_US" : "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: c.indexMetaTitle, description: c.indexMetaDescription, images: [OG_IMAGE.url] },
  };
}

export function guideArticleJsonLd(guide: PublishedGuide, locale: Locale, base: string = siteUrl()): Record<string, unknown> {
  const body = guide.body[locale];
  const url = localizedUrl(guidePath(guide.slug), locale, base);
  const publisher = { "@type": "Organization", name: BRAND.name, url: base, logo: { "@type": "ImageObject", url: `${base}${BRAND.logo.onLight.src}` } };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: body.title.slice(0, 110),
    description: body.description,
    inLanguage: locale === "es" ? "es-US" : "en-US",
    datePublished: guide.firstPublishedAt,
    dateModified: guide.publishedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    image: [`${base}${OG_IMAGE.url}`],
    author: { "@type": "Organization", name: BRAND.name, url: base },
    publisher,
    citation: guide.sources.map((s) => s.url),
    about: { "@type": "Thing", name: plainText(body.title) },
  };
}

export function guideFaqJsonLd(guide: PublishedGuide, locale: Locale): Record<string, unknown> | null {
  const items = guide.body[locale].faq.filter((f) => f.q && f.a);
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: plainText(f.a) } })),
  };
}

export function guideBreadcrumbJsonLd(guide: PublishedGuide, locale: Locale, base: string = siteUrl()): Record<string, unknown> {
  const c = GUIDE_PAGE_COPY[locale];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: c.breadcrumbHome, item: localizedUrl("/", locale, base) },
      { "@type": "ListItem", position: 2, name: c.breadcrumbGuides, item: localizedUrl(GUIDES_INDEX_PATH, locale, base) },
      { "@type": "ListItem", position: 3, name: guide.body[locale].title, item: localizedUrl(guidePath(guide.slug), locale, base) },
    ],
  };
}
