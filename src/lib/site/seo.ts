import type { Metadata } from "next";
import { BRAND } from "../brand";
import type { Locale } from "../i18n/dictionaries";
import { SITE_COPY, type Qa } from "./copy";
import { hreflangAlternates, localizedUrl, sitePath, siteUrl, type SitePageKey } from "./routes";
import { publishedReviews } from "./socialProof";

// Per-page metadata and structured data for the public website. Every page
// has a title and description in the request's language, a canonical URL in
// that language, and hreflang links to both languages plus the x-default.
// The Open Graph image is src/app/opengraph-image.tsx (Next's file
// convention), drawn from the brand's own logo file and colours.
//
// Structured data: Organization (on every page) and FAQPage (on /preguntas).
// No rating, no review count, no award: schema.org would accept them, but we
// have none (socialProof.ts), and a rating in schema with no reviews behind
// it is the kind of fake proof the site refuses.

/**
 * The brand image (src/app/opengraph-image.tsx). Named here because a page's
 * own openGraph replaces the inherited one, image included.
 */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: BRAND.name };

export function siteMetadata(key: SitePageKey, locale: Locale, base: string = siteUrl()): Metadata {
  const path = sitePath(key);
  const { title, description } = SITE_COPY[locale].meta[key];
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: localizedUrl(path, locale, base),
      languages: hreflangAlternates(path, base),
    },
    openGraph: {
      type: "website",
      siteName: BRAND.name,
      title,
      description,
      url: localizedUrl(path, locale, base),
      locale: locale === "es" ? "es_US" : "en_US",
      alternateLocale: locale === "es" ? ["en_US"] : ["es_US"],
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

export function organizationJsonLd(locale: Locale, base: string = siteUrl()): Record<string, unknown> {
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS || null;
  const email = process.env.NEXT_PUBLIC_COMPANY_EMAIL || null;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.name,
    url: base,
    logo: `${base}${BRAND.logo.onLight.src}`,
    description: SITE_COPY[locale].meta.home.description,
    areaServed: { "@type": "State", name: "Texas" },
    knowsLanguage: ["en", "es"],
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
  };
}

export function faqJsonLd(items: readonly Qa[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** Whether any rating may appear anywhere (schema or page): only with real reviews on file. */
export function hasRealReviews(): boolean {
  return publishedReviews().length > 0;
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
